// Simulation entry point. createSim/simTick/respawnPlayer are the whole API —
// a headless server can drive this loop with per-tick input commands.
// simTick returns an event list; the renderer and HUD consume events, never
// the other way around.

import { DT, mulberry32, aimDir, coneSpread, raySphere, rayAABB } from './math.js';
import { MAPS, DEFAULT_MAP, raycastArena } from './arena.js';
import { makePlayer, playerMove, eyePos } from './player.js';
import { WEAPONS, makeWeaponState, weaponTick, currentSpread, falloff } from './weapons.js';
import { makeBot, botTick, damageBot, botHead, botBodyAABB, BOT_HEAD_R } from './bots.js';

export { DT } from './math.js';
export { WEAPONS } from './weapons.js';
export { MAPS, MAP_LIST, DEFAULT_MAP } from './arena.js';
export { eyePos } from './player.js';
export { currentSpread } from './weapons.js';

export function createSim(seed = 1, mapId = DEFAULT_MAP) {
  const map = MAPS[mapId] || MAPS[DEFAULT_MAP];
  return {
    tick: 0,
    rng: mulberry32(seed),
    map,
    mapId: map.id,
    player: makePlayer(),
    bots: map.botSpawns.map((s, i) => makeBot(i, s, map)),
    kills: 0,
    deaths: 0,
    spawnIndex: 0,
  };
}

export function respawnPlayer(state, weaponId, spawnOverride = null) {
  const p = state.player;
  const spawn = spawnOverride || state.map.playerSpawns[state.spawnIndex % state.map.playerSpawns.length];
  state.spawnIndex++;
  p.pos = { ...spawn.pos };
  p.vel = { x: 0, y: 0, z: 0 };
  p.yaw = spawn.yaw;
  p.pitch = 0;
  p.health = 100;
  p.regenT = 0;
  p.alive = true;
  p.weapon = makeWeaponState(weaponId);
  return spawn;
}

export function simTick(state, cmd) {
  const events = [];
  state.tick++;
  const p = state.player;

  if (p.alive) {
    playerMove(p, cmd, state.map, DT);

    // health regen after 5s without damage
    p.regenT = Math.max(0, p.regenT - DT);
    if (p.regenT === 0 && p.health < 100) p.health = Math.min(100, p.health + 12 * DT);

    const w = p.weapon;
    const wasReloading = w.reloading;
    const fired = weaponTick(w, cmd.fire, cmd.fireEdge, cmd.reload, DT);
    if (!wasReloading && w.reloading) events.push({ type: 'reload' });
    if (fired) resolveShot(state, events);
  }

  for (const bot of state.bots) botTick(bot, state, events, state.rng, DT);

  if (p.alive && p.health <= 0) {
    p.alive = false;
    state.deaths++;
    events.push({ type: 'playerdie' });
  }

  return events;
}

// One trigger pull. Fires def.pellets rays (1 for everything but the shotgun),
// aggregates damage per target, and emits a single 'shot' event:
//   { type, weapon, origin, dir, pellets: [{dir, end, hit, mat}], hits: [{botId, damage, headshot, killed}] }
function resolveShot(state, events) {
  const p = state.player;
  const w = p.weapon;
  const def = WEAPONS[w.id];
  const origin = eyePos(p);
  const RANGE = 90;

  const spread = currentSpread(w, p.moveFrac, !p.onGround, p.crouched, p.aiming);
  const base = aimDir(p.yaw + w.shotYaw, p.pitch + w.shotPitch);
  const pelletCount = def.pellets || 1;

  const pellets = [];
  const botDamage = new Map(); // bot -> { damage, headshot }

  for (let i = 0; i < pelletCount; i++) {
    const dir = coneSpread(base, spread, state.rng);
    const world = raycastArena(state.map, origin, dir, RANGE);
    let tBest = world ? world.t : RANGE;
    let hitBot = null, headshot = false;

    for (const bot of state.bots) {
      if (!bot.alive) continue;
      const tHead = raySphere(origin, dir, botHead(bot), BOT_HEAD_R, tBest);
      if (tHead < tBest) { tBest = tHead; hitBot = bot; headshot = true; continue; }
      const body = botBodyAABB(bot);
      const tBody = rayAABB(origin, dir, body.min, body.max, tBest);
      if (tBody < tBest) { tBest = tBody; hitBot = bot; headshot = false; }
    }

    pellets.push({
      dir,
      end: { x: origin.x + dir.x * tBest, y: origin.y + dir.y * tBest, z: origin.z + dir.z * tBest },
      hit: hitBot ? 'bot' : world && tBest === world.t ? 'world' : 'none',
      mat: !hitBot && world && tBest === world.t ? world.mat : null,
    });

    if (hitBot) {
      const dmg = def.damage * (headshot ? def.headMult : 1) * falloff(def, tBest);
      const agg = botDamage.get(hitBot) || { damage: 0, headshot: false };
      agg.damage += dmg;
      agg.headshot = agg.headshot || headshot;
      botDamage.set(hitBot, agg);
    }
  }

  const hits = [];
  for (const [bot, agg] of botDamage) {
    const dmg = Math.max(1, Math.round(agg.damage));
    const killed = damageBot(bot, dmg, state, events, agg.headshot);
    hits.push({ botId: bot.id, damage: dmg, headshot: agg.headshot, killed });
  }

  events.push({ type: 'shot', weapon: w.id, origin, dir: base, pellets, hits });
}
