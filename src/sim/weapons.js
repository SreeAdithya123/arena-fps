// Weapon definitions + firing/reload/recoil state machine. Pure sim code.
// All three weapons share one hitscan system; only the numbers differ.

import { deg, clamp } from './math.js';

export const WEAPONS = {
  ar: {
    id: 'ar', name: 'VK-32 Talon', desc: 'Full-auto rifle. Learn the climb, own the mid-range.',
    auto: true, interval: 0.1, damage: 26, headMult: 1.8,
    mag: 30, reserve: 120, reloadTime: 1.8,
    spreadBase: deg(0.16), bloomPerShot: deg(0.055), bloomMax: deg(0.85), bloomDecay: deg(2.2),
    movePenalty: deg(0.7), airPenalty: deg(1.4), crouchMult: 0.6,
    // Consecutive-shot kick [pitchDeg, yawDeg]; pattern loops its tail.
    pattern: [
      [0.5, 0], [0.58, 0.05], [0.65, -0.06], [0.72, 0.1], [0.78, -0.12],
      [0.72, 0.2], [0.66, -0.24], [0.6, 0.28], [0.6, -0.28], [0.55, 0.3],
    ],
    patternLoop: 4, recoilMaxPitch: deg(4.5), recover: deg(11),
    aimSpreadMult: 0.45, aimFov: 50, scoped: false,
  },
  dmr: {
    id: 'dmr', name: 'HR-9 Ridgeline', desc: 'Semi-auto marksman. Two shots, no forgiveness.',
    auto: false, interval: 0.34, damage: 55, headMult: 2.0,
    mag: 12, reserve: 60, reloadTime: 2.1,
    spreadBase: deg(0.05), bloomPerShot: deg(0.25), bloomMax: deg(0.6), bloomDecay: deg(1.6),
    movePenalty: deg(1.1), airPenalty: deg(2.2), crouchMult: 0.5,
    pattern: [[1.6, 0.15]],
    patternLoop: 1, recoilMaxPitch: deg(5), recover: deg(7),
    aimSpreadMult: 0.1, aimFov: 26, scoped: true,
  },
  smg: {
    id: 'smg', name: 'MK-4 Wasp', desc: 'Buzzsaw up close. Spray forgiving, falloff cruel.',
    auto: true, interval: 1 / 15, damage: 16, headMult: 1.6,
    mag: 36, reserve: 144, reloadTime: 1.5,
    spreadBase: deg(0.4), bloomPerShot: deg(0.05), bloomMax: deg(1.5), bloomDecay: deg(3),
    movePenalty: deg(0.35), airPenalty: deg(1.0), crouchMult: 0.7,
    pattern: [
      [0.3, 0.04], [0.32, -0.06], [0.34, 0.08], [0.34, -0.1], [0.32, 0.12], [0.3, -0.12],
    ],
    patternLoop: 4, recoilMaxPitch: deg(3), recover: deg(13),
    aimSpreadMult: 0.6, aimFov: 55, scoped: false,
    falloffStart: 12, falloffEnd: 28, falloffMin: 0.6,
  },
  shotgun: {
    id: 'shotgun', name: 'TB-8 Breaker', desc: 'Eight pellets of no. Owns the first five meters.',
    auto: false, interval: 0.85, damage: 13, headMult: 1.4, pellets: 8,
    mag: 6, reserve: 30, reloadTime: 2.4,
    spreadBase: deg(3.2), bloomPerShot: deg(0.1), bloomMax: deg(3.6), bloomDecay: deg(4),
    movePenalty: deg(0.5), airPenalty: deg(1.0), crouchMult: 0.85,
    pattern: [[2.6, 0.2]],
    patternLoop: 1, recoilMaxPitch: deg(6), recover: deg(8),
    aimSpreadMult: 0.7, aimFov: 60, scoped: false,
    falloffStart: 7, falloffEnd: 20, falloffMin: 0.25,
  },
  sniper: {
    id: 'sniper', name: 'LR-50 Aurora', desc: 'One breath, one shot, one lane.',
    auto: false, interval: 1.15, damage: 105, headMult: 2.0,
    mag: 5, reserve: 25, reloadTime: 2.8,
    spreadBase: deg(2.4), bloomPerShot: deg(0.5), bloomMax: deg(3), bloomDecay: deg(2),
    movePenalty: deg(2.0), airPenalty: deg(4.0), crouchMult: 0.9,
    pattern: [[3.2, 0.4]],
    patternLoop: 1, recoilMaxPitch: deg(7), recover: deg(5),
    aimSpreadMult: 0.02, aimFov: 18, scoped: true,
  },
};

