// Headless smoke test: run the page's <script> with stubbed DOM/WebGL,
// drive the sim across presets, morphs, actions and flight; assert sanity.
const fs = require('fs');
const vm = require('vm');

const src = process.env.SMOKE_SRC || (fs.existsSync(__dirname + '/../index.html')
  ? __dirname + '/../index.html' : __dirname + '/monster-lab.html');
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
  console, Math, JSON, Float32Array, Map, Proxy, Error, URLSearchParams,
  document: {
    getElementById: id => (id === 'gl' ? canvas : makeEl()),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
  },
  matchMedia: () => ({ matches: false }),
  addEventListener() {},
  innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
  location: { search: '' },
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
    // visual-lab tracks raw vs packed face/body budgets; index has only soft/hard
    if (typeof nFace !== 'undefined' && nFace !== nFaceRaw)
      throw new Error(tag + ': face geometry shed');
    if (typeof nSoftRaw !== 'undefined' && st.pairsN <= 2 && nSoftRaw + nHardRaw > MAXN)
      throw new Error(tag + ': normal config shed geometry');
    if (nSoft + nHard > MAXN) throw new Error(tag + ': over segment budget');
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

  if (PRESETS.drake) {
    initCreature('drake'); st.target = [3, 0, -2];
    __drive(500); __check('drake-walk');
    startAction('attack'); __drive(15);
    if (st.jawEnv < 0.5) throw new Error('drake jaw did not open: ' + st.jawEnv);
    __check('drake-attack'); __drive(120);
    startAction('jump'); __drive(20);
    if (!(st.jumpY > 0.02 || st.jumpVy > 0)) throw new Error('drake no jump lift');
    __drive(120); __check('drake-jump-landed');
    startAction('dash'); __drive(90); __check('drake-dash');
    startAction('rest'); __drive(300); __check('drake-rest');
    if (st.rest < 0.8) throw new Error('drake rest did not settle: ' + st.rest);
    startAction('rest'); // wake
    st.spikes = true; st.hat = true; st.wings = true; __drive(10);
    __check('drake-dressup-max');
    buildLegs(4); st.posture = 1; st.target = [4, 0, -3]; __drive(20);
    __check('drake-worst-case');

    // turn, don't moonwalk: a call directly behind the back must not fold the
    // head into the torso or drag the body backwards over the tail
    initCreature('beast'); st.roam = false; st.target = [6, 0, 0]; __drive(240);
    const fw0 = nrm([st.chest[0] - st.hip[0], 0, st.chest[2] - st.hip[2]]);
    st.target = [st.hip[0] - fw0[0] * 2.5, 0, st.hip[2] - fw0[2] * 2.5];
    let worstSnout = 1, engulf = 0;
    for (let f = 0; f < 220; f++) {
      __drive(1);
      const fw = nrm([st.chest[0] - st.hip[0], 0, st.chest[2] - st.hip[2]]);
      const sn = nrm([segsB[12] - st.chest[0], 0, segsB[14] - st.chest[2]]);
      worstSnout = Math.min(worstSnout, dot(sn, fw));
      const mid = mix(st.chest, st.hip, .5);
      for (let i = 0; i < 3; i++) if (len(sub(st.tail[i], mid)) < P.midR) engulf++;
    }
    if (worstSnout < 0) throw new Error('turn folded head into body: ' + worstSnout.toFixed(2));
    if (engulf > 0) throw new Error('tail engulfed during turn: ' + engulf);
    console.log('turn-behind | worst snout·fw:', worstSnout.toFixed(2), '| tail engulf:', engulf);

    // preset morphing: numbers lerp, features fade, counts rebuild; a retarget
    // mid-morph must also converge cleanly
    initCreature('skink'); st.roam = false; st.target = [st.leader[0], 0, st.leader[2]];
    morphTo('rex'); __drive(52); __check('morph-mid');
    if (!morph) throw new Error('morph ended early');
    morphTo('bug'); __drive(20); __check('morph-retarget');
    __drive(80); __check('morph-done');
    if (P !== PRESETS.bug) throw new Error('morph did not converge to bug');
    if (morph) throw new Error('morph still active after convergence');
    morphTo('drake'); __drive(120); __check('morph-drake');
    if (P !== PRESETS.drake || st.pairsN !== 2) throw new Error('morph to drake broken');
  }

  initCreature('wyvern'); st.target = [-6, 0, 4];
  __drive(110);
  if (st.air < 0.6) throw new Error('wyvern not airborne: ' + st.air);
  if (st.chest[1] < 1.0) throw new Error('wyvern flying too low: ' + st.chest[1].toFixed(2));
  __check('wyvern-flying');
  st.target = [st.leader[0], 0, st.leader[2]];
  __drive(400);
  if (st.air > 0.25) throw new Error('wyvern did not land: ' + st.air);
  __check('wyvern-landed');

  if (PRESETS.rathalos) {
    initCreature('rathalos'); st.target = [-10, 0, 6];
    __drive(100);
    if (st.air < 0.6) throw new Error('rathalos not airborne: ' + st.air);
    if (st.chest[1] < 1.0) throw new Error('rathalos flying too low: ' + st.chest[1].toFixed(2));
    __check('rathalos-flying');
    startAction('attack'); __drive(15);
    if (st.jawEnv < 0.5) throw new Error('rathalos jaw did not open: ' + st.jawEnv);
    __check('rathalos-attack');
    st.target = [st.leader[0], 0, st.leader[2]];
    __drive(400);
    if (st.air > 0.25) throw new Error('rathalos did not land: ' + st.air);
    __check('rathalos-landed');
  }

  if (PRESETS.veil) { // reef-walker: scuttle, radial maw attack, spiral tail, no flight
    initCreature('veil'); st.roam = false; st.target = [3, 0, -2];
    __drive(500); __check('veil-walk');
    if (st.pairsN !== 3) throw new Error('veil should have 3 leg pairs: ' + st.pairsN);
    startAction('attack'); __drive(15);
    if (st.jawEnv < 0.5) throw new Error('veil radial maw did not open: ' + st.jawEnv);
    __check('veil-attack'); __drive(120);
    startAction('jump'); __drive(20);
    if (!(st.jumpY > 0.02 || st.jumpVy > 0)) throw new Error('veil no jump lift');
    __drive(140); __check('veil-jump-landed');
    morphTo('rex'); __drive(120); __check('morph-veil-to-rex');
    if (P !== PRESETS.rex) throw new Error('morph did not converge to rex');
    morphTo('veil'); __drive(120); __check('morph-back-to-veil');
    if (P !== PRESETS.veil || st.pairsN !== 3) throw new Error('morph did not converge back to veil');
  }

  if (PRESETS.sparky) { // pocket-monster trio: walk, jump, jaw, and a chibi morph
    for (const cute of ['sparky', 'blaze', 'sprout']) {
      initCreature(cute); st.roam = false; st.target = [3, 0, -2];
      __drive(400); __check(cute + '-walk');
      startAction('jump'); __drive(20);
      if (!(st.jumpY > 0.02 || st.jumpVy > 0)) throw new Error(cute + ': no jump lift');
      __drive(140); __check(cute + '-jump-landed');
    }
    startAction('attack'); __drive(15); // sprout has no jaw: env must stay finite, not open
    __check('sprout-attack'); __drive(120);
    initCreature('blaze'); startAction('attack'); __drive(15);
    if (st.jawEnv < 0.5) throw new Error('blaze jaw did not open: ' + st.jawEnv);
    __check('blaze-attack'); __drive(120);
    morphTo('sparky'); __drive(120); __check('morph-sparky');
    if (P !== PRESETS.sparky) throw new Error('morph did not converge to sparky');
    morphTo('diablos'); __drive(120); __check('morph-sparky-to-diablos');
    if (P !== PRESETS.diablos) throw new Error('morph did not converge back to diablos');
  }

  initCreature('bug'); buildLegs(4); st.wings = true; st.target = [4, 0, -3];
  __drive(400); __check('bug-8legs-winged');
  st.posture = 1; __drive(200); __check('bug-upright');
  console.log('SMOKE OK');
`, ctx, { filename: 'driver.js' });
