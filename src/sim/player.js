// Player + shared AABB movement. Move-and-slide against the map's boxes with
// step-up so stair boxes read as stairs. Bots reuse slideMove. The map is an
// explicit argument everywhere — no globals, sim stays pure.

import { clamp, aabbOverlap, EPS } from './math.js';

const GRAVITY = 24;
const JUMP_VEL = 8.0;
const WALK_SPEED = 5.2;
const SPRINT_MULT = 1.42;
const CROUCH_MULT = 0.5;
const ACCEL_GROUND = 62;
const DECEL_GROUND = 88;
const ACCEL_AIR = 13;
const STEP_HEIGHT = 0.45;

export const STAND_HEIGHT = 1.8;
export const CROUCH_HEIGHT = 1.2;
export const EYE_OFFSET = 0.17; // eye sits this far below the top of the hull

export function makePlayer() {
  return {
    pos: { x: 0, y: 0, z: 0 }, // feet, bottom-center of hull
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0, pitch: 0,
    half: { x: 0.35, z: 0.35 },
    height: STAND_HEIGHT,
    crouched: false,
    onGround: true,
    health: 100, regenT: 0,
    alive: false, // stays false until first loadout pick spawns them
    weapon: null,
    sprinting: false,
    aiming: false,
    moveFrac: 0, // 0..1 of sprint speed, feeds weapon spread
    stepPhase: 0, // walk-cycle accumulator, drives footstep sounds render-side
  };
}

export function eyePos(p) {
  return { x: p.pos.x, y: p.pos.y + p.height - EYE_OFFSET, z: p.pos.z };
}

function bodyAABB(b) {
  return {
    min: { x: b.pos.x - b.half.x, y: b.pos.y, z: b.pos.z - b.half.z },
    max: { x: b.pos.x + b.half.x, y: b.pos.y + b.height, z: b.pos.z + b.half.z },
  };
}

function overlapsAny(b, map) {
  const { min, max } = bodyAABB(b);
  for (const box of map.boxes) {
    if (aabbOverlap(min, max, box.min, box.max)) return true;
  }
  return false;
}

// Translate along one axis, clamping out of any box hit. Returns true if blocked.
function collideAxis(b, map, axis, delta) {
  if (delta === 0) return false;
  b.pos[axis] += delta;
  let hit = false;
  for (const box of map.boxes) {
    const { min, max } = bodyAABB(b);
    if (!aabbOverlap(min, max, box.min, box.max)) continue;
    hit = true;
    if (delta > 0) b.pos[axis] -= max[axis] - box.min[axis] + EPS;
    else b.pos[axis] += box.max[axis] - min[axis] + EPS;
  }
  return hit;
}

function moveHorizontal(b, map, axis, delta) {
  const saved = { ...b.pos };
  const blocked = collideAxis(b, map, axis, delta);
  if (!blocked || !b.onGround) return;
  // Step-up attempt: lift, redo the move, settle back down.
  const clamped = { ...b.pos };
  b.pos = { ...saved };
  b.pos.y += STEP_HEIGHT;
  if (overlapsAny(b, map)) { b.pos = clamped; return; }
  const stillBlocked = collideAxis(b, map, axis, delta);
  collideAxis(b, map, 'y', -(STEP_HEIGHT + 0.01));
  if (stillBlocked && Math.abs(b.pos[axis] - saved[axis]) <= Math.abs(clamped[axis] - saved[axis])) {
    b.pos = clamped; // step gained nothing
  }
}

// Shared by player and bots. Mutates pos/vel/onGround.
export function slideMove(b, map, dt) {
  moveHorizontal(b, map, 'x', b.vel.x * dt);
  moveHorizontal(b, map, 'z', b.vel.z * dt);
  const dy = b.vel.y * dt;
  const hitY = collideAxis(b, map, 'y', dy);
  b.onGround = false;
  if (hitY) {
    if (dy < 0) b.onGround = true;
    b.vel.y = 0;
  }
  if (!b.onGround && b.vel.y <= 0) {
    // ground probe just below the feet keeps onGround stable on flat floor
    b.pos.y -= 0.02;
    if (overlapsAny(b, map)) { b.onGround = true; b.vel.y = 0; }
    b.pos.y += 0.02;
  }
}

export function playerMove(p, cmd, map, dt) {
  p.yaw = cmd.yaw;
  p.pitch = clamp(cmd.pitch, -1.55, 1.55);

  // crouch — shrink instantly, grow only with headroom
  if (cmd.crouch && !p.crouched) {
    p.crouched = true;
    p.height = CROUCH_HEIGHT;
  } else if (!cmd.crouch && p.crouched) {
    p.height = STAND_HEIGHT;
    if (overlapsAny(p, map)) p.height = CROUCH_HEIGHT;
    else p.crouched = false;
  }

  p.aiming = !!cmd.aim;
  p.sprinting = cmd.sprint && !p.crouched && !p.aiming && cmd.mz > 0;
  let speed = WALK_SPEED * (p.sprinting ? SPRINT_MULT : p.crouched ? CROUCH_MULT : 1);
  if (p.aiming) speed *= 0.6;

  // wish direction in world space
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  let wx = -s * cmd.mz + c * cmd.mx;
  let wz = -c * cmd.mz - s * cmd.mx;
  const wl = Math.hypot(wx, wz);
  if (wl > 1) { wx /= wl; wz /= wl; }

  // accelerate horizontal velocity toward wish * speed
  const tx = wx * speed, tz = wz * speed;
  const dvx = tx - p.vel.x, dvz = tz - p.vel.z;
  const dl = Math.hypot(dvx, dvz);
  if (dl > 0) {
    const speedingUp = tx * p.vel.x + tz * p.vel.z < tx * tx + tz * tz - 0.01;
    const rate = p.onGround ? (wl > 0.01 && speedingUp ? ACCEL_GROUND : DECEL_GROUND) : ACCEL_AIR;
    const step = Math.min(rate * dt, dl);
    p.vel.x += (dvx / dl) * step;
    p.vel.z += (dvz / dl) * step;
  }

  if (cmd.jumpEdge && p.onGround) {
    p.vel.y = JUMP_VEL;
    p.onGround = false;
  }
  p.vel.y = Math.max(-40, p.vel.y - GRAVITY * dt);

  slideMove(p, map, dt);
  const hSpeed = Math.hypot(p.vel.x, p.vel.z);
  p.moveFrac = clamp(hSpeed / (WALK_SPEED * SPRINT_MULT), 0, 1);
  // walk cycle: wraps ~every stride; footstep fires on the wrap (render-side)
  p.stepPhase += p.onGround ? hSpeed * dt / 2.2 : 0;
}