// Distance damage falloff (1 at close range, def.falloffMin at long range).
export function falloff(def, dist) {
  if (!def.falloffStart) return 1;
  if (dist <= def.falloffStart) return 1;
  if (dist >= def.falloffEnd) return def.falloffMin;
  const f = (dist - def.falloffStart) / (def.falloffEnd - def.falloffStart);
  return 1 + (def.falloffMin - 1) * f;
}

export function makeWeaponState(id) {
  const def = WEAPONS[id];
  return {
    id, ammo: def.mag, reserve: def.reserve,
    cooldown: 0, reloading: false, reloadT: 0,
    shotIndex: 0, sinceShot: 99,
    bloom: 0, recoilPitch: 0, recoilYaw: 0,
    // recoil offsets at trigger time — the kick lands on the NEXT shot,
    // not the one leaving the barrel
    shotPitch: 0, shotYaw: 0,
  };
}

export function startReload(w) {
  const def = WEAPONS[w.id];
  if (w.reloading || w.ammo >= def.mag || w.reserve <= 0) return false;
  w.reloading = true;
  w.reloadT = def.reloadTime;
  return true;
}

export function currentSpread(w, moveFrac, airborne, crouched, aiming) {
  const def = WEAPONS[w.id];
  let s = def.spreadBase + w.bloom + def.movePenalty * moveFrac + (airborne ? def.airPenalty : 0);
  if (crouched && !airborne) s *= def.crouchMult;
  if (aiming) s *= def.aimSpreadMult;
  return s;
}

// Advance timers; returns true if a shot fires this tick.
// `wantFire` is held-state for autos, `fireEdge` the fresh press for semis.
export function weaponTick(w, wantFire, fireEdge, wantReload, dt) {
  const def = WEAPONS[w.id];
  w.cooldown = Math.max(0, w.cooldown - dt);
  w.sinceShot += dt;

  // bloom decay + recoil recovery (recovery waits a beat after the last shot)
  w.bloom = Math.max(0, w.bloom - def.bloomDecay * dt);
  if (w.sinceShot > 0.08) {
    const r = def.recover * dt;
    w.recoilPitch = Math.max(0, w.recoilPitch - r);
    w.recoilYaw -= Math.sign(w.recoilYaw) * Math.min(Math.abs(w.recoilYaw), r);
  }
  if (w.sinceShot > 0.35) w.shotIndex = 0;

  if (w.reloading) {
    w.reloadT -= dt;
    if (w.reloadT <= 0) {
      const take = Math.min(def.mag - w.ammo, w.reserve);
      w.ammo += take;
      w.reserve -= take;
      w.reloading = false;
    }
    return false;
  }

  if (wantReload) { if (startReload(w)) return false; }

  const trigger = def.auto ? wantFire : fireEdge;
  if (!trigger || w.cooldown > 0) return false;
  if (w.ammo <= 0) {
    startReload(w); // auto-reload on empty trigger pull
    return false;
  }

  // fire — this shot leaves with the CURRENT recoil; the kick applies after
  w.shotPitch = w.recoilPitch;
  w.shotYaw = w.recoilYaw;
  w.ammo--;
  w.cooldown = def.interval;
  w.sinceShot = 0;
  w.bloom = Math.min(def.bloomMax - def.spreadBase, w.bloom + def.bloomPerShot);
  const p = def.pattern;
  const i = w.shotIndex < p.length
    ? w.shotIndex
    : p.length - def.patternLoop + ((w.shotIndex - p.length) % def.patternLoop);
  w.recoilPitch = clamp(w.recoilPitch + deg(p[i][0]), 0, def.recoilMaxPitch);
  w.recoilYaw += deg(p[i][1]);
  w.shotIndex++;
  return true;
}
