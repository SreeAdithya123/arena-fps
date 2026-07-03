// Simulation entry point. createSim/simTick/respawnPlayer are the whole API —
// a headless server can drive this loop with per-tick input commands.
// simTick returns an event list; the renderer and HUD consume events, never
// the other way around.

import { DT, mulberry32, aimDir, coneSpread, raySphere, rayAABB } from './math.js';
import { ARENA, raycastArena } from './arena.js';
import { makePlayer, playerMove, eyePos } from './player.js';
import { WEAPONS, makeWeaponState, weaponTick, currentSpread } from './weapons.js';
import { makeBot, botTick, damageBot, botHead, botBodyAABB, BOT_HEAD_R } from './bots.js';

export { DT } from './math.js';
export { WEAPONS } from './weapons.js';
export { ARENA } from './arena.js';
export { eyePos } from './player.js';
export { currentSpread } from './weapons.js';

export function createSim(seed = 1) {
  return {
    tick: 0,
    rng: mulberry32(seed),
    player: makePlayer(),
    bots: ARENA.botSpawns.map((s, i) => makeBot(i, s)),
    kills: 0,
    deaths: 0,
    spawnIndex: 0,
  };
}

export function respawnPlayer(state, weaponId, spawnOverride = null) {
  const p = state.player;
  const spawn = spawnOverride || ARENA.playerSpawns[state.spawnIndex % ARENA.playerSpawns.length];
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
    playerMove(p, cmd, DT);

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

function resolveShot(state, events) {
  const p = state.player;
  const w = p.weapon;
  const def = WEAPONS[w.id];
  const origin = eyePos(p);

  // shot direction = view + current recoil offset + spread cone
  const spread = currentSpread(w, p.moveFrac, !p.onGround, p.crouched, p.aiming);
  const base = aimDir(p.yaw + w.recoilYaw, p.pitch + w.recoilPitch);
  const dir = coneSpread(base, spread, state.rng);

  const RANGE = 90;
  const world = raycastArena(origin, dir, RANGE);
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

  const end = {
    x: origin.x + dir.x * tBest,
    y: origin.y + dir.y * tBest,
    z: origin.z + dir.z * tBest,
  };

  const ev = {
    type: 'shot', weapon: w.id, origin, dir, end,
    hit: hitBot ? 'bot' : world && tBest === world.t ? 'world' : 'none',
    mat: !hitBot && world && tBest === world.t ? world.mat : null,
    headshot: false, killed: false, damage: 0, botId: -1,
  };

  if (hitBot) {
    const dmg = Math.round(def.damage * (headshot ? def.headMult : 1));
    ev.headshot = headshot;
    ev.damage = dmg;
    ev.botId = hitBot.id;
    ev.killed = damageBot(hitBot, dmg, state, events, headshot);
  }

  events.push(ev);
}
