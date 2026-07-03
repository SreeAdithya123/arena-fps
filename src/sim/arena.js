// Arena definition — plain data. The sim collides against these AABBs and the
// renderer builds its meshes from the same list, so geometry can never diverge.
// ~42m x 42m industrial depot: central raised platform, north walkway, crate
// cover, two low crouch-walls, long diagonal sightlines.

import { rayAABB } from './math.js';

const B = (x1, y1, z1, x2, y2, z2, mat) => ({
  min: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
  mat,
});

const boxes = [];

// Floor + perimeter walls (4m high, 1m thick)
boxes.push(B(-21, -1, -21, 21, 0, 21, 'floor'));
boxes.push(B(-22, 0, -22, 22, 4.2, -21, 'wall'));   // north
boxes.push(B(-22, 0, 21, 22, 4.2, 22, 'wall'));      // south
boxes.push(B(-22, 0, -22, -21, 4.2, 22, 'wall'));    // west
boxes.push(B(21, 0, -22, 22, 4.2, 22, 'wall'));      // east

// Central raised platform (1.6m) with stair access west + east
boxes.push(B(-5, 0, -5, 5, 1.6, 5, 'concrete'));
for (let i = 0; i < 4; i++) {
  const h = 0.4 * (i + 1);
  // west stairs (climb eastward onto platform)
  boxes.push(B(-5 - 0.7 * (4 - i), 0, -2, -5 - 0.7 * (3 - i), h, 2, 'metal'));
  // east stairs
  boxes.push(B(5 + 0.7 * (3 - i), 0, -2, 5 + 0.7 * (4 - i), h, 2, 'metal'));
}
// Low cover walls on the platform edges
boxes.push(B(-5, 1.6, -5, 5, 2.2, -4.6, 'concrete'));
boxes.push(B(-5, 1.6, 4.6, 5, 2.2, 5, 'concrete'));

// North elevated walkway (floor top at 2.4m) with stairs at both ends
boxes.push(B(-14, 2.2, -20.9, 14, 2.4, -16.5, 'metal'));
for (let i = 0; i < 6; i++) {
  const h = 0.4 * (i + 1);
  // west approach stairs (climb northward, then eastward onto walkway)
  boxes.push(B(-14 - 0.8 * (6 - i), 0, -20.9, -14 - 0.8 * (5 - i), h, -16.5, 'metal'));
  // east approach stairs
  boxes.push(B(14 + 0.8 * (5 - i), 0, -20.9, 14 + 0.8 * (6 - i), h, -16.5, 'metal'));
}
// Walkway support pillars
for (const px of [-10, 0, 10]) {
  boxes.push(B(px - 0.3, 0, -18.9, px + 0.3, 2.2, -18.3, 'metal'));
}
// Walkway railing (low, can shoot over)
boxes.push(B(-14, 2.4, -16.5, 14, 3.3, -16.3, 'rail'));

// Crates — 1.2m cubes, singles and stacks, placed to break the long lanes
const crate = (x, z, lift = 0) => B(x - 0.6, lift, z - 0.6, x + 0.6, lift + 1.2, z + 0.6, 'crate');
boxes.push(crate(-11, 8));
boxes.push(crate(-11, 8, 1.2));          // stacked pair
boxes.push(crate(-9.7, 8.4));
boxes.push(crate(10, 10));
boxes.push(crate(11.3, 10.2));
boxes.push(crate(11.3, 10.2, 1.2));
boxes.push(crate(13, -8));
boxes.push(crate(13, -6.7));
boxes.push(crate(-14, -6));
boxes.push(crate(-14, -6, 1.2));
boxes.push(crate(-12.7, -6));
boxes.push(crate(3, 13));
boxes.push(crate(-4, -12));
boxes.push(crate(-4, -12, 1.2));
boxes.push(crate(8, -13));

// Low crouch-cover walls (1.1m)
boxes.push(B(-2, 0, 9.5, 4, 1.1, 10, 'concrete'));
boxes.push(B(-8, 0, -10, -7.5, 1.1, -5, 'concrete'));

export const ARENA = {
  boxes,
  bounds: { min: { x: -21, z: -21 }, max: { x: 21, z: 21 } },
  playerSpawns: [
    { pos: { x: -16, y: 0, z: 16 }, yaw: Math.PI * 0.25 },
    { pos: { x: 16, y: 0, z: 16 }, yaw: -Math.PI * 0.25 },
    { pos: { x: 0, y: 0, z: 17 }, yaw: 0 },
  ],
  // Team-sided spawns for friend rooms: red holds the south, blue the north.
  teamSpawns: {
    red: [
      { pos: { x: -16, y: 0, z: 16 }, yaw: Math.PI * 0.25 },
      { pos: { x: 16, y: 0, z: 16 }, yaw: -Math.PI * 0.25 },
      { pos: { x: 0, y: 0, z: 17 }, yaw: 0 },
      { pos: { x: -8, y: 0, z: 17 }, yaw: Math.PI * 0.1 },
      { pos: { x: 8, y: 0, z: 17 }, yaw: -Math.PI * 0.1 },
      { pos: { x: -17, y: 0, z: 8 }, yaw: Math.PI * 0.35 },
    ],
    blue: [
      { pos: { x: -16, y: 0, z: -12 }, yaw: Math.PI * 0.75 },
      { pos: { x: 16, y: 0, z: -12 }, yaw: -Math.PI * 0.75 },
      { pos: { x: 0, y: 2.4, z: -18.5 }, yaw: Math.PI },
      { pos: { x: -8, y: 0, z: -14 }, yaw: Math.PI * 0.9 },
      { pos: { x: 8, y: 0, z: -14 }, yaw: -Math.PI * 0.9 },
      { pos: { x: 17, y: 0, z: -4 }, yaw: -Math.PI * 0.6 },
    ],
  },
  botSpawns: [
    { x: -16, y: 0, z: -12 },
    { x: 16, y: 0, z: -12 },
    { x: 0, y: 2.4, z: -18 },   // walkway
    { x: 14, y: 0, z: 2 },
    { x: -14, y: 0, z: 2 },
  ],
  // Patrol pool — y is the expected floor height at that point.
  waypoints: [
    { x: -16, y: 0, z: -12 }, { x: 16, y: 0, z: -12 },
    { x: -16, y: 0, z: 12 }, { x: 16, y: 0, z: 12 },
    { x: 0, y: 1.6, z: 0 },                            // platform top
    { x: -10, y: 2.4, z: -18.5 }, { x: 10, y: 2.4, z: -18.5 }, // walkway
    { x: 0, y: 0, z: 14 }, { x: -12, y: 0, z: 0 }, { x: 12, y: 0, z: 0 },
    { x: 6, y: 0, z: -10 }, { x: -6, y: 0, z: -10 },
  ],
};

// Nearest world hit along a ray. Returns { t, mat } or null.
export function raycastArena(o, d, tMax) {
  let best = Infinity, mat = null;
  for (const b of ARENA.boxes) {
    const t = rayAABB(o, d, b.min, b.max, tMax);
    if (t < best) { best = t; mat = b.mat; }
  }
  return best < Infinity ? { t: best, mat } : null;
}
