// Arena queries. Maps live in ./maps/; everything here takes the map as an
// explicit argument so the sim stays pure and multi-map.

import { rayAABB } from './math.js';

export { MAPS, MAP_LIST, DEFAULT_MAP } from './maps/index.js';

// Nearest world hit along a ray. Returns { t, mat } or null.
export function raycastArena(map, o, d, tMax) {
  let best = Infinity, mat = null;
  for (const b of map.boxes) {
    const t = rayAABB(o, d, b.min, b.max, tMax);
    if (t < best) { best = t; mat = b.mat; }
  }
  return best < Infinity ? { t: best, mat } : null;
}
