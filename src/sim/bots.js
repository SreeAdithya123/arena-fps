// Bot behavior: patrol waypoints, spot the player, strafe and burst-fire back.
// Deliberately dumb — the point is having something to shoot that shoots back.

import { raycastArena } from './arena.js';
import { slideMove } from './player.js';
import { eyePos } from './player.js';
import { dist2d, dist3d, yawPitchTo, aimDir, coneSpread, deg, rayAABB } from './math.js';

const BOT_SPEED = 3.2;
const BOT_STRAFE_SPEED = 2.6;
const BOT_HEIGHT = 1.7;
const BOT_EYE = 1.55;
export const BOT_HEAD_R = 0.24;
export const BOT_HEAD_Y = 1.62;   // head sphere center above feet
const SIGHT_RANGE = 32;
const SPOT_TIME = 0.45;
const TURN_RATE = 5.5;
const BURST_SIZE = 4;
const BURST_INTERVAL = 0.13;
const BURST_PAUSE = 1.05;
const BOT_DAMAGE = 7;
const BOT_SPREAD = deg(2.6);
const RESPAWN_TIME = 4;

export function makeBot(id, spawn, map) {
  return {
    id,
    spawn: { ...spawn },
    pos: { x: spawn.x, y: spawn.y, z: spawn.z },
    vel: { x: 0, y: 0, z: 0 },
    half: { x: 0.35, z: 0.35 },
    height: BOT_HEIGHT,
    onGround: true,
    yaw: 0,
    health: 100,
    alive: true,
    respawnT: 0,
    wpIndex: (id * 3) % map.waypoints.length,
    spot: 0,
    burstLeft: 0,
    fireT: 0,
    strafeDir: 1,
    strafeT: 0,
    lastSeenT: 99,
    stuckT: 0,
    lastX: spawn.x,
    lastZ: spawn.z,
  };
}

export function botEye(bot) {
  return { x: bot.pos.x, y: bot.pos.y + BOT_EYE, z: bot.pos.z };
}

export function botHead(bot) {
  return { x: bot.pos.x, y: bot.pos.y + BOT_HEAD_Y, z: bot.pos.z };
}

export function botBodyAABB(bot) {
  return {
    min: { x: bot.pos.x - 0.38, y: bot.pos.y, z: bot.pos.z - 0.38 },
    max: { x: bot.pos.x + 0.38, y: bot.pos.y + 1.5, z: bot.pos.z + 0.38 },
  };
}

function hasLOS(map, from, to) {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const len = Math.hypot(d.x, d.y, d.z);
  if (len < 0.001) return true;
  d.x /= len; d.y /= len; d.z /= len;
  return raycastArena(map, from, d, len) === null;
}

