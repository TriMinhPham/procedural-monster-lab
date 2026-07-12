// Headless gallop probe — drives visual-lab sim, prints PASS/FAIL per SPEC.md
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = process.env.PROBE_SRC || path.join(__dirname, '..', 'visual-lab.html');
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
  __fails: 0,
};
vm.createContext(ctx);
vm.runInContext(js, ctx, { filename: 'visual-lab.js' });

vm.runInContext(`
function __drive(n) {
  for (let i = 0; i < n; i++) {
    __t += 16.6;
    const cb = __raf; __raf = null;
    if (cb) cb(__t);
  }
}
function __pass(name, detail) {
  console.log('PASS  ' + name + (detail ? ' | ' + detail : ''));
}
function __fail(name, detail) {
  __fails++;
  console.log('FAIL  ' + name + (detail ? ' | ' + detail : ''));
}
function __check(name, cond, detail) {
  if (cond) __pass(name, detail); else __fail(name, detail);
}
function __hSpan() {
  return Math.hypot(st.chest[0] - st.hip[0], st.chest[2] - st.hip[2]);
}
function __fores() { return st.legs.filter(l => l.u < .5); }
function __diagPartner(leg) {
  return st.legs.find(o => o !== leg && o.group === leg.group);
}
function __samePair(leg) {
  return st.legs.find(o => o !== leg && (o.u < .5) === (leg.u < .5));
}
// zigzag hip joint (matches simulate clamp / buildSkeleton: side = nrm(cross(up,fw)))
function __hipJ(leg) {
  const bodyR = (P.chestR + (P.hipR - P.chestR) * leg.u) * (st.radScale || 1);
  const spine = mix(st.chest, st.hip, leg.u);
  const fw = nrm([st.chest[0] - st.hip[0], 0, st.chest[2] - st.hip[2]]);
  const side = nrm(cross(V(0, 1, 0), fw)); // [fwz,0,-fwx], NOT the left-hand flip
  return add(spine, add(scl(side, leg.s * bodyR * .55), V(0, -bodyR * .15, 0)));
}
function __maxReach(leg) {
  const limb = P.fore && leg.u < .5 ? P.fore : P;
  return ((limb.lu || 0) + (limb.ll || 0) + (limb.fs || 0)) * 1.05 * (st.legScale || 1);
}

// ---------- 1) diablos far target: engage + fore pair overlap ----------
initCreature('diablos');
st.roam = false;
st.target = [40, 0, 0];
let maxG = 0, engageFrame = -1;
for (let f = 0; f < 300; f++) {
  __drive(1);
  if (st.gallop > maxG) maxG = st.gallop;
  if (engageFrame < 0 && st.gallop > .8) engageFrame = f;
}
__check('diablos-engage', maxG > .8,
  'max gallop=' + maxG.toFixed(3) + ' frame=' + engageFrame);

// dedicated gallop window: fore legs swing together
initCreature('diablos');
st.roam = false;
st.target = [80, 0, 5];
__drive(200);
let foreOverlap = 0, foreAny = 0;
for (let f = 0; f < 200; f++) {
  __drive(1);
  if (st.gallop <= .8) continue;
  const fores = __fores();
  // count only t>=0 (in air / swinging); rotary lag has t<0 while still planted
  const swinging = fores.filter(l => l.stepping && l.t >= 0);
  if (fores.some(l => l.stepping && l.t >= 0)) {
    foreAny++;
    if (swinging.length >= 2) foreOverlap++;
  }
}
const foreRatio = foreAny > 0 ? foreOverlap / foreAny : 0;
__check('gallop-fore-overlap', foreAny > 5 && foreRatio > .15,
  'overlap ' + foreOverlap + '/' + foreAny + ' ratio=' + foreRatio.toFixed(2) + ' g=' + st.gallop.toFixed(2));

// walking: keep speedN low so gallop never engages; diagonal is the overlap partner
initCreature('diablos');
st.roam = false;
st.gallop = 0; st.gallopT = 0;
st.target = [st.leader[0] + 0.7, 0, st.leader[2]];
__drive(60);
let walkDiag = 0, walkSame = 0, walkAny = 0, walkG = 0;
for (let f = 0; f < 280; f++) {
  // creep: retarget just ahead, and bleed speed so speedN stays walk-class
  if (f % 20 === 0) {
    const dx = st.chest[0] - st.hip[0], dz = st.chest[2] - st.hip[2];
    const L = Math.hypot(dx, dz) || 1;
    st.target = [st.leader[0] + dx / L * 0.65, 0, st.leader[2] + dz / L * 0.65];
  }
  if (st.speedN > .45) st.vel = scl(st.vel, .55); // hard cap walk
  __drive(1);
  walkG = Math.max(walkG, st.gallop);
  if (st.gallop > .05 || st.speedN > .5) continue;
  const a = st.legs[0];
  if (!a.stepping || a.t < 0) continue;
  walkAny++;
  const diag = __diagPartner(a);
  const same = __samePair(a);
  if (diag && diag.stepping && diag.t >= 0) walkDiag++;
  if (same && same.stepping && same.t >= 0) walkSame++;
}
__check('walk-diagonal-not-fore', walkG < .05 && walkAny > 3 && walkDiag >= walkSame,
  'diag=' + walkDiag + ' samePair=' + walkSame + ' any=' + walkAny + ' maxG=' + walkG.toFixed(3));

// ---------- 2) spine span oscillation ----------
function spanStats(far, frames, warm) {
  initCreature('diablos');
  st.roam = false;
  st.target = far ? [60, 0, 2] : [st.leader[0] + 0.7, 0, st.leader[2]];
  __drive(warm);
  let minS = 1e9, maxS = -1e9, sumG = 0;
  for (let f = 0; f < frames; f++) {
    if (!far) {
      if (f % 20 === 0) {
        const dx = st.chest[0] - st.hip[0], dz = st.chest[2] - st.hip[2];
        const L = Math.hypot(dx, dz) || 1;
        st.target = [st.leader[0] + dx / L * 0.6, 0, st.leader[2] + dz / L * 0.6];
      }
      if (st.speedN > .45) st.vel = scl(st.vel, .55);
    }
    __drive(1);
    const s = __hSpan();
    if (s < minS) minS = s;
    if (s > maxS) maxS = s;
    sumG += st.gallop;
  }
  const amp = maxS - minS;
  return { amp, pct: amp / P.bodyLen, meanG: sumG / frames };
}
const gallopSpan = spanStats(true, 180, 220);
__check('spine-osc-gallop', gallopSpan.meanG > .5 && gallopSpan.pct >= 0.02,
  'amp=' + gallopSpan.amp.toFixed(4) + ' (' + (gallopSpan.pct * 100).toFixed(2) + '% bodyLen) meanG=' + gallopSpan.meanG.toFixed(2));

const walkSpan = spanStats(false, 200, 100);
__check('spine-osc-walk', walkSpan.meanG < .05 && walkSpan.pct < 0.005,
  'amp=' + walkSpan.amp.toFixed(4) + ' (' + (walkSpan.pct * 100).toFixed(2) + '% bodyLen) meanG=' + walkSpan.meanG.toFixed(3));

// span-identity-walk: DC span must match pre-gallop volume-conserving span0 (no 5% gather bias)
// pre-change span0 = sqrt(max(bodyLen^2 - dyH^2, bodyLen^2*.16)); gather must be identity at g=0
function spanIdentity(mode) {
  initCreature('diablos');
  st.roam = false;
  st.gallop = 0; st.gallopT = 0;
  if (mode === 'rest') {
    st.restOn = true;
    st.target = [st.leader[0], 0, st.leader[2]];
  } else {
    st.target = [st.leader[0] + 0.7, 0, st.leader[2]];
  }
  __drive(80);
  let sumS = 0, sum0 = 0, n = 0, maxG = 0;
  for (let f = 0; f < 180; f++) {
    if (mode === 'walk') {
      if (f % 20 === 0) {
        const dx = st.chest[0] - st.hip[0], dz = st.chest[2] - st.hip[2];
        const L = Math.hypot(dx, dz) || 1;
        st.target = [st.leader[0] + dx / L * 0.6, 0, st.leader[2] + dz / L * 0.6];
      }
      if (st.speedN > .45) st.vel = scl(st.vel, .55);
    } else {
      st.target = [st.leader[0], 0, st.leader[2]];
      st.vel = V();
    }
    __drive(1);
    maxG = Math.max(maxG, st.gallop);
    if (st.gallop > .02) continue;
    // pre-change volume-conserving span0 from current chest/hip Y relationship
    const dyH = st.hip[1] - st.chest[1];
    const span0 = Math.sqrt(Math.max(P.bodyLen * P.bodyLen - dyH * dyH, P.bodyLen * P.bodyLen * .16));
    sumS += __hSpan();
    sum0 += span0;
    n++;
  }
  const meanS = sumS / Math.max(n, 1);
  const mean0 = sum0 / Math.max(n, 1);
  const rel = Math.abs(meanS - mean0) / Math.max(mean0, 1e-9);
  return { meanS, mean0, rel, n, maxG };
}
const idWalk = spanIdentity('walk');
__check('span-identity-walk', idWalk.n > 30 && idWalk.maxG < .05 && idWalk.rel < 0.003,
  'walk meanSpan=' + idWalk.meanS.toFixed(4) + ' meanSpan0=' + idWalk.mean0.toFixed(4)
  + ' rel=' + (idWalk.rel * 100).toFixed(3) + '% n=' + idWalk.n);
const idRest = spanIdentity('rest');
__check('span-identity-rest', idRest.n > 30 && idRest.maxG < .05 && idRest.rel < 0.003,
  'rest meanSpan=' + idRest.meanS.toFixed(4) + ' meanSpan0=' + idRest.mean0.toFixed(4)
  + ' rel=' + (idRest.rel * 100).toFixed(3) + '% n=' + idRest.n);

// ---------- 3) retarget near → release + feet settle ----------
initCreature('diablos');
st.roam = false;
st.target = [50, 0, 0];
__drive(250);
const gBefore = st.gallop;
st.target = [st.leader[0], 0, st.leader[2]];
__drive(200);
const gAfter = st.gallop;
let stepChurn = 0;
for (let f = 0; f < 80; f++) {
  __drive(1);
  if (st.legs.some(l => l.stepping && l.t >= 0)) stepChurn++;
}
__check('retarget-release', gBefore > .5 && gAfter < .05,
  'gBefore=' + gBefore.toFixed(3) + ' gAfter=' + gAfter.toFixed(3));
__check('feet-settle', stepChurn < 12,
  'stepping frames at rest=' + stepChurn + '/80');

// ---------- 4) rex and bug never gallop ----------
initCreature('rex');
st.roam = false;
st.target = [40, 0, 0];
let rexMax = 0;
for (let f = 0; f < 300; f++) { __drive(1); rexMax = Math.max(rexMax, st.gallop); }
__check('rex-no-gallop', rexMax === 0, 'maxG=' + rexMax);

initCreature('bug');
st.roam = false;
st.target = [40, 0, 0];
let bugMax = 0;
for (let f = 0; f < 300; f++) { __drive(1); bugMax = Math.max(bugMax, st.gallop); }
__check('bug-no-gallop', bugMax === 0, 'maxG=' + bugMax);

// ---------- 5) 600-frame full-speed diablos: finite, chest floor, no overstretch ----------
initCreature('diablos');
st.roam = false;
st.target = [100, 0, 8];
let finiteOk = true, chestLow = 0, overstretch = 0, minChest = 1e9, maxStretchRatio = 0;
for (let f = 0; f < 600; f++) {
  if (f % 40 === 0) {
    const dx = st.chest[0] - st.hip[0], dz = st.chest[2] - st.hip[2];
    const L = Math.hypot(dx, dz) || 1;
    st.target = [st.leader[0] + dx / L * 30, 0, st.leader[2] + dz / L * 30];
  }
  __drive(1);
  if (!st.chest.every(isFinite)) finiteOk = false;
  for (let i = 0; i < segsA.length; i++) if (!isFinite(segsA[i])) finiteOk = false;
  if (st.chest[1] < minChest) minChest = st.chest[1];
  if (st.chest[1] < .55 * P.chestH) chestLow++;
  for (const leg of st.legs) {
    const hipJ = __hipJ(leg);
    const maxR = __maxReach(leg);
    const d = Math.hypot(leg.foot[0] - hipJ[0], leg.foot[1] - hipJ[1], leg.foot[2] - hipJ[2]);
    const planted = !leg.stepping || leg.t < 0;
    // planted: y-preserve may leave residual 3D overreach (lead-approved); enforce XZ budget
    if (planted) {
      const dXZ = Math.hypot(leg.foot[0] - hipJ[0], leg.foot[2] - hipJ[2]);
      if (dXZ > maxR + 1e-6) overstretch++;
      if (dXZ / maxR > maxStretchRatio) maxStretchRatio = dXZ / maxR;
    } else {
      if (d > maxR + 1e-6) overstretch++;
      if (d / maxR > maxStretchRatio) maxStretchRatio = d / maxR;
    }
  }
}
__check('finite-600', finiteOk, 'all chest/segsA finite');
__check('chest-floor', chestLow === 0,
  'minChest=' + minChest.toFixed(3) + ' floor=' + (.55 * P.chestH).toFixed(3) + ' viol=' + chestLow);
// mid-swing must stay inside the sphere; planted may retain small 3D residual (y-preserve)
__check('no-overstretch', overstretch === 0,
  'violations=' + overstretch + ' maxRatio=' + maxStretchRatio.toFixed(3));

// ---------- 6) planted-y-stable: clamp must not lift planted feet ----------
function plantedYStable(mode) {
  initCreature('diablos');
  st.roam = false;
  if (mode === 'walk') {
    st.gallop = 0; st.gallopT = 0;
    st.target = [st.leader[0] + 0.7, 0, st.leader[2]];
  } else {
    st.target = [80, 0, 4];
  }
  __drive(mode === 'gallop' ? 200 : 80);
  const restY = P.legR * (st.radScale || 1) * .8;
  // prev planted y per leg index; only compare across continuous plant
  let prevY = st.legs.map(() => null);
  let prevPlanted = st.legs.map(() => false);
  let yDrift = 0, yLift = 0, plantedN = 0, maxLift = 0;
  for (let f = 0; f < 400; f++) {
    if (mode === 'walk') {
      if (f % 20 === 0) {
        const dx = st.chest[0] - st.hip[0], dz = st.chest[2] - st.hip[2];
        const L = Math.hypot(dx, dz) || 1;
        st.target = [st.leader[0] + dx / L * 0.65, 0, st.leader[2] + dz / L * 0.65];
      }
      // full-speed *walk* (not gallop): cap just under engage
      if (st.speedN > .68) st.vel = scl(st.vel, .9);
      if (st.gallop > .05) { st.gallop = 0; st.gallopT = 0; }
    } else if (f % 40 === 0) {
      const dx = st.chest[0] - st.hip[0], dz = st.chest[2] - st.hip[2];
      const L = Math.hypot(dx, dz) || 1;
      st.target = [st.leader[0] + dx / L * 30, 0, st.leader[2] + dz / L * 30];
    }
    // snapshot y before step for legs already planted — clamp must leave these unchanged
    const preY = st.legs.map(l => l.foot[1]);
    const prePlant = st.legs.map(l => !l.stepping || l.t < 0);
    __drive(1);
    st.legs.forEach((leg, i) => {
      const planted = !leg.stepping || leg.t < 0;
      if (!planted) { prevY[i] = null; prevPlanted[i] = false; return; }
      plantedN++;
      // continuous plant: y must match pre-drive (clamp is only mutator for planted y)
      if (prePlant[i] && Math.abs(leg.foot[1] - preY[i]) > 1e-6) yDrift++;
      // also frame-to-frame continuity while planted
      if (prevPlanted[i] && prevY[i] !== null && Math.abs(leg.foot[1] - prevY[i]) > 1e-6) yDrift++;
      const lift = leg.foot[1] - restY;
      if (lift > maxLift) maxLift = lift;
      if (leg.foot[1] > restY + .001) yLift++;
      prevY[i] = leg.foot[1];
      prevPlanted[i] = true;
    });
  }
  return { yDrift, yLift, plantedN, maxLift, restY, g: st.gallop };
}
const pyWalk = plantedYStable('walk');
const pyGal = plantedYStable('gallop');
__check('planted-y-stable',
  pyWalk.plantedN > 100 && pyWalk.yDrift === 0 && pyWalk.yLift === 0
  && pyGal.plantedN > 100 && pyGal.yDrift === 0 && pyGal.yLift === 0 && pyGal.g > .5,
  'walk drift=' + pyWalk.yDrift + ' lift=' + pyWalk.yLift + ' maxLift=' + pyWalk.maxLift.toFixed(5)
  + ' n=' + pyWalk.plantedN
  + ' | gallop drift=' + pyGal.yDrift + ' lift=' + pyGal.yLift + ' maxLift=' + pyGal.maxLift.toFixed(5)
  + ' n=' + pyGal.plantedN + ' g=' + pyGal.g.toFixed(2));

console.log(__fails === 0 ? '\\nALL PROBE CHECKS PASS' : '\\n' + __fails + ' CHECK(S) FAILED');
`, ctx, { filename: 'probe-driver.js' });

process.exit(ctx.__fails === 0 ? 0 : 1);
