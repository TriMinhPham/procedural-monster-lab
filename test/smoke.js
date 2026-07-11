// Headless smoke test: run the page's <script> with stubbed DOM/WebGL,
// drive the sim across presets, morphs, actions and flight; assert sanity.
const fs = require('fs');
const vm = require('vm');

const src = fs.existsSync(__dirname + '/../index.html')
  ? __dirname + '/../index.html' : __dirname + '/monster-lab.html';
const html = fs.readFileSync(src, 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];

function makeEl() {
  return {
    style: {}, dataset: {}, value: '0', checked: false,
    firstElementChild: { textContent: '' },
    classList: { add() {}, toggle() {}, remove() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, setAttribute() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800 }; },
    setPointerCapture() {},
  };
}
const glStub = new Proxy({}, {
  get(_, prop) {
    if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
    if (prop === 'getShaderInfoLog' || prop === 'getProgramInfoLog') return () => '';
    if (prop === 'createShader' || prop === 'createProgram') return () => ({});
    if (prop === 'getUniformLocation') return (p, n) => n;
    if (typeof prop === 'string' && /^[A-Z_]+$/.test(prop)) return 1;
    return () => {};
  },
});
const canvas = Object.assign(makeEl(), {
  width: 0, height: 0,
  getContext: () => glStub,
});

const ctx = {
  console, Math, JSON, Float32Array, Map, Proxy, Error,
  document: {
    getElementById: id => (id === 'gl' ? canvas : makeEl()),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
  },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
  performance: { now: () => ctx.__t },
  requestAnimationFrame: cb => { ctx.__raf = cb; },
  __t: 0, __raf: null,
};
vm.createContext(ctx);
vm.runInContext(js, ctx, { filename: 'monster-lab.js' });

vm.runInContext(`
  function __drive(n) {
    for (let i = 0; i < n; i++) {
      __t += 16.6;
      const cb = __raf; __raf = null;
      cb(__t);
    }
  }
  function __check(tag) {
    for (let i = 0; i < (nSoft + nHard) * 4; i++) {
      if (!isFinite(segsA[i]) || !isFinite(segsB[i]))
        throw new Error(tag + ': NaN in segment data at ' + i);
    }
    if (!st.chest.every(isFinite)) throw new Error(tag + ': NaN chest');
    if (nSoft + nHard > 56) throw new Error(tag + ': over segment budget');
    console.log(tag, '| segs soft:' + nSoft, 'hard:' + nHard,
      '| chest:', st.chest.map(v => v.toFixed(2)).join(','),
      '| air:', st.air.toFixed(2), '| rest:', st.rest.toFixed(2));
  }
  st.roam = false;
  st.target = [2, 0, 1];
  __drive(600); __check('skink');

  initCreature('rex'); st.target = [3, 0, -2];
  __drive(500); __check('rex-walk');
  startAction('attack'); __drive(15);
  if (st.jawEnv < 0.5) throw new Error('jaw did not open: ' + st.jawEnv);
  __check('rex-attack'); __drive(120);
  startAction('jump'); __drive(20);
  if (!(st.jumpY > 0.02 || st.jumpVy > 0)) throw new Error('no jump lift');
  __drive(120); __check('rex-jump-landed');
  startAction('dash'); __drive(90); __check('rex-dash');
  startAction('rest'); __drive(300); __check('rex-rest');
  if (st.rest < 0.8) throw new Error('rest did not settle: ' + st.rest);
  startAction('rest'); // wake

  initCreature('wyvern'); st.target = [-6, 0, 4];
  __drive(110);
  if (st.air < 0.6) throw new Error('wyvern not airborne: ' + st.air);
  if (st.chest[1] < 1.0) throw new Error('wyvern flying too low: ' + st.chest[1].toFixed(2));
  __check('wyvern-flying');
  st.target = [st.leader[0], 0, st.leader[2]];
  __drive(400);
  if (st.air > 0.25) throw new Error('wyvern did not land: ' + st.air);
  __check('wyvern-landed');

  initCreature('bug'); buildLegs(4); st.wings = true; st.target = [4, 0, -3];
  __drive(400); __check('bug-8legs-winged');
  st.posture = 1; __drive(200); __check('bug-upright');
  console.log('SMOKE OK');
`, ctx, { filename: 'driver.js' });
