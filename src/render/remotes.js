// Soldier model shared by bots and remote players, plus the remote-player
// manager (interpolation-driven rendering, nameplates, blob shadows, flinch,
// footstep emission). Team colors stay strictly red/blue for readability.

import * as THREE from 'three';

export const TEAM_COLORS = { red: 0xd6543f, blue: 0x3f7dd6 };

function makeNameplate(name, teamColor) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = teamColor;
  ctx.fillText(name, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false,
  }));
  sprite.scale.set(1.5, 0.28, 1);
  sprite.position.y = 2.1;
  return sprite;
}

let blobTex = null;
function makeBlobShadow() {
  if (!blobTex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    blobTex = new THREE.CanvasTexture(c);
  }
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  return blob;
}

// Original primitive-built soldier. Silhouette: helmet + visor, chest plate,
// backpack, legs, held rifle. Accent = team color, large readable surfaces.
export function buildSoldier(accentHex, name = null) {
  const group = new THREE.Group();
  const accent = new THREE.Color(accentHex);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x353b41, roughness: 0.72, metalness: 0.12 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x24282d, roughness: 0.6, metalness: 0.3 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, metalness: 0.2 });

  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); group.add(mesh); return mesh; };

  // torso
  add(new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.6, 6, 12), bodyMat), 0, 0.86, 0);
  // chest + back plates (big team-color read, front and back)
  add(new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.46, 0.16), accentMat), 0, 1.06, -0.26);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.2), accentMat), 0, 1.02, 0.26); // backpack
  // shoulders
  add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.3), accentMat), -0.4, 1.28, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.3), accentMat), 0.4, 1.28, 0);
  // legs
  add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 0.22), darkMat), -0.15, 0.26, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.52, 0.22), darkMat), 0.15, 0.26, 0);
  // head + helmet + visor
  add(new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), darkMat), 0, 1.62, 0);
  const helmet = add(new THREE.Mesh(
    new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), bodyMat), 0, 1.64, 0);
  helmet.rotation.x = -0.15;
  const visor = add(new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.09, 0.06),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.3 })
  ), 0, 1.63, -0.22);
  // held rifle
  add(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.58), darkMat), 0.24, 1.12, -0.3);

  group.add(makeBlobShadow());
  if (name) group.add(makeNameplate(name, `#${accent.getHexString()}`));

  // frozen shadow map: characters never cast (they get blob shadows instead)
  group.traverse((o) => { o.castShadow = false; o.receiveShadow = false; });
  return { group, bodyMat, accentMat, visor };
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map(); // id -> { group, bodyMat, flash, flinch, deathT, stepAcc, lastPos }
    this.onStep = null; // set by main: (pos) => sfx.footstep(pos)
  }

  ensure(id, name, team) {
    if (this.views.has(id)) return;
    const { group, bodyMat } = buildSoldier(TEAM_COLORS[team] || TEAM_COLORS.red, name);
    this.scene.add(group);
    this.views.set(id, { group, bodyMat, flash: 0, flinch: 0, deathT: -1, stepAcc: 0, lastPos: null });
  }

  remove(id) {
    const v = this.views.get(id);
    if (!v) return;
    this.scene.remove(v.group);
    this.views.delete(id);
  }

  clear() {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  flash(id) {
    const v = this.views.get(id);
    if (v) { v.flash = 1; v.flinch = 1; }
  }

  die(id) {
    const v = this.views.get(id);
    if (v) v.deathT = 0;
  }

  respawn(id) {
    const v = this.views.get(id);
    if (!v) return;
    v.deathT = -1;
    v.flash = 0;
    v.group.visible = true;
    v.group.rotation.z = 0;
    v.group.scale.y = 1;
  }

  update(net, dt) {
    const now = performance.now();
    for (const [id, v] of this.views) {
      const s = net.sampleRemote(id, now);
      if (!s) { v.group.visible = false; continue; }
      // pre-spawn or dead players don't render (death anim overrides briefly)
      if (v.deathT < 0) v.group.visible = s.alive;
      v.group.position.set(s.p[0], s.p[1], s.p[2]);
      v.group.rotation.y = s.yaw;
      v.group.scale.y = s.crouch ? 0.72 : 1;

      // footsteps from actual movement
      if (v.group.visible && s.alive) {
        if (v.lastPos) {
          const moved = Math.hypot(s.p[0] - v.lastPos[0], s.p[2] - v.lastPos[2]);
          v.stepAcc += moved;
          if (v.stepAcc > 2.4) {
            v.stepAcc = 0;
            if (this.onStep) this.onStep({ x: s.p[0], y: s.p[1], z: s.p[2] });
          }
        }
        v.lastPos = s.p;
      }

      // hit flash + flinch jab
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 7);
        const e = v.flash * 0.9;
        v.bodyMat.emissive.setRGB(e, e * 0.9, e * 0.8);
      } else if (v.bodyMat.emissive.r !== 0) {
        v.bodyMat.emissive.setRGB(0, 0, 0);
      }
      if (v.flinch > 0) {
        v.flinch = Math.max(0, v.flinch - dt * 6);
        v.group.rotation.x = Math.sin(v.flinch * 26) * 0.05 * v.flinch;
      } else if (v.deathT < 0) {
        v.group.rotation.x = 0;
      }

      if (v.deathT >= 0) {
        v.deathT += dt;
        const fall = Math.min(1, v.deathT / 0.35);
        v.group.rotation.z = (Math.PI / 2) * fall * fall;
        if (v.deathT > 1.2) v.group.visible = false;
      }
    }
  }
}
