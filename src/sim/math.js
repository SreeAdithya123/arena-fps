// Pure math for the simulation. No three.js imports anywhere in src/sim/ —
// the sim must run headless (see test/headless.js) so a server can drive it later.

export const DT = 1 / 60;
export const EPS = 0.001;

// Deterministic RNG — all sim randomness flows through one seeded stream.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const deg = (d) => (d * Math.PI) / 180;

export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vlen = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const dist3d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export function norm(v) {
  const l = vlen(v);
  if (l > 0) { v.x /= l; v.y /= l; v.z /= l; }
  return v;
}

export function cross(a, b) {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

// Forward direction from yaw/pitch. yaw 0 faces -Z (three.js YXZ convention),
// positive pitch looks up.
export function aimDir(yaw, pitch) {
  const cp = Math.cos(pitch);
  return v3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

export function yawPitchTo(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.asin(clamp(dy / Math.hypot(dx, dy, dz), -1, 1));
  return { yaw, pitch };
}

// Perturb a unit direction within a cone of half-angle `spread` radians.
export function coneSpread(dir, spread, rng) {
  if (spread <= 0) return { ...dir };
  const up = Math.abs(dir.y) > 0.99 ? v3(1, 0, 0) : v3(0, 1, 0);
  const t1 = norm(cross(up, dir));
  const t2 = cross(dir, t1);
  const ang = rng() * Math.PI * 2;
  const r = Math.tan(spread) * Math.sqrt(rng());
  const d = v3(
    dir.x + (Math.cos(ang) * t1.x + Math.sin(ang) * t2.x) * r,
    dir.y + (Math.cos(ang) * t1.y + Math.sin(ang) * t2.y) * r,
    dir.z + (Math.cos(ang) * t1.z + Math.sin(ang) * t2.z) * r
  );
  return norm(d);
}

// Ray vs AABB (slab method). d need not be normalized if tMax is in the same units.
// Returns entry t in [0, tMax] or Infinity.
export function rayAABB(o, d, min, max, tMax) {
  let tmin = 0, tmax = tMax;
  const axes = ['x', 'y', 'z'];
  for (const ax of axes) {
    const dv = d[ax], ov = o[ax];
    if (Math.abs(dv) < 1e-9) {
      if (ov < min[ax] || ov > max[ax]) return Infinity;
    } else {
      let t1 = (min[ax] - ov) / dv;
      let t2 = (max[ax] - ov) / dv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return Infinity;
    }
  }
  return tmin;
}

// Ray (normalized d) vs sphere. Returns t in [0, tMax] or Infinity.
export function raySphere(o, d, c, r, tMax) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= tMax ? t : Infinity;
}

export const aabbOverlap = (minA, maxA, minB, maxB) =>
  minA.x < maxB.x && maxA.x > minB.x &&
  minA.y < maxB.y && maxA.y > minB.y &&
  minA.z < maxB.z && maxA.z > minB.z;
