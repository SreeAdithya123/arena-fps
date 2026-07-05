// COMPOUND — tight close-quarters map. A four-room central building with a
// hub crossing, wrapped by a ring corridor. Sightlines stay under ~15m;
// favors SMG/shotgun. Waypoints form a linked graph so bots take doors.

import { B, crate, wallX, wallZ } from './builders.js';

const boxes = [];

// Floor + perimeter (3.6m walls)
boxes.push(B(-18, -1, -18, 18, 0, 18, 'floor'));
boxes.push(B(-19, 0, -19, 19, 3.6, -18, 'wall'));
boxes.push(B(-19, 0, 18, 19, 3.6, 19, 'wall'));
boxes.push(B(-19, 0, -19, -18, 3.6, 19, 'wall'));
boxes.push(B(18, 0, -19, 19, 3.6, 19, 'wall'));

// Central building shell (3m walls — no shooting over), doors cut in
const H = 3, T = 0.5;
wallX(boxes, -9, -9, 9, H, T, [[-6, -4], [4, 6]], 'concrete');  // north face
wallX(boxes, 9, -9, 9, H, T, [[-6, -4], [4, 6]], 'concrete');   // south face
wallZ(boxes, -9, -9, 9, H, T, [[2, 4]], 'concrete');            // west face, door to SW room
wallZ(boxes, 9, -9, 9, H, T, [[-4, -2]], 'concrete');           // east face, door to NE room

// Interior cross: hub gap in the middle, side gaps between room pairs
wallX(boxes, 0, -9, 9, H, T, [[-2, 2]], 'concrete');            // east-west partition
wallZ(boxes, 0, -9, 9, H, T, [[-7, -5], [-2, 2], [5, 7]], 'concrete'); // north-south partition
// hub pillar — kills the door-to-door diagonal sightlines through the center
boxes.push(B(-1, 0, -1, 1, H, 1, 'concrete'));

// Room furniture — corner cover inside each room
boxes.push(crate(-6.5, -6.5));
boxes.push(crate(6.5, -6.5));
boxes.push(crate(6.5, -6.5, 1.2));
boxes.push(crate(-6.5, 6.5));
boxes.push(crate(5.8, 6.2));

// Ring corridor cover: corner crate clusters + mid-side low walls
boxes.push(crate(-13.5, -13.5));
boxes.push(crate(-13.5, -13.5, 1.2));
boxes.push(crate(-12.2, -13.2));
boxes.push(crate(13.5, -13.5));
boxes.push(crate(13.5, 13.5));
boxes.push(crate(13.5, 13.5, 1.2));
boxes.push(crate(-13.5, 13.5));
boxes.push(crate(-14.6, 12.8));
boxes.push(B(-3, 0, -10.2, 3, 1.1, -9.8, 'concrete'));  // north face low wall (hugs the building)
boxes.push(B(-3, 0, 9.8, 3, 1.1, 10.2, 'concrete'));    // south face low wall
boxes.push(B(-10.2, 0, -4, -9.8, 1.1, 2, 'concrete'));  // west face low wall
boxes.push(B(9.8, 0, -2, 10.2, 1.1, 4, 'concrete'));    // east face low wall

