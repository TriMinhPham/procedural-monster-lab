// Headless smoke test: run the page's <script> with stubbed DOM/WebGL,
// drive 600 frames per preset, assert no NaNs in the packed segment data.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
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
    console.log(tag, '| segs soft:' + nSoft, 'hard:' + nHard,
      '| chest:', st.chest.map(v => v.toFixed(2)).join(','),
      '| bound:', bRad.toFixed(2));
  }
  __drive(600); __check('skink');
  st.hat = true; st.wobble = 0.5; st.target = [3, 0, -2];
  initCreature('beast'); __drive(600); __check('beast');
  initCreature('bug');   __drive(600); __check('bug');
  st.legScale = 1.5; st.radScale = 1.4; __drive(300); __check('bug-max-morph');
  st.legScale = 0.7; st.radScale = 0.7; __drive(300); __check('bug-min-morph');
  initCreature('beast'); st.legScale = 0.7; __drive(300); __check('beast-short-legs');
  console.log('SMOKE OK');
`, ctx, { filename: 'driver.js' });
