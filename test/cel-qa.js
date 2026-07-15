// Real-time headless CDP driver for celhunt.html (mesh pages can't use the vm
// harness, and --virtual-time-budget starves GLB texture decode: the parse
// hangs inside createImageBitmap under virtual time). This drives real Chrome
// over the DevTools protocol with real wall-clock time instead.
//
//   node test/cel-qa.js                                  # QA run (expects QA:PASS in <title>)
//   node test/cel-qa.js "<url>" --shot out.png --wait 5000   # hero shot of any page state
//   node test/cel-qa.js "<url>" --exec "<js>" --shot out.png # inject input, then capture
//
// Needs node >= 21 (global WebSocket + fetch). Assumes a static server on the
// repo root, e.g.: python3 -m http.server 8391 --directory .
const { spawn } = require('child_process');
const fs = require('fs');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = process.argv[2] && !process.argv[2].startsWith('--')
  ? process.argv[2] : 'http://localhost:8391/celhunt.html?qa=1&seed=5';
const arg = f => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : null; };
const shotPath = arg('--shot');
const waitMs = +(arg('--wait') || 15000);
const profile = `/tmp/celqa-${process.pid}`;

let chrome;
const die = (msg, code) => {
  const done = () => {
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    console.log(msg); process.exit(code);
  };
  if (chrome) { chrome.once('exit', done); chrome.kill(); setTimeout(done, 3000); }
  else done();
};

(async () => {
  chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--no-first-run',
    `--window-size=1100,760`, '--enable-unsafe-swiftshader', '--hide-scrollbars',
    `--user-data-dir=${profile}`, url], { stdio: ['ignore', 'ignore', 'pipe'] });
  const browserWs = await new Promise((res, rej) => {
    let buf = '';
    chrome.stderr.on('data', d => {
      buf += d; const m = buf.match(/DevTools listening on (ws:\S+)/); if (m) res(m[1]);
    });
    setTimeout(() => rej(new Error('devtools endpoint never appeared')), 15000);
  });
  const port = browserWs.match(/:(\d+)\//)[1];

  // find the page target (poll: the tab races the debugger endpoint)
  let target = null;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find(t => t.type === 'page' && t.url.includes(url.split('?')[0].split('/').pop()));
    if (!target) await new Promise(r => setTimeout(r, 200));
  }
  if (!target) die('FAIL: page target not found', 1);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const cdp = (method, params = {}) => new Promise(res => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJs = async expr =>
    (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;

  const exec = arg('--exec');
  if (exec) { await new Promise(r => setTimeout(r, 2500)); await evalJs(exec); }

  // poll the page's self-test verdict (QA mode) or just wait out the clock (shot mode)
  const t0 = Date.now();
  let title = '';
  while (Date.now() - t0 < waitMs) {
    title = (await evalJs('document.title')) || '';
    if (title.startsWith('QA:')) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (shotPath) {
    const frames = +(arg('--frames') || 1), interval = +(arg('--interval') || 160);
    for (let i = 0; i < frames; i++) {
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      const p = frames > 1 ? shotPath.replace(/\.png$/, `-${i}.png`) : shotPath;
      fs.writeFileSync(p, Buffer.from(shot.result.data, 'base64'));
      if (frames > 1) await new Promise(r => setTimeout(r, interval));
    }
    console.log('shot →', shotPath, frames > 1 ? `(${frames} frames)` : '');
  }
  const state = await evalJs(`window.__qa ? JSON.stringify({
      errors: __qa.errors, wave: __qa.wave, ready: __qa.hunter.ready,
      monsters: __qa.monsters.map(m => ({ name: m.sp.name, base: m.sp.base, hp: m.hp, max: m.sp.hp }))
    }) : 'no __qa hook'`);
  console.log('state:', state);
  const isQaRun = url.includes('qa=1');
  if (isQaRun && !title.startsWith('QA:PASS')) die('FAIL: ' + (title || 'no QA verdict in ' + waitMs + 'ms'), 1);
  die(isQaRun ? title : 'done', 0);
})().catch(e => die('FAIL: ' + e.message, 1));
