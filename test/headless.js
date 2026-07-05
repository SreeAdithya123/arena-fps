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
  let hits = 0, kills = 0;
  for (let t = 0; t < 240 && bot.alive; t++) {
    const aim = yawPitchTo(eyePos(s.player), { x: bot.pos.x, y: bot.pos.y + 1.0, z: bot.pos.z });
    const evs = simTick(s, cmd({ yaw: aim.yaw, pitch: aim.pitch, fire: true, fireEdge: t % 30 === 0 }));
    for (const e of evs) {
      if (e.type === 'shot' && e.hits.length) hits++;
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
  const h = shot && shot.hits[0];
  check('headshot detected with 2x damage (110)', !!h && h.headshot && h.damage === 110, JSON.stringify(h));
}

// --- 6.5 Shotgun: pellets, close one-shot, distance falloff ---
{
  const s = createSim(1);
  respawnPlayer(s, 'shotgun');
  const bot = s.bots[0];
  s.bots = [bot];
  s.player.pos = { x: bot.pos.x, y: 0, z: bot.pos.z + 3 };
  simTick(s, cmd());
  let aim = yawPitchTo(eyePos(s.player), { x: bot.pos.x, y: bot.pos.y + 1.0, z: bot.pos.z });
  let evs = simTick(s, cmd({ yaw: aim.yaw, pitch: aim.pitch, fireEdge: true, fire: true }));
  let shot = evs.find(e => e.type === 'shot');
  check('shotgun fires 8 pellets per trigger pull', !!shot && shot.pellets.length === 8, shot && shot.pellets.length);
  check('shotgun one-shots at 3m', !!shot && shot.hits.length === 1 && shot.hits[0].killed,
    JSON.stringify(shot && shot.hits));

  // at 18m the pattern spreads and falloff bites: never a one-shot kill
  const s2 = createSim(3);
  respawnPlayer(s2, 'shotgun');
  const bot2 = s2.bots[0];
  s2.bots = [bot2];
  s2.player.pos = { x: bot2.pos.x, y: 0, z: bot2.pos.z + 18 };
  simTick(s2, cmd());
  aim = yawPitchTo(eyePos(s2.player), { x: bot2.pos.x, y: bot2.pos.y + 1.0, z: bot2.pos.z });
  evs = simTick(s2, cmd({ yaw: aim.yaw, pitch: aim.pitch, fireEdge: true, fire: true, aim: true }));
  shot = evs.find(e => e.type === 'shot');
  const dmg18 = shot && shot.hits.length ? shot.hits[0].damage : 0;
  check('shotgun falls off hard at 18m (no one-shot)', bot2.alive && dmg18 < 60, `dmg ${dmg18} alive ${bot2.alive}`);
}

// --- 6.6 Sniper: one body shot kills ---
{
  const s = createSim(1);
  respawnPlayer(s, 'sniper');
  const bot = s.bots[3]; // (14, 2) — the x=14 lane is clear at eye height
  s.bots = [bot];
  s.player.pos = { x: bot.pos.x, y: 0, z: bot.pos.z + 18 };
  simTick(s, cmd({ aim: true }));
  const aim = yawPitchTo(eyePos(s.player), { x: bot.pos.x, y: bot.pos.y + 1.0, z: bot.pos.z });
  const evs = simTick(s, cmd({ yaw: aim.yaw, pitch: aim.pitch, fireEdge: true, fire: true, aim: true }));
  const shot = evs.find(e => e.type === 'shot');
  check('sniper one-shots the body at 18m while scoped',
    !!shot && shot.hits.length === 1 && shot.hits[0].killed && shot.hits[0].damage === 105,
    JSON.stringify(shot && shot.hits));
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

// --- 10. Map flow: bot patrol coverage, spawn walk-out, spawn-camp safety ---
{
  const { MAPS } = await import('../src/sim/arena.js');
  const { raycastArena } = await import('../src/sim/arena.js');

  for (const mapId of ['depot', 'compound', 'pipeline']) {
    const map = MAPS[mapId];

    // bots patrol without getting stuck or escaping the world (60 sim-seconds)
    const s = createSim(5, mapId); // player never spawns -> pure patrol
    const travel = s.bots.map(() => 0);
    const prev = s.bots.map((b) => ({ ...b.pos }));
    for (let t = 0; t < 3600; t++) {
      simTick(s, cmd());
      for (let i = 0; i < s.bots.length; i++) {
        const b = s.bots[i];
        travel[i] += Math.hypot(b.pos.x - prev[i].x, b.pos.z - prev[i].z);
        prev[i] = { ...b.pos };
      }
    }
    const minTravel = Math.min(...travel);
    const inBounds = s.bots.every((b) =>
      b.pos.x > map.bounds.min.x - 1 && b.pos.x < map.bounds.max.x + 1 &&
      b.pos.z > map.bounds.min.z - 1 && b.pos.z < map.bounds.max.z + 1 && b.pos.y > -0.5);
    check(`${mapId}: bots patrol freely (min ${minTravel.toFixed(0)}m in 60s)`, minTravel > 40 && inBounds,
      `travel ${travel.map((d) => d.toFixed(0)).join('/')} inBounds ${inBounds}`);

    // every team spawn lets you walk forward out of it
    let stuck = [];
    for (const team of ['red', 'blue']) {
      for (const [i, sp] of map.teamSpawns[team].entries()) {
        const s2 = createSim(2, mapId);
        s2.bots.length = 0;
        respawnPlayer(s2, 'ar', sp);
        const from = { ...s2.player.pos };
        for (let t = 0; t < 90; t++) simTick(s2, cmd({ yaw: sp.yaw, mz: 1 }));
        const moved = Math.hypot(s2.player.pos.x - from.x, s2.player.pos.z - from.z);
        if (moved < 3) stuck.push(`${team}[${i}] moved ${moved.toFixed(1)}m`);
      }
    }
    check(`${mapId}: all team spawns walk out cleanly`, stuck.length === 0, stuck.join(', '));

    // spawn-camp safety: no red spawn has eye-level LOS to any blue spawn
    const seen = [];
    for (const r of map.teamSpawns.red) {
      for (const b of map.teamSpawns.blue) {
        const from = { x: r.pos.x, y: r.pos.y + 1.63, z: r.pos.z };
        const to = { x: b.pos.x, y: b.pos.y + 1.63, z: b.pos.z };
        const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
        const len = Math.hypot(d.x, d.y, d.z);
        d.x /= len; d.y /= len; d.z /= len;
        if (raycastArena(map, from, d, len) === null) {
          seen.push(`(${r.pos.x},${r.pos.z})->(${b.pos.x},${b.pos.z})`);
        }
      }
    }
    check(`${mapId}: no spawn-to-spawn sightlines`, seen.length === 0, seen.slice(0, 3).join(' '));
  }
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
