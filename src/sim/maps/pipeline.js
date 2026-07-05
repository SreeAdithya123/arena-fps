// PIPELINE — open long-range map. Two ~44m lanes split by a central pipe
// spine you can walk on (2.6m up, pipe cover on top) or cut under through
// three ground tunnels. Sparse lane cover; favors DMR/sniper. Team spawns
// sit behind berms at the far ends, out of lane sightlines.

import { B, crate, stairs } from './builders.js';

const boxes = [];

// Floor + perimeter (4m walls)
boxes.push(B(-26, -1, -15, 26, 0, 15, 'floor'));
boxes.push(B(-27, 0, -16, 27, 4.2, -15, 'wall'));
boxes.push(B(-27, 0, 15, 27, 4.2, 16, 'wall'));
boxes.push(B(-27, 0, -16, -26, 4.2, 16, 'wall'));
boxes.push(B(26, 0, -16, 27, 4.2, 16, 'wall'));

// Central spine: body segments with three ground tunnels, continuous top slab
for (const [x1, x2] of [[-20, -11.5], [-8.5, -1.5], [1.5, 8.5], [11.5, 20]]) {
  boxes.push(B(x1, 0, -2, x2, 2.2, 2, 'metal'));
}
boxes.push(B(-20, 2.2, -2, 20, 2.6, 2, 'metal'));        // walkable slab (tunnels underneath)
boxes.push(B(-19, 2.6, -1.5, 19, 3.3, -0.7, 'pipe'));    // north pipe — crouch cover on top
boxes.push(B(-19, 2.6, 0.7, 19, 3.3, 1.5, 'pipe'));      // south pipe
stairs(boxes, -20, 0, 3, 2.6, 'x+');                      // west access
stairs(boxes, 20, 0, 3, 2.6, 'x-');                       // east access

// North lane cover
boxes.push(crate(-14, -8));
boxes.push(crate(-14, -8, 1.2));
boxes.push(B(3, 0, -9.5, 7, 1.1, -9.1, 'concrete'));     // low wall, offset east
boxes.push(crate(12, -7));
boxes.push(crate(13.3, -7.2));
boxes.push(crate(4, -13.5));

// South lane cover (offset, not mirrored exactly)
boxes.push(crate(14, 8));
boxes.push(crate(14, 8, 1.2));
boxes.push(B(-7, 0, 9.1, -3, 1.1, 9.5, 'concrete'));     // low wall, offset west
boxes.push(crate(-12, 7));
boxes.push(crate(-13.3, 7.2));
boxes.push(crate(-4, 13.5));

// Spawn berms (2.2m — block lane sightlines into spawns; cover the full spawn strip)
boxes.push(B(-21, 0, -11.5, -20.5, 2.2, -3, 'concrete')); // west north-berm
boxes.push(B(-21, 0, 3, -20.5, 2.2, 11.5, 'concrete'));   // west south-berm
boxes.push(B(20.5, 0, -11.5, 21, 2.2, -3, 'concrete'));   // east north-berm
boxes.push(B(20.5, 0, 3, 21, 2.2, 11.5, 'concrete'));     // east south-berm

