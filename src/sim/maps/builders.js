// Shared helpers for authoring map geometry. Pure data construction.

export const B = (x1, y1, z1, x2, y2, z2, mat) => ({
  min: { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
  max: { x: Math.max(x1, x2), y: Math.max(y1, y2), z: Math.max(z1, z2) },
  mat,
});

export const crate = (x, z, lift = 0, size = 1.2) =>
  B(x - size / 2, lift, z - size / 2, x + size / 2, lift + size, z + size / 2, 'crate');

// Wall running along X at fixed z, with door gaps: gaps = [[gx1, gx2], ...]
export function wallX(boxes, z, x1, x2, h, t, gaps = [], mat = 'wall') {
  const spans = cut([x1, x2], gaps);
  for (const [a, b] of spans) boxes.push(B(a, 0, z - t / 2, b, h, z + t / 2, mat));
}

// Wall running along Z at fixed x
export function wallZ(boxes, x, z1, z2, h, t, gaps = [], mat = 'wall') {
  const spans = cut([z1, z2], gaps);
  for (const [a, b] of spans) boxes.push(B(x - t / 2, 0, a, x + t / 2, b, h, mat));
}

function cut([a, b], gaps) {
  const sorted = [...gaps].sort((g, h) => g[0] - h[0]);
  const spans = [];
  let cur = a;
  for (const [g1, g2] of sorted) {
    if (g1 > cur) spans.push([cur, g1]);
    cur = Math.max(cur, g2);
  }
  if (cur < b) spans.push([cur, b]);
  return spans;
}

// Stairs whose TOP edge sits at (x, z), flush with a platform of height `top`.
// dir is the direction you WALK to climb them ('x+' = walking +x reaches the top).
// Step heights satisfy the sim's 0.45m step-up.
export function stairs(boxes, x, z, width, top, dir, mat = 'metal') {
  const steps = Math.ceil(top / 0.4);
  const run = 0.7;
  for (let i = 0; i < steps; i++) {
    const h = Math.max(0.4, top - 0.4 * i); // nearest step is flush with the top
    const d0 = run * i, d1 = run * (i + 1);
    if (dir === 'x+') boxes.push(B(x - d1, 0, z - width / 2, x - d0, h, z + width / 2, mat));
    if (dir === 'x-') boxes.push(B(x + d0, 0, z - width / 2, x + d1, h, z + width / 2, mat));
    if (dir === 'z+') boxes.push(B(x - width / 2, 0, z - d1, x + width / 2, h, z - d0, mat));
    if (dir === 'z-') boxes.push(B(x - width / 2, 0, z + d0, x + width / 2, h, z + d1, mat));
  }
}
