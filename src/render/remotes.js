// Remote player rendering for friend rooms: team-colored soldier meshes with
// nameplates, fed by NetClient's interpolated snapshots.

import * as THREE from 'three';

const TEAM_COLORS = { red: 0xd6543f, blue: 0x3f7dd6 };

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
  sprite.position.y = 2.05;
  return sprite;
}

function buildSoldier(team, name) {
  const group = new THREE.Group();
  const accent = new THREE.Color(TEAM_COLORS[team]);

  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.7, metalness: 0.15 });
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, metalness: 0.2 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 6, 14), bodyMat);
  body.position.y = 0.78;
  body.castShadow = true;
  group.add(body);

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.18), accentMat);
  chest.position.set(0, 1.05, -0.28);
  chest.castShadow = true;
  group.add(chest);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 14, 12),
    new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.4, metalness: 0.5 })
  );
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.08, 0.06),
    new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.3 })
  );
  visor.position.set(0, 1.64, -0.21);
  group.add(visor);

  // stub rifle so remotes read as armed
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.5, metalness: 0.6 }));
  gun.position.set(0.22, 1.15, -0.35);
  group.add(gun);

  group.add(makeNameplate(name, `#${accent.getHexString()}`));
  return { group, bodyMat };
}

export class RemotePlayers {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map(); // id -> { group, bodyMat, flash, deathT }
  }

  ensure(id, name, team) {
    if (this.views.has(id)) return;
    const { group, bodyMat } = buildSoldier(team, name);
    this.scene.add(group);
    this.views.set(id, { group, bodyMat, flash: 0, deathT: -1 });
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
    if (v) v.flash = 1;
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

      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 7);
        const e = v.flash * 0.9;
        v.bodyMat.emissive.setRGB(e, e * 0.9, e * 0.8);
      } else if (v.bodyMat.emissive.r !== 0) {
        v.bodyMat.emissive.setRGB(0, 0, 0);
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
