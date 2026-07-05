// DEPOT — the original arena. Mid-size, mixed-range: central raised platform,
// north walkway, crate cover, two long diagonals. Pure data.

import { B, crate } from './builders.js';

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
  boxes.push(B(-5 - 0.7 * (4 - i), 0, -2, -5 - 0.7 * (3 - i), h, 2, 'metal')); // west stairs
  boxes.push(B(5 + 0.7 * (3 - i), 0, -2, 5 + 0.7 * (4 - i), h, 2, 'metal'));  // east stairs
}
// Low cover walls on the platform edges
boxes.push(B(-5, 1.6, -5, 5, 2.2, -4.6, 'concrete'));
boxes.push(B(-5, 1.6, 4.6, 5, 2.2, 5, 'concrete'));

// North elevated walkway (floor top at 2.4m) with stairs at both ends
boxes.push(B(-14, 2.2, -20.9, 14, 2.4, -16.5, 'metal'));
for (let i = 0; i < 6; i++) {
  const h = 0.4 * (i + 1);
  boxes.push(B(-14 - 0.8 * (6 - i), 0, -20.9, -14 - 0.8 * (5 - i), h, -16.5, 'metal'));
  boxes.push(B(14 + 0.8 * (5 - i), 0, -20.9, 14 + 0.8 * (6 - i), h, -16.5, 'metal'));
}
for (const px of [-10, 0, 10]) {
  boxes.push(B(px - 0.3, 0, -18.9, px + 0.3, 2.2, -18.3, 'metal')); // pillars
}
boxes.push(B(-14, 2.4, -16.5, 14, 3.3, -16.3, 'rail')); // railing, shoot over

// Crates — singles and stacks, placed to break the long lanes
boxes.push(crate(-11, 8));
boxes.push(crate(-11, 8, 1.2));
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

// Sightline breakers (added in the 6v6 pass — the west/east lanes and the
// north pocket used to allow spawn-to-spawn lines; verified by test 10)
boxes.push(B(-17.5, 0, 1, -13.5, 2.4, 1.5, 'concrete'));  // west lane screen
boxes.push(B(13.5, 0, -1.5, 17.5, 2.4, -1, 'concrete'));  // east lane screen
boxes.push(B(-12, 0, -5.5, -7, 2.6, -1.5, 'metal'));      // west container
boxes.push(B(7, 0, 1.5, 12.5, 2.6, 5.5, 'metal'));        // east container
boxes.push(B(-1, 0, -14.5, 5, 2.6, -14, 'concrete'));     // blue spawn shield

export const DEPOT = {
  id: 'depot',
  name: 'DEPOT',
  tagline: 'Mixed range — platform control',
  boxes,
  bounds: { min: { x: -21, z: -21 }, max: { x: 21, z: 21 } },
  env: {
    sky: 0x1c232d, fogNear: 60, fogFar: 140,
    sunPos: [18, 30, 12], sunColor: 0xffe3b8, sunIntensity: 2.4,
    hemiSky: 0xbdd0e4, hemiGround: 0x55503f, hemiIntensity: 1.15,
    ambient: 'hum',
  },
  playerSpawns: [
    { pos: { x: -16, y: 0, z: 16 }, yaw: Math.PI * 0.25 },
    { pos: { x: 16, y: 0, z: 16 }, yaw: -Math.PI * 0.25 },
    { pos: { x: 0, y: 0, z: 17 }, yaw: 0 },
  ],
  botSpawns: [
    { x: -16, y: 0, z: -12 },
    { x: 16, y: 0, z: -12 },
    { x: 0, y: 2.4, z: -19.8 },
    { x: 14, y: 0, z: 2 },
    { x: -14, y: 0, z: 2 },
  ],
  // Linked patrol graph — edges follow authored-clear corridors
  waypoints: [
    { x: -16, y: 0, z: -12, links: [11, 12, 14] },  // 0 NW ground
    { x: 16, y: 0, z: -12, links: [10, 13] },       // 1 NE ground
    { x: -16, y: 0, z: 12, links: [7, 15] },        // 2 SW
    { x: 16, y: 0, z: 12, links: [7, 16] },         // 3 SE
    { x: 0, y: 1.6, z: 0, links: [8, 9] },          // 4 platform top
    { x: -10, y: 2.4, z: -19.8, links: [6, 12] },   // 5 walkway west
    { x: 10, y: 2.4, z: -19.8, links: [5, 13] },    // 6 walkway east
    { x: 0, y: 0, z: 14, links: [2, 3] },           // 7 south mid
    { x: -12, y: 0, z: 0, links: [4, 14, 15] },     // 8 west of platform
    { x: 13.5, y: 0, z: 0, links: [4, 10, 16] },    // 9 east of platform
    { x: 6, y: 0, z: -10, links: [1, 9, 11] },      // 10 north-east floor
    { x: -6, y: 0, z: -10, links: [0, 10, 14] },    // 11 north-west floor
    { x: -19.5, y: 0, z: -19.8, links: [0, 5] },    // 12 west stair base
    { x: 19.5, y: 0, z: -19.8, links: [1, 6] },     // 13 east stair base
    { x: -16.5, y: 0, z: -8, links: [0, 8, 11] },   // 14 west lane north
    { x: -12.5, y: 0, z: 6, links: [2, 8] },        // 15 west mid connector
    { x: 13, y: 0, z: 6, links: [3, 9] },           // 16 east mid connector
  ],
  teamSpawns: {
    red: [
      { pos: { x: -16, y: 0, z: 16 }, yaw: Math.atan2(-16, 16) },
      { pos: { x: 16, y: 0, z: 16 }, yaw: Math.atan2(16, 16) },
      { pos: { x: 0, y: 0, z: 17 }, yaw: 0 },
      { pos: { x: -8, y: 0, z: 17 }, yaw: Math.atan2(-8, 17) },
      { pos: { x: 8, y: 0, z: 17 }, yaw: Math.atan2(8, 17) },
      { pos: { x: -14, y: 0, z: 17 }, yaw: Math.atan2(-14, 17) },
    ],
    blue: [
      { pos: { x: -16, y: 0, z: -12 }, yaw: Math.atan2(-16, -12) },
      { pos: { x: 16, y: 0, z: -12 }, yaw: Math.atan2(16, -12) },
      { pos: { x: 0.5, y: 0, z: -16.5 }, yaw: Math.atan2(-7.5, -2.7) }, // shielded pocket, exits east of the shield
      { pos: { x: -8, y: 0, z: -14 }, yaw: Math.atan2(-8, -14) },
      { pos: { x: 8, y: 0, z: -14 }, yaw: Math.atan2(8, -14) },
      { pos: { x: 17, y: 0, z: -4 }, yaw: Math.atan2(17, -4) },
    ],
  },
};
