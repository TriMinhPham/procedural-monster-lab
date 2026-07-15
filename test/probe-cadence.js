// Headless cadence probe for hunt.html's second-order motion systems:
//  - gallop: quad re-phases diagonal trot pairs into fore/hind bounding pairs
//  - anticipation: strike wind-up drives the chest SOD's r (k3) negative, eases home
//  - tail: spring chain carries momentum — whips past rest on a hard stop, then settles
//  - head: low-frequency skull follower lags the trunk on a hard start
//  - invariants: tail segment lengths exact, everything finite through a tail-swipe whirl
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(process.env.PROBE_SRC || __dirname + '/../hunt.html', 'utf8');
const js = html.split('<script>')[1].split('</script>')[0];

function makeEl() {
  return {
    style: {}, dataset: {}, value: '0', checked: false, textContent: '',
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
const canvas = Object.assign(makeEl(), { width: 0, height: 0, getContext: () => glStub });

const seededMath = Object.create(Math);
{
  let s = (7 ^ 0x9e3779b9) >>> 0;
  seededMath.random = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ctx = {
  console, Math: seededMath, JSON, Float32Array, Map, Set, Proxy, Error, String,
  __TEST_SEED: 7,
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
ctx.setTimeout = () => 0;
ctx.clearTimeout = () => {};
vm.createContext(ctx);
vm.runInContext(js, ctx, { filename: 'hunt.js' });

let fails = 0;
ctx.__report = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? ' | ' + detail : ''));
  if (!ok) fails++;
};

vm.runInContext(`
(function(){
  const DT = 1/60;
  const cr = makeCreature('beast', { pos: V(0, 0, -6) });
  cr.home = [cr.leader[0], 0, cr.leader[2]];
  // pin the gaze dead ahead so head measurements see only the lag follower,
  // not the idle look-around wander
  cr.idleLook = 1e9; cr._look = [1e6, .35, cr.leader[2]];
  const step = () => buildSkeleton(cr, DT);
  const segL = cr.P.tailLen / cr.P.tailN;
  let segErrMax = 0, allFinite = true;
  const invariants = () => {
    let prev = cr.hip;
    for (const p of cr.tail) {
      segErrMax = Math.max(segErrMax, Math.abs(len(sub(p, prev)) - segL));
      if (!p.every(isFinite)) allFinite = false;
      prev = p;
    }
    if (!cr.chest.every(isFinite) || !cr.headPos.every(isFinite)) allFinite = false;
    for (const l of cr.legs) if (!l.foot.every(isFinite)) allFinite = false;
  };
  const run = (secs, fn) => {
    const n = Math.round(secs / DT);
    for (let i = 0; i < n; i++) { if (fn) fn(i); step(); invariants(); }
  };
  const fore = cr.legs.filter(l => l.u < .5);
  // run along the current heading, bent inside r=9 so the arena clamp (r=13)
  // never grabs the body — the path is a gentle circle, well below the
  // gallop's hard-turn release
  const ahead = () => {
    let tx = cr.leader[0] + cr.fw[0] * 8, tz = cr.leader[2] + cr.fw[2] * 8;
    const rr = Math.hypot(tx, tz);
    if (rr > 9) { tx *= 9 / rr; tz *= 9 / rr; }
    cr.target = [tx, 0, tz];
  };
  const chase = () => { cr.urge = cr.gait = 1; ahead(); };

  // --- trot: diagonal pairs — the two fore feet must NOT swing together ---
  let oneT = 0, bothT = 0;
  cr.urge = .25;
  run(2, ahead);                                               // settle into the amble
  run(4, () => {
    ahead();
    const a = fore[0].stepping, b = fore[1].stepping;
    if (a && b) bothT++; else if (a || b) oneT++;
  });
  __report('trot-diagonal', oneT > 0 && bothT <= oneT * .5, 'one=' + oneT + ' both=' + bothT);

  // --- gallop: engages at a sustained sprint, fore pair commits together ---
  let gMax = 0, oneG = 0, bothG = 0;
  run(6, () => {
    chase();
    gMax = Math.max(gMax, cr.gallop);
    if (cr.gallop > .9) {
      const a = fore[0].stepping, b = fore[1].stepping;
      if (a && b) bothG++; else if (a || b) oneG++;
    }
  });
  __report('gallop-engages', gMax > .9, 'gallop peak=' + gMax.toFixed(2));
  __report('gallop-pair-bound', bothG > oneG, 'both=' + bothG + ' one=' + oneG);

  // --- tail whip: a snap turn slings the chain past its new rest line and it
  // crosses back — carried momentum, not exponential ease-in ---
  const stop = () => { cr.urge = .6; cr.target = [cr.leader[0], 0, cr.leader[2]]; };
  run(2, chase);
  const side0 = nrm(cross(V(0, 1, 0), cr.fw));
  let sx = cr.leader[0] + side0[0] * 8, sz = cr.leader[2] + side0[2] * 8;
  { const rr = Math.hypot(sx, sz); if (rr > 9) { sx *= 9 / rr; sz *= 9 / rr; } }
  const hold = () => { cr.urge = 1; cr.target = [sx, 0, sz]; };
  const lat = () => dot(sub(cr.tail[cr.P.tailN - 1], cr.hip), nrm(cross(V(0, 1, 0), cr.fw)));
  const series = [];
  run(3.5, () => { hold(); series.push(lat()); });    // 90° snap, sprint, arrive
  run(3, hold);                                       // die out
  let settleL = 0, nL = 0;
  run(1.5, () => { hold(); settleL += lat(); nL++; });
  settleL /= nL;
  let amp = 0, crossings = 0;
  for (let i = 1; i < series.length; i++) {
    amp = Math.max(amp, Math.abs(series[i] - settleL));
    if ((series[i] - settleL) * (series[i - 1] - settleL) < 0) crossings++;
  }
  __report('tail-slings-wide', amp > .12 * cr.P.tailLen,
    'amp=' + amp.toFixed(3) + ' settle=' + settleL.toFixed(3));
  __report('tail-whip-oscillates', crossings >= 3, 'crossings=' + crossings);

  // --- head lag: the low-frequency skull follower trails the trunk whenever
  // it accelerates or cruises, and relaxes to zero at rest ---
  run(2, stop);
  const hRest = len(cr._headLag);
  let hMin = 1e9;
  run(.8, () => { chase(); hMin = Math.min(hMin, dot(cr._headLag, cr.fw)); });
  __report('head-lags-launch', hRest < .015 && hMin < -.05,
    'restLag=' + hRest.toFixed(3) + ' launchLag=' + hMin.toFixed(3));

  // --- anticipation: strike wind-up drives r (k3) negative, then eases home ---
  run(2, stop);
  const k3Base = cr.sodChest.k3;
  cr.act = 'strike'; cr.actT = 0; cr._struck = false;
  cr.actProf = { wind: .5, active: .2, rec: .3, jaw: .6, imp: 2.2, recoil: .4, kind: 'bite' };
  let k3Wind = null;
  run(.48, () => { stop(); });
  k3Wind = cr.sodChest.k3;
  run(2.5, () => { stop(); });
  __report('anticipation-negative-r', k3Wind < 0 && k3Base > 0,
    'base k3=' + k3Base.toFixed(3) + ' wind k3=' + k3Wind.toFixed(3));
  __report('anticipation-recovers', Math.abs(cr.sodChest.k3 - k3Base) < 1e-3,
    'after=' + cr.sodChest.k3.toFixed(3));

  // --- tail-swipe whirl: momentum chain stays finite and exact-length ---
  cr.act = 'tailswipe'; cr.actT = 0;
  cr.actProf = { wind: .3, dur: .6, rate: 7, rec: .4 };
  run(2, stop);
  __report('tail-length-exact', segErrMax < 1e-6, 'maxErr=' + segErrMax.toExponential(2));
  __report('all-finite', allFinite, '');
})();
`, ctx, { filename: 'probe-cadence-driver.js' });

console.log(fails ? 'CADENCE PROBE FAILURES: ' + fails : 'ALL CADENCE CHECKS PASS');
process.exit(fails ? 1 : 0);
