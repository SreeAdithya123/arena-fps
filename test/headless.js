// Headless sim verification — runs the simulation in Node with zero rendering.
// Proves the server seam: same seed + same commands => identical state.
import { createSim, simTick, respawnPlayer, eyePos } from '../src/sim/sim.js';
import { yawPitchTo } from '../src/sim/math.js';

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  — ' + detail}`);
  if (!cond) failures++;
}

const IDLE = { yaw: 0, pitch: 0, mx: 0, mz: 0, jumpEdge: false, crouch: false, sprint: false, aim: false, fire: false, fireEdge: false, reload: false };
const cmd = (o = {}) => ({ ...IDLE, ...o });

// --- 1. Determinism: two sims, same seed, same script, identical state ---
function runScript(seed) {
  const s = createSim(seed);
  respawnPlayer(s, 'ar');
  const log = [];
  for (let t = 0; t < 600; t++) {
    const c =
      t < 120 ? cmd({ mz: 1, sprint: true }) :
      t < 180 ? cmd({ mz: 1, jumpEdge: t === 120 }) :
      t < 300 ? cmd({ yaw: 0.8, fire: true }) :
      t < 360 ? cmd({ yaw: 0.8, reload: t === 300 }) :
      cmd({ mx: 1, crouch: true });
    simTick(s, c);
    if (t % 100 === 0) log.push(JSON.stringify([s.player.pos, s.player.health, s.bots.map(b => [b.pos, b.health])]));
  }
  return { s, log: log.join('|') };
}
const a = runScript(1337), b = runScript(1337);
check('determinism: same seed + same inputs => identical state', a.log === b.log);
const c2 = runScript(99);
check('different seed diverges (rng actually used)', a.log !== c2.log);

// --- 2. Movement (bots removed so the test player isn't shot mid-script) ---
{
  const s = createSim(1);
  s.bots.length = 0;
  const spawn = respawnPlayer(s, 'ar');
  const z0 = s.player.pos.z, x0 = s.player.pos.x;
  for (let t = 0; t < 60; t++) simTick(s, cmd({ yaw: spawn.yaw, mz: 1 }));
  const moved = Math.hypot(s.player.pos.x - x0, s.player.pos.z - z0);
  check('walk: ~5.2 m/s for 1s', moved > 4.0 && moved < 6.0, `moved ${moved.toFixed(2)}m`);

  for (let t = 0; t < 60; t++) simTick(s, cmd());
  const speed = Math.hypot(s.player.vel.x, s.player.vel.z);
  check('release keys: player stops', speed < 0.05, `residual speed ${speed.toFixed(3)}`);

  let leftGround = false, peak = 0;
  for (let t = 0; t < 90; t++) {
    simTick(s, cmd({ jumpEdge: t === 0 }));
    if (!s.player.onGround) leftGround = true;
    peak = Math.max(peak, s.player.pos.y);
  }
  check('jump: leaves ground, peaks ~1.3m, lands', leftGround && peak > 1.0 && peak < 1.7 && s.player.onGround, `peak ${peak.toFixed(2)} onGround ${s.player.onGround}`);

  simTick(s, cmd({ crouch: true }));
  check('crouch shrinks hull', s.player.height < 1.3, `h ${s.player.height}`);
  simTick(s, cmd());
  check('uncrouch restores hull', s.player.height > 1.7, `h ${s.player.height}`);
}