export function botTick(bot, state, events, rng, dt) {
  if (!bot.alive) {
    bot.respawnT -= dt;
    if (bot.respawnT <= 0) {
      bot.alive = true;
      bot.health = 100;
      bot.pos = { x: bot.spawn.x, y: bot.spawn.y, z: bot.spawn.z };
      bot.vel = { x: 0, y: 0, z: 0 };
      bot.spot = 0;
      events.push({ type: 'botrespawn', id: bot.id });
    }
    return;
  }

  const p = state.player;
  const map = state.map;
  const eye = botEye(bot);

  // --- sense ---
  let sees = false;
  if (p.alive) {
    const pe = eyePos(p);
    if (dist3d(eye, pe) < SIGHT_RANGE && hasLOS(map, eye, pe)) sees = true;
  }
  bot.spot = sees ? bot.spot + dt : Math.max(0, bot.spot - dt * 2);
  if (sees) bot.lastSeenT = 0; else bot.lastSeenT += dt;
  const engaged = p.alive && bot.spot >= SPOT_TIME && bot.lastSeenT < 2;

  // --- steer ---
  let wishX = 0, wishZ = 0;
  if (engaged) {
    const want = yawPitchTo(bot.pos, p.pos).yaw;
    let dy = want - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += Math.sign(dy) * Math.min(Math.abs(dy), TURN_RATE * dt);

    // strafe perpendicular to the player, re-rolled every 1-2s
    bot.strafeT -= dt;
    if (bot.strafeT <= 0) {
      bot.strafeDir = rng() < 0.5 ? -1 : 1;
      bot.strafeT = 1 + rng();
    }
    const toP = { x: p.pos.x - bot.pos.x, z: p.pos.z - bot.pos.z };
    const l = Math.hypot(toP.x, toP.z) || 1;
    wishX = (-toP.z / l) * bot.strafeDir * BOT_STRAFE_SPEED;
    wishZ = (toP.x / l) * bot.strafeDir * BOT_STRAFE_SPEED;
    if (l > 22) { // close distance if too far to fight
      wishX += (toP.x / l) * BOT_SPEED * 0.7;
      wishZ += (toP.z / l) * BOT_SPEED * 0.7;
    }
  } else {
    const wp = map.waypoints[bot.wpIndex];
    if (dist2d(bot.pos, wp) < 0.9) {
      // linked graph: walk an edge so authored clear lines are respected;
      // maps without links fall back to a random hop (open layouts)
      bot.wpIndex = wp.links
        ? wp.links[Math.floor(rng() * wp.links.length)]
        : Math.floor(rng() * map.waypoints.length);
      bot.stuckT = 0;
    } else {
      const dx = wp.x - bot.pos.x, dz = wp.z - bot.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      wishX = (dx / l) * BOT_SPEED;
      wishZ = (dz / l) * BOT_SPEED;
      bot.yaw = Math.atan2(-dx, -dz);
      // wedged against geometry the graph didn't anticipate: re-roll the target.
      // Position-based — velocity stays high while a wall clamps movement.
      const moved = Math.hypot(bot.pos.x - bot.lastX, bot.pos.z - bot.lastZ);
      if (moved < 0.02) {
        bot.stuckT += dt;
        if (bot.stuckT > 1.2) {
          bot.wpIndex = Math.floor(rng() * map.waypoints.length);
          bot.stuckT = 0;
        }
      } else {
        bot.stuckT = 0;
      }
    }
  }
  bot.lastX = bot.pos.x;
  bot.lastZ = bot.pos.z;

  // --- move (same accel-toward-target scheme as the player, gentler) ---
  const rate = bot.onGround ? 40 : 8;
  const dvx = wishX - bot.vel.x, dvz = wishZ - bot.vel.z;
  const dl = Math.hypot(dvx, dvz);
  if (dl > 0) {
    const step = Math.min(rate * dt, dl);
    bot.vel.x += (dvx / dl) * step;
    bot.vel.z += (dvz / dl) * step;
  }
  bot.vel.y = Math.max(-40, bot.vel.y - 24 * dt);
  slideMove(bot, map, dt);

  // --- fight ---
  bot.fireT -= dt;
  if (engaged && sees) {
    if (bot.burstLeft <= 0 && bot.fireT <= 0) {
      bot.burstLeft = BURST_SIZE;
    }
    if (bot.burstLeft > 0 && bot.fireT <= 0) {
      bot.burstLeft--;
      bot.fireT = bot.burstLeft > 0 ? BURST_INTERVAL : BURST_PAUSE;
      fireAtPlayer(bot, state, events, rng);
    }
  } else {
    bot.burstLeft = 0;
  }
}

function fireAtPlayer(bot, state, events, rng) {
  const p = state.player;
  const eye = botEye(bot);
  const target = { x: p.pos.x, y: p.pos.y + p.height * 0.65, z: p.pos.z };
  const { yaw, pitch } = yawPitchTo(eye, target);
  const dir = coneSpread(aimDir(yaw, pitch), BOT_SPREAD, rng);

  const RANGE = 60;
  const world = raycastArena(state.map, eye, dir, RANGE);
  let tWorld = world ? world.t : RANGE;

  // player hull
  const hull = {
    min: { x: p.pos.x - p.half.x, y: p.pos.y, z: p.pos.z - p.half.z },
    max: { x: p.pos.x + p.half.x, y: p.pos.y + p.height, z: p.pos.z + p.half.z },
  };
  const tPlayer = rayAABB(eye, dir, hull.min, hull.max, tWorld);

  const hitPlayer = tPlayer < tWorld;
  const tEnd = hitPlayer ? tPlayer : tWorld;
  events.push({
    type: 'botshot',
    id: bot.id,
    origin: eye,
    end: { x: eye.x + dir.x * tEnd, y: eye.y + dir.y * tEnd, z: eye.z + dir.z * tEnd },
    hitPlayer,
    mat: !hitPlayer && world ? world.mat : null,
  });

  if (hitPlayer) {
    p.health -= BOT_DAMAGE;
    p.regenT = 5;
    events.push({ type: 'playerhit', damage: BOT_DAMAGE, from: { ...bot.pos } });
  }
}

export function damageBot(bot, amount, state, events, headshot) {
  bot.health -= amount;
  bot.spot = SPOT_TIME; // getting shot instantly alerts
  bot.lastSeenT = 0;
  if (bot.health <= 0) {
    bot.alive = false;
    bot.respawnT = RESPAWN_TIME;
    state.kills++;
    events.push({ type: 'botdie', id: bot.id, pos: { ...bot.pos }, headshot });
    return true;
  }
  return false;
}