// Linked patrol graph: ring (0-7), doors (13-18), rooms (9-12), hub (8), x=0 gaps (19-20)
const waypoints = [
  { x: -11.8, y: 0, z: -11.8, links: [1, 7] },    // 0 NW corner
  { x: 0, y: 0, z: -15.5, links: [0, 2, 13, 14] },// 1 N corridor
  { x: 11.8, y: 0, z: -11.8, links: [1, 3, 18] }, // 2 NE corner
  { x: 15.5, y: 0, z: 0, links: [2, 4] },         // 3 E corridor
  { x: 11.8, y: 0, z: 11.8, links: [3, 5] },      // 4 SE corner
  { x: 0, y: 0, z: 15.5, links: [4, 6, 15, 16] }, // 5 S corridor
  { x: -11.8, y: 0, z: 11.8, links: [5, 7, 17] }, // 6 SW corner
  { x: -15.5, y: 0, z: 0, links: [6, 0] },        // 7 W corridor
  { x: -1.6, y: 0, z: 0, links: [9, 11] },        // 8 hub (west strip of the pillar)
  { x: -4.5, y: 0, z: -4.5, links: [8, 13, 19] }, // 9 NW room
  { x: 4.5, y: 0, z: -4.5, links: [14, 18, 19] }, // 10 NE room
  { x: -4.5, y: 0, z: 4.5, links: [8, 15, 17, 20] }, // 11 SW room
  { x: 4.5, y: 0, z: 4.5, links: [16, 20] },      // 12 SE room
  { x: -5, y: 0, z: -10.5, links: [1, 9] },       // 13 N door west
  { x: 5, y: 0, z: -10.5, links: [1, 10] },       // 14 N door east
  { x: -5, y: 0, z: 10.5, links: [5, 11] },       // 15 S door west
  { x: 5, y: 0, z: 10.5, links: [5, 12] },        // 16 S door east
  { x: -10.5, y: 0, z: 3, links: [6, 11] },       // 17 W door
  { x: 10.5, y: 0, z: -3, links: [2, 10] },       // 18 E door
  { x: 0, y: 0, z: -6, links: [9, 10] },          // 19 north x=0 gap
  { x: 0, y: 0, z: 6, links: [11, 12] },          // 20 south x=0 gap
];

export const COMPOUND = {
  id: 'compound',
  name: 'COMPOUND',
  tagline: 'Close quarters — four rooms and a ring',
  boxes,
  bounds: { min: { x: -18, z: -18 }, max: { x: 18, z: 18 } },
  env: {
    sky: 0x232019, fogNear: 40, fogFar: 100,
    sunPos: [-14, 24, 16], sunColor: 0xffd9a6, sunIntensity: 2.1,
    hemiSky: 0xcbbfa8, hemiGround: 0x4a4438, hemiIntensity: 1.2,
    ambient: 'wind',
  },
  playerSpawns: [
    { pos: { x: -15, y: 0, z: 15 }, yaw: Math.atan2(-15, 15) },
    { pos: { x: 15, y: 0, z: -15 }, yaw: Math.atan2(15, -15) },
    { pos: { x: -15, y: 0, z: -15 }, yaw: Math.atan2(-15, -15) },
  ],
  botSpawns: [
    { x: 11.8, y: 0, z: -11.8 },
    { x: -11.8, y: 0, z: 11.8 },
    { x: 4.5, y: 0, z: -4.5 },
    { x: 11.8, y: 0, z: 11.8 },
    { x: -15.5, y: 0, z: 0 },
  ],
  waypoints,
  // red holds the south-west quadrant of the ring, blue the north-east;
  // yaws face the map center
  teamSpawns: {
    red: [
      { pos: { x: -15, y: 0, z: 15 }, yaw: Math.atan2(-15, 15) },
      { pos: { x: -12, y: 0, z: 15.5 }, yaw: Math.atan2(-12, 15.5) },
      { pos: { x: -15.5, y: 0, z: 12 }, yaw: Math.atan2(-15.5, 12) },
      { pos: { x: -9, y: 0, z: 15.5 }, yaw: Math.atan2(-9, 15.5) },
      { pos: { x: -15.5, y: 0, z: 9 }, yaw: Math.atan2(-15.5, 9) },
      { pos: { x: -12.5, y: 0, z: 12.5 }, yaw: Math.atan2(-12.5, 12.5) },
    ],
    blue: [
      { pos: { x: 15, y: 0, z: -15 }, yaw: Math.atan2(15, -15) },
      { pos: { x: 12, y: 0, z: -15.5 }, yaw: Math.atan2(12, -15.5) },
      { pos: { x: 15.5, y: 0, z: -12 }, yaw: Math.atan2(15.5, -12) },
      { pos: { x: 9, y: 0, z: -15.5 }, yaw: Math.atan2(9, -15.5) },
      { pos: { x: 15.5, y: 0, z: -9 }, yaw: Math.atan2(15.5, -9) },
      { pos: { x: 12.5, y: 0, z: -12.5 }, yaw: Math.atan2(12.5, -12.5) },
    ],
  },
};