// --- 3. Walls contain the player ---
{
  const s = createSim(1);
  s.bots.length = 0;
  respawnPlayer(s, 'ar');
  for (let t = 0; t < 600; t++) simTick(s, cmd({ yaw: Math.PI, mz: 1, sprint: true })); // run south 10s
  const p = s.player.pos;
  check('perimeter wall stops the player', Math.abs(p.x) < 21 && Math.abs(p.z) < 21, `pos ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
}

// --- 4. Stairs: walk up onto the central platform ---
{
  const s = createSim(1);
  s.bots.length = 0;
  respawnPlayer(s, 'ar');
  s.player.pos = { x: -9.5, y: 0, z: 0 }; // west of platform stairs
  let maxY = 0;
  for (let t = 0; t < 240; t++) {
    simTick(s, cmd({ yaw: -Math.PI / 2, mz: 1 })); // face +X, walk east
    maxY = Math.max(maxY, s.player.pos.y);
  }
  check('stairs: step-up climbs the 1.6m platform and crosses it',
    maxY > 1.5 && s.player.pos.x > 6, `maxY ${maxY.toFixed(2)} x ${s.player.pos.x.toFixed(2)}`);
}

// --- 5. Hit detection: aimed shot damages a bot; kill increments counter ---
{
  const s = createSim(1);
  respawnPlayer(s, 'dmr');
  const bot = s.bots[0]; // spawns at (-16,0,-12), open floor around it
  s.bots = [bot];
  s.player.pos = { x: bot.pos.x, y: 0, z: bot.pos.z + 8 };
  simTick(s, cmd()); // settle one tick before aiming
  let hits = 0, kills = 0, headshots = 0;
  for (let t = 0; t < 240 && bot.alive; t++) {
    const aim = yawPitchTo(eyePos(s.player), { x: bot.pos.x, y: bot.pos.y + 1.0, z: bot.pos.z });
    const evs = simTick(s, cmd({ yaw: aim.yaw, pitch: aim.pitch, fire: true, fireEdge: t % 30 === 0 }));
    for (const e of evs) {
      if (e.type === 'shot' && e.hit === 'bot') { hits++; if (e.headshot) headshots++; }
      if (e.type === 'botdie') kills++;
    }
  }
  check('hitscan: shots register on bot', hits >= 2, `hits ${hits}`);
  check('bot dies and kill counts', kills === 1 && s.kills === 1, `kills ${kills}/${s.kills}`);
}

// --- 6. Headshot: aimed at head sphere pays multiplier ---
{
  const s = createSim(1);
  respawnPlayer(s, 'dmr');
  const bot = s.bots[0];
  s.bots = [bot];
  s.player.pos = { x: bot.pos.x, y: 0, z: bot.pos.z + 6 };
  simTick(s, cmd()); // settle one tick before aiming
  const aim = yawPitchTo(eyePos(s.player), { x: bot.pos.x, y: bot.pos.y + 1.62, z: bot.pos.z });
  const evs = simTick(s, cmd({ yaw: aim.yaw, pitch: aim.pitch, fireEdge: true, fire: true }));
  const shot = evs.find(e => e.type === 'shot');
  check('headshot detected with 2x damage (110)', shot && shot.headshot && shot.damage === 110, JSON.stringify(shot && { hit: shot.hit, hs: shot.headshot, dmg: shot.damage }));
}

// --- 7. Ammo + reload cycle ---
{
  const s = createSim(1);
  s.bots.length = 0;
  respawnPlayer(s, 'smg');
  const w = s.player.weapon;
  for (let t = 0; t < 200; t++) simTick(s, cmd({ fire: true }));
  check('mag drains and auto-reload starts', w.reloading || w.ammo === 36, `ammo ${w.ammo} reloading ${w.reloading}`);
  for (let t = 0; t < 120; t++) simTick(s, cmd());
  check('reload refills mag from reserve', w.ammo === 36 && w.reserve < 144, `ammo ${w.ammo} reserve ${w.reserve}`);
}

// --- 8. Bots fight back: standing in the open gets the player shot ---
{
  const s = createSim(7);
  respawnPlayer(s, 'ar');
  s.player.pos = { x: 0, y: 0, z: 8 }; // exposed mid-map
  let gotHit = false, botShots = 0;
  for (let t = 0; t < 600; t++) {
    for (const e of simTick(s, cmd())) {
      if (e.type === 'botshot') botShots++;
      if (e.type === 'playerhit') gotHit = true;
    }
  }
  check('bots spot exposed player and fire', botShots > 0, `botShots ${botShots}`);
  check('bot fire damages player', gotHit && s.player.health < 100, `hp ${s.player.health.toFixed(0)}`);
}

// --- 8.5 ADS: aiming tightens spread and slows movement ---
{
  const s = createSim(1);
  s.bots.length = 0;
  respawnPlayer(s, 'ar');
  simTick(s, cmd({ aim: true }));
  check('aim flag reaches the player', s.player.aiming === true);
  const { currentSpread } = await import('../src/sim/weapons.js');
  const w = s.player.weapon;
  const hip = currentSpread(w, 0, false, false, false);
  const ads = currentSpread(w, 0, false, false, true);
  check('ADS spread is tighter than hip fire', ads < hip * 0.6, `hip ${hip.toFixed(4)} ads ${ads.toFixed(4)}`);

  const z0 = s.player.pos.z;
  for (let t = 0; t < 60; t++) simTick(s, cmd({ mz: 1, aim: true }));
  const aimedDist = Math.abs(s.player.pos.z - z0);
  check('ADS movement is slowed (~60%)', aimedDist > 2.2 && aimedDist < 4.0, `moved ${aimedDist.toFixed(2)}m`);

  // sprint is blocked while aiming
  for (let t = 0; t < 30; t++) simTick(s, cmd({ mz: 1, aim: true, sprint: true }));
  check('sprint blocked while aiming', s.player.sprinting === false);
}

// --- 9. Player death + respawn with a different weapon ---
{
  const s = createSim(7);
  respawnPlayer(s, 'ar');
  s.player.health = 5;
  s.player.pos = { x: 0, y: 0, z: 8 };
  let died = false;
  for (let t = 0; t < 900 && !died; t++) {
    for (const e of simTick(s, cmd())) if (e.type === 'playerdie') died = true;
  }
  check('player can die to bots', died && !s.player.alive && s.deaths === 1);
  respawnPlayer(s, 'smg');
  check('respawn with new weapon works', s.player.alive && s.player.health === 100 && s.player.weapon.id === 'smg');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