// Linked patrol graph: lanes, tunnels, spine top, berm-gap connectors
const waypoints = [
  { x: -19, y: 0, z: -11, links: [1, 18] },        // 0 NW
  { x: -12, y: 0, z: -11, links: [0, 2, 7] },      // 1 N-west
  { x: 0, y: 0, z: -12, links: [1, 3, 8] },        // 2 N-mid
  { x: 11, y: 0, z: -11, links: [2, 4, 9] },       // 3 N-east
  { x: 19, y: 0, z: -11, links: [3, 19] },         // 4 NE
  { x: -19, y: 0, z: 11, links: [6, 18] },         // 5 SW
  { x: -11, y: 0, z: 11, links: [5, 7, 12] },      // 6 S-west
  { x: -10, y: 0, z: 0, links: [1, 6] },           // 7 west tunnel
  { x: 0, y: 0, z: 0, links: [2, 12] },            // 8 center tunnel
  { x: 10, y: 0, z: 0, links: [3, 13] },           // 9 east tunnel
  { x: -24, y: 0, z: 0, links: [18, 14] },         // 10 west stair base
  { x: 24, y: 0, z: 0, links: [19, 15] },          // 11 east stair base
  { x: 0, y: 0, z: 12, links: [8, 6, 13] },        // 12 S-mid
  { x: 12, y: 0, z: 11, links: [9, 12, 16] },      // 13 S-east
  { x: -16, y: 2.6, z: 0, links: [10, 17] },       // 14 spine west (via stairs)
  { x: 16, y: 2.6, z: 0, links: [11, 17] },        // 15 spine east (via stairs)
  { x: 19, y: 0, z: 11, links: [13, 19] },         // 16 SE
  { x: 0, y: 2.6, z: 0, links: [14, 15] },         // 17 spine mid
  { x: -20.75, y: 0, z: 0, links: [0, 5, 10] },    // 18 west berm gap
  { x: 20.75, y: 0, z: 0, links: [4, 16, 11] },    // 19 east berm gap
];

export const PIPELINE = {
  id: 'pipeline',
  name: 'PIPELINE',
  tagline: 'Long lanes — hold the spine',
  boxes,
  bounds: { min: { x: -26, z: -15 }, max: { x: 26, z: 15 } },
  env: {
    sky: 0x161d26, fogNear: 70, fogFar: 160,
    sunPos: [24, 28, -10], sunColor: 0xffedc9, sunIntensity: 2.5,
    hemiSky: 0xaec6de, hemiGround: 0x3e4246, hemiIntensity: 1.05,
    ambient: 'industrial',
  },
  playerSpawns: [
    { pos: { x: -24, y: 0, z: 6 }, yaw: Math.atan2(-1, 6) },
    { pos: { x: 24, y: 0, z: -6 }, yaw: Math.atan2(1, -6) },
    { pos: { x: -24, y: 0, z: -6 }, yaw: Math.atan2(-1, -6) },
  ],
  botSpawns: [
    { x: -19, y: 0, z: -11 },
    { x: 19, y: 0, z: 11 },
    { x: 0, y: 2.6, z: 0 },
    { x: 11, y: 0, z: -11 },
    { x: -11, y: 0, z: 11 },
  ],
  waypoints,
  // red spawns west behind the berms, blue east. Yaws aim at the berm gap
  // (z=0 strip) so walking forward always leaves the spawn pocket.
  teamSpawns: {
    red: [
      { pos: { x: -24, y: 0, z: 5 }, yaw: Math.atan2(-1, 5) },
      { pos: { x: -24, y: 0, z: -5 }, yaw: Math.atan2(-1, -5) },
      { pos: { x: -22.5, y: 0, z: 7 }, yaw: 0 },
      { pos: { x: -22.5, y: 0, z: -7 }, yaw: Math.PI },
      { pos: { x: -24.5, y: 0, z: 10 }, yaw: Math.atan2(-1.5, 10) },
      { pos: { x: -24.5, y: 0, z: -10 }, yaw: Math.atan2(-1.5, -10) },
    ],
    blue: [
      { pos: { x: 24, y: 0, z: -5 }, yaw: Math.atan2(1, -5) },
      { pos: { x: 24, y: 0, z: 5 }, yaw: Math.atan2(1, 5) },
      { pos: { x: 22.5, y: 0, z: -7 }, yaw: Math.PI },
      { pos: { x: 22.5, y: 0, z: 7 }, yaw: 0 },
      { pos: { x: 24.5, y: 0, z: -10 }, yaw: Math.atan2(1.5, -10) },
      { pos: { x: 24.5, y: 0, z: 10 }, yaw: Math.atan2(1.5, 10) },
    ],
  },
};
