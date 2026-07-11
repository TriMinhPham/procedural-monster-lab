// Headless smoke test for hunt.html: stub DOM/WebGL, drive the fight —
// aggro, hits, enrage, tail sever, kill, carve, faint, quest fail.
const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync(__dirname + '/../hunt.html', 'utf8');
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

const ctx = {
  console, Math, JSON, Float32Array, Map, Set, Proxy, Error, String,
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
  __t: 0, __raf: null, __timers: [],
};
ctx.setTimeout = (cb, ms) => { ctx.__timers.push({ cb, at: ctx.__t + (ms || 0) }); return 0; };
ctx.clearTimeout = () => {};
vm.createContext(ctx);
vm.runInContext(js, ctx, { filename: 'hunt.js' });

vm.runInContext(`
  function __drive(n) {
    for (let i = 0; i < n; i++) {
      __t += 16.6;
      const due = __timers.filter(x => x.at <= __t);
      __timers = __timers.filter(x => x.at > __t);
      for (const x of due) x.cb();
      const cb = __raf; __raf = null;
      cb(__t);
    }
  }
  function __checkFinite(tag) {
    for (const cr of [player, boss]) {
      if (!cr.chest.every(isFinite)) throw new Error(tag + ': NaN chest for ' + cr.name);
      const segs = cr.segs;
      for (const list of [segs.soft, segs.hard]) for (const s of list)
        for (const v of [s[0], s[1]]) if (!v.every(isFinite))
          throw new Error(tag + ': NaN capsule in ' + cr.name);
    }
    console.log(tag, '| boss hp:' + boss.hp, '| ai:', game.ai.state,
      '| player hp:' + player.hp, '| faints:', game.faints);
  }

  // 1. patrol phase — player far away
  __drive(240); __checkFinite('patrol');
  if (game.ai.state !== 'patrol') throw new Error('boss should still patrol, got ' + game.ai.state);

  // 2. approach → aggro
  player.leader = [boss.leader[0] + 5, player.P.chestH, boss.leader[2]];
  player.sodChest.reset(player.leader);
  player.target = [player.leader[0], 0, player.leader[2]];
  __drive(60); __checkFinite('aggro');
  if (game.ai.state !== 'hunt') throw new Error('boss did not aggro: ' + game.ai.state);

  // 3. land a hit: park the player at the boss's flank and attack
  let hits = 0;
  for (let tryN = 0; tryN < 30 && boss.hp === boss.maxHp; tryN++) {
    player.leader = [boss.chest[0] + 1.1, player.P.chestH, boss.chest[2]];
    player.sodChest.reset(player.leader);
    playerAttack();
    __drive(40);
  }
  __checkFinite('first-blood');
  if (boss.hp >= boss.maxHp) throw new Error('player attacks never connected');

  // 4. enrage at 50%
  boss.hp = boss.maxHp * 0.5 + 5;
  hitBoss(20, 'body', boss.chest);
  __drive(30); __checkFinite('enrage');
  if (!game.ai.enraged) throw new Error('boss did not enrage');

  // 5. tail sever (part pool drained)
  game.parts.tail = 5;
  hitBoss(10, 'tail', boss.tail[2]);
  if (!game.severed) throw new Error('tail did not sever');
  if (boss.P.tailN !== 3) throw new Error('tail not shortened: ' + boss.P.tailN);
  if (!game.props || !game.props.soft.length) throw new Error('no severed-tail prop');
  if (game.carveNodes.length < 1) throw new Error('no tail carve node');
  __drive(60); __checkFinite('severed');

  // 6. boss slam event sanity (enraged move) — force it
  game.ai.slamCool = -1; game.ai.atkCool = 9; game.ai.chargeCool = 9;
  player.leader = [boss.leader[0] + 3, player.P.chestH, boss.leader[2]];
  player.sodChest.reset(player.leader);
  __drive(200); __checkFinite('post-slam');

  // 7. kill + corpse carve
  hitBoss(boss.hp + 50, 'head', boss.chest);
  if (!boss.dead || !game.over) throw new Error('boss did not die');
  __drive(120); __checkFinite('dead');
  player.leader = [boss.chest[0] + 1, player.P.chestH, boss.chest[2]];
  player.sodChest.reset(player.leader);
  tryCarve();
  if (!game.carving) throw new Error('carve did not start');
  __drive(100);
  if (game.loot.length < 1) throw new Error('no loot from carve');
  console.log('loot:', game.loot.join(', '));

  // 8. faint + respawn, then quest fail at 3
  game.over = false; boss.dead = false; // re-arm so hurtPlayer works
  hurtPlayer(500, boss.leader);
  if (game.faints !== 1) throw new Error('faint not counted');
  __drive(200);
  if (player.hp <= 0 || player.dead) throw new Error('player did not respawn');
  player.iFrames = 0; hurtPlayer(500, boss.leader);
  __drive(200); player.iFrames = 0; hurtPlayer(500, boss.leader);
  if (!game.failed) throw new Error('quest did not fail after 3 faints');
  __drive(60); __checkFinite('failed');

  console.log('HUNT SMOKE OK');
`, ctx, { filename: 'hunt-driver.js' });
