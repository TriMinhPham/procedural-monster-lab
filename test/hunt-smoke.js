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

// deterministic runs: combat rolls unseeded Math.random (damage, AI orbit
// flips), which made assertions flake per-run. Hand the page a seeded clone.
const seededMath = Object.create(Math);
{
  let s = (+(process.env.HUNT_SEED || 7) ^ 0x9e3779b9) >>> 0;
  seededMath.random = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ctx = {
  console, Math: seededMath, JSON, Float32Array, Map, Set, Proxy, Error, String,
  __TEST_SEED: +(process.env.HUNT_SEED || 7),
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

  // 1. patrol phase — player far away. Park beyond max wander reach: the boss
  // roams up to ~5.5u from home, and aggro range is 7.5 — the spawn point left
  // too little margin (a max-radius wander roll could aggro spontaneously).
  player.leader = [0, player.P.chestH, 11.5];
  player.sodChest.reset(player.leader);
  player.target = [0, 0, 11.5];
  __drive(240); __checkFinite('patrol');
  if (game.ai.state !== 'patrol') throw new Error('boss should still patrol, got ' + game.ai.state);
  if (player.P.humanoid !== true) throw new Error('player is not the hunter preset');
  const armR = player.segs.soft.filter(s => s[5] === 'armR').length;
  const armL = player.segs.soft.filter(s => s[5] === 'armL').length;
  if (armR < 2 || armL < 2) throw new Error('hunter arms were not emitted');
  for (const p of [player.bladeA, player.bladeB])
    if (!p.every(isFinite)) throw new Error('hunter blade endpoint is not finite');

  // 2. approach → aggro
  player.leader = [boss.leader[0] + 5, player.P.chestH, boss.leader[2]];
  player.sodChest.reset(player.leader);
  player.target = [player.leader[0], 0, player.leader[2]];
  __drive(60); __checkFinite('aggro');
  if (game.ai.state !== 'hunt') throw new Error('boss did not aggro: ' + game.ai.state);
  const windups = [
    ['bite', AIP.biteWind, (.52 - .24 * SPECIES.snappy) * 1.8],
    ['charge', AIP.chargeWind, (.68 - .3 * SPECIES.snappy) * 1.6],
    ['tailswipe', AIP.swipeWind, .44 * 1.6],
    ['pounce', AIP.pounceWind, (.24 + .05 * Math.min(massOf(boss), 6)) * 1.4],
  ];
  for (const [name, got, want] of windups)
    if (Math.abs(got - want) > 1e-9) throw new Error(name + ' windup base changed: ' + got);

  // 3. land a hit: park the hunter at point-blank range and attack
  let hits = 0;
  for (let tryN = 0; tryN < 30 && boss.hp === boss.maxHp; tryN++) {
    player.leader = [boss.chest[0] + 1.1, player.P.chestH, boss.chest[2]];
    player.sodChest.reset(player.leader);
    playerAttack();
    __drive(40);
  }
  __checkFinite('first-blood');
  if (boss.hp >= boss.maxHp) throw new Error('player attacks never connected');
  if (!player._sweepTag) throw new Error('swept blade hit had no part tag');
  // anatomy: hitBoss must record lastHit for the struck-zone flash
  if (!game.lastHit || !game.lastHit.tag) throw new Error('game.lastHit not recorded on hit');
  if (typeof game.lastHit.t !== 'number' || !isFinite(game.lastHit.t))
    throw new Error('game.lastHit.t invalid: ' + game.lastHit.t);
  console.log('lastHit:', game.lastHit.tag, '@', game.lastHit.t.toFixed(2));

  // 3b. combo buffering: click mid-strike chains to stage 2
  // parked away from the boss with topped-up HP: buffering must not depend on
  // stochastic boss AI — a lucky bite could faint the player and swallow clicks
  player.hp = player.maxHp;
  player.leader = [boss.leader[0] + 9, player.P.chestH, boss.leader[2]];
  player.sodChest.reset(player.leader);
  player.target = [player.leader[0], 0, player.leader[2]];
  __drive(60); // let any current strike finish
  playerAttack(); __drive(10);           // stage 0, past wind-up
  playerAttack();                        // buffer stage 1
  __drive(40);
  if (player._comboN !== 1) throw new Error('combo did not chain: ' + player._comboN);
  __drive(60); __checkFinite('combo');

  // 3c. potion: hold Q through the 1.1s channel, then prove damage cancels
  // without consuming the next potion.
  game.ai.state = 'tired'; game.ai.tiredT = 99; boss.restOn = true; boss.act = null;
  player.hp = 35; player.iFrames = 0; game.potions = 3;
  keys.add('q'); startPotion(); __drive(70); keys.delete('q');
  if (game.potion) throw new Error('potion channel did not complete');
  if (game.potions !== 2) throw new Error('potion was not consumed');
  if (player.hp !== 90) throw new Error('potion healed wrong amount: ' + player.hp);
  player.hp = 100; player.iFrames = 0;
  keys.add('q'); startPotion(); __drive(20);
  if (!game.potion) throw new Error('potion channel ended too early');
  hurtPlayer(1, boss.leader); keys.delete('q');
  if (game.potion) throw new Error('damage did not cancel potion');
  if (game.potions !== 2) throw new Error('canceled potion was consumed');
  game.ai.state = 'hunt'; game.ai.tiredT = 0; boss.restOn = false;
  __drive(10); // clear the damage hit-stop before timing the dash cancel

  // 3d. dash cancel: stamina is spent by the dash and by its attack cancel.
  player.stam = player.stamMax; player.stamRegenT = 0; player.act = null;
  player.moveDir = [1, 0, 0];
  const stamBeforeDash = player.stam;
  playerDash(); __drive(8);
  if (player.act !== 'dash') throw new Error('dash ended before cancel window');
  if (player.stam !== stamBeforeDash - 30)
    throw new Error('dash did not spend stamina: ' + player.stam);
  playerAttack();
  if (player.act !== 'strike' || player.actProf.kind !== 'slash')
    throw new Error('dash did not cancel into strike');
  if (player.stam !== stamBeforeDash - 35)
    throw new Error('dash cancel did not spend stamina: ' + player.stam);
  __drive(50); __checkFinite('dash-cancel');

  // Three rapid dashes from 60 stamina: the third must be refused.
  player.act = null; player.stam = 60; player.stamRegenT = 1;
  playerDash(); player.act = null; playerDash(); player.act = null;
  const blockedStam = player.stam; playerDash();
  if (player.act === 'dash' || player.stam !== blockedStam)
    throw new Error('third instant dash was not blocked');
  player.stam = player.stamMax; player.stamRegenT = 0; player.act = null;

  // 3e. leap: force a pounce, confirm liftoff and a clean landing.
  // Ground the boss first — the movement brain may have it mid-jump/mid-swoop,
  // and startLeap (correctly) refuses while airborne.
  __drive(30);
  boss.act = null; boss.restOn = false;
  boss.jumpY = 0; boss.jumpVy = 0; boss.air = 0; boss.flyOK = false;
  boss._slam = false; boss._leapLand = false;
  game.ai.swooping = false; game.ai.dropSlam = false;
  if (!startLeap(boss, player.leader, { dmg: 5 })) throw new Error('leap did not start');
  let rose = false, landed = false;
  for (let i = 0; i < 160 && !landed; i++) {
    __drive(1);
    if (boss.jumpY > 0.2) rose = true;
    if (rose && boss.jumpY === 0) landed = true;
  }
  if (!rose) throw new Error('leap never left the ground');
  if (!landed) throw new Error('leap never landed');
  __checkFinite('leap');

  // 4. enrage at 50%
  boss.hp = boss.maxHp * 0.5 + 5;
  hitBoss(20, 'body', boss.chest);
  __drive(30); __checkFinite('enrage');
  if (!game.ai.enraged) throw new Error('boss did not enrage');

  // 5. tail sever (part pool drained) — only species with tails
  if (boss.P.tailN > 0) {
    const tailNPre = boss.P.tailN;
    const hadClub = !!boss.P.tailClub, hadSpikes = !!boss.P.tailSpikes;
    game.parts.tail = 5;
    hitBoss(10, 'tail', boss.tail[2]);
    if (!game.severed) throw new Error('tail did not sever');
    if (boss.P.tailN !== 3) throw new Error('tail not shortened: ' + boss.P.tailN);
    if (!game.props || !game.props.soft.length) throw new Error('no severed-tail prop');
    if (game.carveNodes.length < 1) throw new Error('no tail carve node');
    // amputation, not a smaller tail: blunt cut face, tip weapon gone with the piece
    if (boss.P.tailN0 !== tailNPre) throw new Error('tailN0 not recorded: ' + boss.P.tailN0);
    if (boss.P.tailClub || boss.P.tailSpikes || boss.P.lmTail)
      throw new Error('stump kept its tip weapon');
    buildSkeleton(boss, 1 / 60);
    const chainCaps = boss.segs.soft.filter(s => s[5] === 'tail' && s[4] === 1);
    const endR = chainCaps[chainCaps.length - 1][3];
    const bluntR = (boss.P.hipR * .7) * (1 - boss.P.tailN / boss.P.tailN0) * boss.radScale + .012;
    if (Math.abs(endR - bluntR) > 1e-6)
      throw new Error('stump end not blunt: r=' + endR + ' expected ' + bluntR);
    if (hadClub) {
      const bulb = game.props.soft.some(s => s[2] > boss.P.hipR * boss.radScale * .4);
      if (!bulb) throw new Error('club bulb did not drop with the severed tail');
    }
    if (hadSpikes && !game.props.hard.some(s => s[4] === 3))
      throw new Error('spikes did not drop with the severed tail');
    __drive(60); __checkFinite('severed');
  } else console.log('severed | (tailless species — skipped)');

  // 5b. crest break: head pool drained → stubs, shard props, exposed-skull bonus
  if (game.crestBroken) throw new Error('crest broke during ordinary combat');
  const hzHead0 = hzResolve('head', boss.headPos).mult;
  const propSoft0 = game.props ? game.props.soft.length : 0;
  const nodes0 = game.carveNodes.length;
  game.parts.head = 5;
  hitBoss(10, 'head', boss.headPos);
  if (!game.crestBroken || !boss.crestBroken) throw new Error('crest did not break');
  if (game.parts.head !== 0) throw new Error('head pool not zeroed: ' + game.parts.head);
  if (!game.props || game.props.soft.length < propSoft0 + 2)
    throw new Error('crest shards not dropped as props');
  if (game.carveNodes.length !== nodes0 + 1) throw new Error('no crest carve node');
  const hzHead1 = hzResolve('head', boss.headPos).mult;
  if (!(hzHead1 > hzHead0))
    throw new Error('broken crest did not expose the head: ' + hzHead0 + '→' + hzHead1);
  buildSkeleton(boss, 1 / 60);
  const stubCaps = [...boss.segs.soft, ...boss.segs.hard]
    .filter(s => s[5] === 'head' && (s[4] === 3 || s[4] === 5));
  if (stubCaps.length < 1) throw new Error('broken crest lost its stub capsules');
  __drive(30); __checkFinite('crest-break');

  // 5c. leg break: pool drained → limp, slowdown, visible fracture (bone spur)
  if (boss.limpLeg < 0) {
    game.parts.legs = 5;
    const speed0 = boss.P.speed;
    hitBoss(10, 'leg0', boss.chest);
    if (boss.limpLeg !== 0) throw new Error('leg did not break: ' + boss.limpLeg);
    if (!(boss.P.speed < speed0)) throw new Error('leg break did not slow the boss');
  }
  buildSkeleton(boss, 1 / 60);
  const spurs = boss.segs.hard.filter(s => s[5] === 'leg' + boss.limpLeg && s[4] === 5);
  if (spurs.length < 1) throw new Error('broken leg has no bone-spur capsule');
  __drive(30); __checkFinite('leg-break');

  // 5d. real mouth: tooth rows ride the mandible, dark maw shows through the gape,
  // and the bite gapes through the wind-up then chomps shut on the strike
  if (boss.P.jaw) {
    boss.act = null; boss.pant = 0; boss.pantTgt = 0;
    boss.jawEnv = 1; buildSkeleton(boss, 1 / 60);
    const teeth = boss.segs.hard.filter(s => s[5] === 'head' && s[4] === 7);
    if (boss.P.teeth && teeth.length < 4)
      throw new Error('mouth has too few teeth: ' + teeth.length);
    if (!boss.segs.soft.some(s => s[5] === 'head' && s[4] === 8))
      throw new Error('open mouth shows no maw');
    boss.jawEnv = 0; buildSkeleton(boss, 1 / 60);
    if (boss.segs.soft.some(s => s[5] === 'head' && s[4] === 8))
      throw new Error('closed mouth still shows the maw');
    // a fresh, non-panting boss: exhaustion legitimately holds the mouth open
    game.ai.state = 'hunt'; game.ai.tiredT = 0; game.ai.stam = 100;
    boss.restOn = false; boss.pant = 0; boss.pantTgt = 0;
    startStrike(boss, { wind: .3, active: .2, rec: .3, imp: 0, jaw: 1, recoil: 0 });
    __drive(10);
    if (boss.jawEnv < .45) throw new Error('bite wind-up did not gape: ' + boss.jawEnv);
    __drive(26);
    if (boss.jawEnv > .25) throw new Error('bite did not snap shut: ' + boss.jawEnv);
    boss.act = null;
    __drive(30); __checkFinite('mouth');
  } else console.log('mouth | (jawless species — skipped)');

  // 5e. wing break: webbing torn on the struck side, grounded for good, and a
  // mid-air break crashes the monster down into a knockdown opening
  if (SPECIES.wings) {
    // spread the wings: folded sails hug the flank, where the body wins the probe
    boss.wOpen = 1; boss.flap = 0;
    buildSkeleton(boss, 1 / 60);
    // intact wings carry a solid sail, and the sail itself is a hitbox
    if (!boss.segs.wingStrip[0] || !boss.segs.wingStrip[0].th || !boss.segs.wingStrip[1])
      throw new Error('intact wings missing their membrane sail');
    const q = boss.segs.wingStrip[0].pts;
    const midSail = scl(add(add(q[0], q[1]), q[2]), 1 / 3);
    const hitSail = nearestPart(midSail, boss.segs);
    if (hitSail.tag !== 'wing0')
      throw new Error('membrane sail not hittable, tagged: ' + hitSail.tag);
    const nodesW = game.carveNodes.length;
    game.parts.wings = 5;
    boss.air = .6; // mid-swoop when the wing gives out
    hitBoss(10, 'wing1', boss.chest);
    if (!game.wingBroken || !boss.wingBroken) throw new Error('wing did not break');
    if (boss.brokenWingS !== -1) throw new Error('broken wing side not recorded');
    if (boss.flyOK) throw new Error('broken wing left flyOK on');
    if (game.ai.state !== 'tired') throw new Error('mid-air wing break did not crash the boss');
    if (game.carveNodes.length !== nodesW + 1) throw new Error('no wing carve node');
    buildSkeleton(boss, 1 / 60);
    if (boss.segs.wingStrip[1]) throw new Error('broken wing kept its membrane sail');
    if (!boss.segs.wingStrip[0]) throw new Error('intact wing lost its membrane sail');
    if (!boss.segs.soft.some(s => s[5] === 'wing1'))
      throw new Error('broken wing has no rag strands');
    flee();
    if (boss.flyOK) throw new Error('broken-winged boss still flies to safety');
    game.ai.fled = false; game.ai.state = 'hunt'; game.ai.tiredT = 0;
    boss.restOn = false; boss.air = 0; boss.pantTgt = 0;
    __drive(30); __checkFinite('wing-break');
  } else console.log('wing-break | (wingless species — skipped)');

  // capsule budget: player + boss (mouth open, all break extras) must fit the buffer
  boss.jawEnv = 1;
  buildSkeleton(player, 1 / 60); buildSkeleton(boss, 1 / 60);
  const capsUsed = player.segs.soft.length + player.segs.hard.length
                 + boss.segs.soft.length + boss.segs.hard.length;
  if (capsUsed > MAXN) throw new Error('capsule budget blown: ' + capsUsed + '/' + MAXN);
  console.log('capsules:', capsUsed + '/' + MAXN);
  boss.jawEnv = 0;

  // 6. boss slam event sanity (enraged move) — force it
  game.ai.slamCool = -1; game.ai.atkCool = 9; game.ai.chargeCool = 9;
  player.leader = [boss.leader[0] + 3, player.P.chestH, boss.leader[2]];
  player.sodChest.reset(player.leader);
  __drive(200); __checkFinite('post-slam');

  // 7. kill + corpse carve
  // hitzone mults can be <1 (plated head 0.7) — overkill so any zone still kills
  hitBoss(boss.hp * 4 + 200, 'head', boss.chest);
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
  // hard-reset: earlier __drive segments can stochastically faint the hunter
  game.over = false; boss.dead = false; game.failed = false; game.faints = 0;
  player.dead = false; player.hp = player.maxHp; player.iFrames = 0;
  hurtPlayer(500, boss.leader);
  if (game.faints !== 1) throw new Error('faint not counted');
  __drive(200);
  if (player.hp <= 0 || player.dead) throw new Error('player did not respawn');
  player.iFrames = 0; hurtPlayer(500, boss.leader);
  __drive(200); player.iFrames = 0; hurtPlayer(500, boss.leader);
  if (!game.failed) throw new Error('quest did not fail after 3 faints');
  __drive(60); __checkFinite('failed');

  // 9. anatomy landmarks: every species rolls a head tell; skeleton emits it
  if (!SPECIES.lmHead) throw new Error('SPECIES.lmHead missing (generator landmark)');
  if (!['crown', 'fan', 'brow'].includes(SPECIES.lmHead))
    throw new Error('bad lmHead: ' + SPECIES.lmHead);
  if (SPECIES.tailMul > 0 && !SPECIES.lmTail)
    throw new Error('tailed species missing lmTail');
  if (typeof SPECIES.lmBack !== 'boolean') throw new Error('SPECIES.lmBack missing');
  if (boss.P.lmHead !== SPECIES.lmHead) throw new Error('boss.P.lmHead not wired');
  // rebuild once and assert landmark capsules (mat 3/5 on tagged head/tail)
  buildSkeleton(boss, 1 / 60);
  const all = [...boss.segs.soft, ...boss.segs.hard];
  const headLM = all.filter(s => s[5] === 'head' && (s[4] === 3 || s[4] === 5));
  if (headLM.length < 1)
    throw new Error('no head landmark capsules (mat 3/5) for lmHead=' + SPECIES.lmHead);
  // a severed stump must have LOST its tip landmark — it left with the piece
  if (SPECIES.lmTail === 'band') {
    const bands = all.filter(s => s[5] === 'tail' && s[4] === 5);
    if (game.severed) {
      if (bands.length) throw new Error('severed stump kept its band accents');
    } else if (bands.length < 1) throw new Error('lmTail=band emitted no accent band capsules');
  }
  if (SPECIES.lmTail === 'club') {
    if (game.severed) {
      if (boss.P.tailClub) throw new Error('severed stump kept tailClub');
    } else if (!boss.P.tailClub) throw new Error('lmTail=club did not set tailClub');
  }
  if (SPECIES.lmBack && !boss.P.plates)
    throw new Error('lmBack did not enable plates');
  // hitBoss records part tag for flash zones
  const prev = game.lastHit;
  hitBoss(1, 'head', boss.headPos);
  if (!game.lastHit || game.lastHit.tag !== 'head')
    throw new Error('hitBoss head did not set lastHit.tag=head');
  hitBoss(1, 'tail', boss.chest);
  if (game.lastHit.tag !== 'tail') throw new Error('hitBoss tail lastHit failed');
  hitBoss(1, 'leg0', boss.chest);
  if (game.lastHit.tag !== 'leg0') throw new Error('hitBoss leg lastHit failed');
  game.lastHit = prev;
  console.log('landmarks:', SPECIES.lmHead, SPECIES.lmTail || '-', 'back=' + SPECIES.lmBack,
    '| head caps:', headLM.length);

  // 10. hitzones: plated bounce, belly amp, tired softening
  if (!SPECIES.hz || typeof SPECIES.hz.body !== 'number')
    throw new Error('SPECIES.hz missing after generator');
  for (const k of ['head', 'body', 'legs', 'tail', 'belly'])
    if (typeof SPECIES.hz[k] !== 'number') throw new Error('SPECIES.hz.' + k + ' missing');
  // force plated profile for deterministic bounce/belly/tired checks
  const hzPrev = Object.assign({}, SPECIES.hz);
  const platedPrev = SPECIES.plated, softPrev = SPECIES.softBelly;
  const aiPrev = game.ai.state, stamPrev = game.ai.stam, softLogPrev = game.tiredSoftLog;
  SPECIES.hz = { head: 0.7, body: 0.45, legs: 1, tail: 1.1, belly: 1.35 };
  SPECIES.plated = true; SPECIES.softBelly = false;
  game.ai.state = 'hunt'; game.tiredSoftLog = false;
  boss.dead = false; game.over = false; boss.hp = Math.max(boss.hp, 200);
  // body hit above spine → bounce: reduced dmg, no stam drain
  const bodyPos = [boss.chest[0], boss.chest[1] + 0.4, boss.chest[2]];
  const hpB = boss.hp, stamB = game.ai.stam;
  hitBoss(20, 'body', bodyPos);
  const bodyDmg = hpB - boss.hp;
  if (bodyDmg >= 20) throw new Error('plated body hit not reduced: dmg=' + bodyDmg);
  if (bodyDmg !== Math.round(20 * 0.45))
    throw new Error('plated body mult wrong: dmg=' + bodyDmg + ' expected ' + Math.round(20 * 0.45));
  if (game.ai.stam !== stamB)
    throw new Error('bounce drained stamina: ' + stamB + '→' + game.ai.stam);
  if (!game.lastHit || !game.lastHit.bounce)
    throw new Error('bounce path did not set lastHit.bounce');
  // belly hit below spine midline → amplified
  const midY = Math.min(boss.chest[1], boss.hip[1]) - 0.35;
  const bellyPos = [boss.chest[0], midY, boss.chest[2]];
  const hpL = boss.hp;
  hitBoss(20, 'body', bellyPos);
  const bellyDmg = hpL - boss.hp;
  if (bellyDmg <= bodyDmg)
    throw new Error('belly hit not amplified vs body: belly=' + bellyDmg + ' body=' + bodyDmg);
  if (bellyDmg !== Math.round(20 * 1.35))
    throw new Error('belly mult wrong: dmg=' + bellyDmg);
  if (game.lastHit.bounce) throw new Error('belly hit should not bounce');
  // tired: plated body softens (floor 0.9) then ×1.4 exhaust bonus
  game.ai.state = 'tired'; game.tiredSoftLog = false;
  const hpT = boss.hp, stamT = game.ai.stam;
  hitBoss(20, 'body', bodyPos);
  const tiredDmg = hpT - boss.hp;
  const expectTired = Math.round(20 * 0.9 * 1.4);
  if (tiredDmg !== expectTired)
    throw new Error('tired soften dmg=' + tiredDmg + ' expected ' + expectTired);
  if (tiredDmg <= bodyDmg)
    throw new Error('tired plated hit should exceed bounce dmg');
  if (game.lastHit.bounce)
    throw new Error('tired soft hit should not be bounce path');
  if (game.ai.stam >= stamT)
    throw new Error('tired soft hit should drain stamina');
  // restore
  SPECIES.hz = hzPrev; SPECIES.plated = platedPrev; SPECIES.softBelly = softPrev;
  game.ai.state = aiPrev; game.ai.stam = stamPrev; game.tiredSoftLog = softLogPrev;
  console.log('hitzones: body', bodyDmg, 'belly', bellyDmg, 'tired', tiredDmg,
    '| rolled body mult', hzPrev.body);

  console.log('HUNT SMOKE OK');
`, ctx, { filename: 'hunt-driver.js' });

// SCENERY_FORCE self-test: re-run the page VM per biome and assert 1–16
// finite mat-9 hard scenery caps (HIDEF is false in the WebGL stub).
// const/let page bindings are not sandbox properties — read them via runInContext.
{
  const biomeKeys = ['crater', 'dunes', 'marsh', 'tundra', 'ember'];
  const seed = 7;
  for (const bk of biomeKeys) {
    const sctx = {
      console: { log() {}, warn() {}, error: console.error },
      Math: seededMath, JSON, Float32Array, Map, Set, Proxy, Error, String,
      __TEST_SEED: seed,
      __TEST_BIOME: bk,
      SCENERY_FORCE: true,
      document: {
        getElementById: id => (id === 'gl' ? canvas : makeEl()),
        querySelectorAll: () => [],
        createElement: () => makeEl(),
      },
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
      performance: { now: () => 0 },
      requestAnimationFrame: () => {},
      __t: 0, __raf: null, __timers: [],
    };
    sctx.setTimeout = () => 0;
    sctx.clearTimeout = () => {};
    vm.createContext(sctx);
    vm.runInContext(js, sctx, { filename: 'hunt-scenery-' + bk + '.js' });
    const report = vm.runInContext(`({
      key: BIOME_KEY,
      n: SCENERY_N,
      hardN: game.props && game.props.hard ? game.props.hard.length : 0,
      hard: game.props && game.props.hard ? game.props.hard : [],
    })`, sctx);
    if (report.key !== bk)
      throw new Error('scenery: __TEST_BIOME ignored, got ' + report.key + ' want ' + bk);
    if (report.hardN < 1 || report.hardN > 16)
      throw new Error('scenery ' + bk + ': hard cap count ' + report.hardN + ' not in 1–16');
    if (report.n !== report.hardN)
      throw new Error('scenery ' + bk + ': SCENERY_N=' + report.n + ' vs hard=' + report.hardN);
    for (const s of report.hard) {
      if (s[4] !== 9) throw new Error('scenery ' + bk + ': expected mat 9, got ' + s[4]);
      if (s[5] !== 'scenery') throw new Error('scenery ' + bk + ': expected tag scenery, got ' + s[5]);
      for (const v of [s[0], s[1]])
        if (!v || !v.every(Number.isFinite))
          throw new Error('scenery ' + bk + ': non-finite endpoint');
      if (!Number.isFinite(s[2]) || !Number.isFinite(s[3]))
        throw new Error('scenery ' + bk + ': non-finite radius');
    }
    console.log('scenery', bk + ':', report.hardN, 'hard caps');
  }
  console.log('SCENERY SELF-TEST OK');
}

// SAGA self-test: quest scaling, the fable finale, and the forge economy.
{
  const mk = (extra) => {
    const c = {
      console: { log() {}, warn() {}, error: console.error },
      Math: seededMath, JSON, Float32Array, Map, Set, Proxy, Error, String,
      document: {
        getElementById: id => (id === 'gl' ? canvas : makeEl()),
        querySelectorAll: () => [],
        createElement: () => makeEl(),
        body: makeEl(),
      },
      matchMedia: () => ({ matches: false }),
      addEventListener() {},
      innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
      performance: { now: () => 0 },
      requestAnimationFrame: () => {},
      setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
      ...extra,
    };
    vm.createContext(c);
    vm.runInContext(js, c, { filename: 'hunt-saga.js' });
    return c;
  };
  const read = (c, expr) => vm.runInContext(expr, c);

  const q1 = mk({ __TEST_SEED: 7, __TEST_QUEST: '1' });
  const q5 = mk({ __TEST_SEED: 7, __TEST_QUEST: '5' });
  if (!(read(q5, 'SPECIES.hp') > read(q1, 'SPECIES.hp')))
    throw new Error('saga: quest 5 hp not above quest 1');
  if (!(read(q5, 'AIP.biteDmg') > read(q1, 'AIP.biteDmg')))
    throw new Error('saga: quest 5 bite not above quest 1');
  if (read(q1, 'BIOME_KEY') !== 'crater' || read(q5, 'BIOME_KEY') !== 'ember')
    throw new Error('saga: quest biomes not wired');
  if (read(q1, 'game.board') !== false) throw new Error('saga: board mode leaked into quest');

  const fb = mk({ __TEST_QUEST: 'fable' });
  if (read(fb, 'SPECIES.name') !== 'FABLE, THE LAST EMBER') throw new Error('saga: fable name');
  if (read(fb, 'SPECIES.base') !== 'rathalos') throw new Error('saga: fable base ' + read(fb, 'SPECIES.base'));
  if (read(fb, 'SPECIES.pal') !== 'fable' || !read(fb, 'PALETTES.fable')) throw new Error('saga: fable palette');
  if (read(fb, 'SEED') !== 699) throw new Error('saga: fable seed');
  if (!read(fb, 'SPECIES.wings')) throw new Error('saga: fable must fly');

  // forge economy math
  read(fb, 'bankItem("TEST SCALE ×2"); bankItem("TEST PLATE — RARE!"); bankItem("TEST FANG")');
  if (read(fb, 'SG.inv.scale') !== 2 || read(fb, 'SG.inv.relic') !== 1 || read(fb, 'SG.inv.fang') !== 1)
    throw new Error('saga: banking math ' + read(fb, 'JSON.stringify(SG.inv)'));
  if (read(fb, 'canAfford({scale:3})') !== false) throw new Error('saga: canAfford false-positive');
  read(fb, 'SG.inv.scale=10');
  if (read(fb, 'canAfford({scale:4})') !== true) throw new Error('saga: canAfford false-negative');
  read(fb, 'payCost({scale:4})');
  if (read(fb, 'SG.inv.scale') !== 6) throw new Error('saga: payCost math');
  if (!read(fb, 'WPN.every((w,i)=>!i||w.mul>WPN[i-1].mul)')) throw new Error('saga: WPN not monotonic');
  read(fb, 'SG.wTier=2;SG.aTier=1;syncTiers()');
  if (read(fb, 'WTIER') !== 2 || read(fb, 'ATIER') !== 1) throw new Error('saga: tier sync');
  // armor: 50 raw through 38% plate = 31
  read(fb, 'SG.aTier=3; player.iFrames=0; player.hp=100; hurtPlayer(50,null)');
  if (read(fb, 'player.hp') !== 69) throw new Error('saga: armor math, hp=' + read(fb, 'player.hp'));
  console.log('SAGA SELF-TEST OK | fable seed 699 · forge + banking + armor verified');
}
