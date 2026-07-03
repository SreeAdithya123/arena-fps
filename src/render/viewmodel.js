// First-person weapon models — three original guns built from primitives,
// with sway, walk bob, fire kick, muzzle flash, and reload animation.

import * as THREE from 'three';

const DARK = new THREE.MeshStandardMaterial({ color: 0x2e3238, roughness: 0.45, metalness: 0.7 });
const GRIP = new THREE.MeshStandardMaterial({ color: 0x1d2023, roughness: 0.8, metalness: 0.2 });
const ACCENT = new THREE.MeshStandardMaterial({ color: 0xc9a03c, roughness: 0.5, metalness: 0.6 });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(r, len, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

// Each builder returns { group, muzzle: Vector3 local, mag: Mesh }
function buildAR() {
  const g = new THREE.Group();
  g.add(box(0.075, 0.09, 0.46, DARK, 0, 0, -0.05));          // receiver
  g.add(cyl(0.02, 0.3, DARK, 0, 0.005, -0.42));               // barrel
  g.add(box(0.05, 0.05, 0.16, GRIP, 0, -0.005, -0.33));       // handguard
  g.add(box(0.055, 0.03, 0.2, GRIP, 0, 0.06, -0.1));          // top rail
  g.add(box(0.018, 0.03, 0.05, ACCENT, 0, 0.075, -0.13));     // rear sight
  g.add(box(0.016, 0.045, 0.016, ACCENT, 0, 0.085, -0.28));   // front post
  g.add(box(0.05, 0.13, 0.07, GRIP, 0, -0.1, 0.08));          // grip
  g.add(box(0.06, 0.09, 0.16, DARK, 0, -0.02, 0.24));         // stock
  const mag = box(0.045, 0.16, 0.07, GRIP, 0, -0.11, -0.06);
  mag.rotation.x = 0.25;
  g.add(mag);
  return { group: g, muzzle: new THREE.Vector3(0, 0.005, -0.58), mag };
}

function buildDMR() {
  const g = new THREE.Group();
  g.add(box(0.07, 0.095, 0.5, DARK, 0, 0, -0.02));
  g.add(cyl(0.018, 0.5, DARK, 0, 0.005, -0.5));
  g.add(cyl(0.016, 0.09, ACCENT, 0, 0.005, -0.73));           // muzzle brake
  g.add(cyl(0.035, 0.2, DARK, 0, 0.095, -0.06));              // scope tube
  g.add(cyl(0.042, 0.03, ACCENT, 0, 0.095, -0.17));           // objective ring
  g.add(box(0.05, 0.14, 0.07, GRIP, 0, -0.1, 0.1));
  g.add(box(0.06, 0.1, 0.2, GRIP, 0, -0.025, 0.28));
  const mag = box(0.04, 0.12, 0.06, GRIP, 0, -0.1, -0.05);
  g.add(mag);
  return { group: g, muzzle: new THREE.Vector3(0, 0.005, -0.78), mag };
}

function buildSMG() {
  const g = new THREE.Group();
  g.add(box(0.08, 0.1, 0.3, DARK, 0, 0, 0));
  g.add(cyl(0.022, 0.12, DARK, 0, 0.01, -0.2));
  g.add(box(0.05, 0.04, 0.1, ACCENT, 0, 0.07, -0.05));
  g.add(box(0.05, 0.12, 0.06, GRIP, 0, -0.1, 0.08));
  g.add(box(0.04, 0.1, 0.05, GRIP, 0, -0.09, -0.1));          // foregrip
  const mag = box(0.045, 0.2, 0.06, GRIP, 0, -0.14, 0.0);
  g.add(mag);
  return { group: g, muzzle: new THREE.Vector3(0, 0.01, -0.28), mag };
}

const BUILDERS = { ar: buildAR, dmr: buildDMR, smg: buildSMG };

export class ViewModel {
  constructor(camera, scene) {
    this.camera = camera;
    scene.add(camera); // camera must be in the scene graph for children to render

    this.root = new THREE.Group();
    this.root.position.set(0.26, -0.25, -0.45);
    camera.add(this.root);

    this.guns = {};
    for (const [id, build] of Object.entries(BUILDERS)) {
      const { group, muzzle, mag } = build();
      group.visible = false;
      this.root.add(group);
      this.guns[id] = { group, muzzleLocal: muzzle, mag, magHome: mag.position.clone() };
    }
    this.active = null;

    // muzzle flash: additive sprite + point light, both pulsed on shot
    const flashTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const ctx = c.getContext('2d');
      const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      grad.addColorStop(0, 'rgba(255,240,200,1)');
      grad.addColorStop(0.35, 'rgba(255,190,90,0.85)');
      grad.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.flash.scale.set(0.22, 0.22, 1);
    this.flash.visible = false;
    this.root.add(this.flash);

    this.flashLight = new THREE.PointLight(0xffc070, 0, 6, 2);
    this.root.add(this.flashLight);

    this.flashT = 0;
    this.kickZ = 0;
    this.kickRot = 0;
    this.swayX = 0;
    this.swayY = 0;
    this.bobT = 0;
    this.aimFrac = 0;
    this.activeId = null;
  }

  setWeapon(id) {
    for (const g of Object.values(this.guns)) g.group.visible = false;
    this.active = this.guns[id];
    this.activeId = id;
    this.active.group.visible = true;
    this.flash.position.copy(this.active.muzzleLocal);
    this.flashLight.position.copy(this.active.muzzleLocal);
  }

  // world-space muzzle position for tracer spawn
  muzzleWorld(out) {
    if (!this.active) return out.set(0, 0, 0);
    out.copy(this.active.muzzleLocal);
    this.active.group.updateWorldMatrix(true, false);
    return this.active.group.localToWorld(out);
  }

  onShot(weaponId) {
    const strength = weaponId === 'dmr' ? 1.8 : weaponId === 'smg' ? 0.6 : 1;
    this.kickZ = Math.min(0.09, this.kickZ + 0.045 * strength);
    this.kickRot = Math.min(0.22, this.kickRot + 0.1 * strength);
    this.flashT = 0.05;
    this.flash.material.rotation = Math.random() * Math.PI * 2;
    const s = 0.16 + Math.random() * 0.1 + (weaponId === 'dmr' ? 0.12 : 0);
    this.flash.scale.set(s, s, 1);
  }

  // true when the DMR scope overlay should cover the screen
  scopedIn() {
    return this.activeId === 'dmr' && this.aimFrac > 0.75;
  }

  update(dt, opts) {
    // opts: { mouseDX, mouseDY, speedFrac, onGround, reloadFrac, aiming }
    if (!this.active) return;

    // ADS blend: gun slides toward screen center, sway/bob damp out
    const aimTarget = opts.aiming ? 1 : 0;
    this.aimFrac += (aimTarget - this.aimFrac) * Math.min(1, dt * 12);
    const a = this.aimFrac;
    const damp = 1 - a * 0.8;

    // sway opposes mouse movement, springs back
    this.swayX += (-opts.mouseDX * 0.00028 * damp - this.swayX) * Math.min(1, dt * 10);
    this.swayY += (opts.mouseDY * 0.00028 * damp - this.swayY) * Math.min(1, dt * 10);

    // walk bob
    if (opts.onGround && opts.speedFrac > 0.05) {
      this.bobT += dt * (6 + 6 * opts.speedFrac);
    }
    const bobAmp = 0.008 * opts.speedFrac * damp;
    const bobX = Math.sin(this.bobT) * bobAmp;
    const bobY = -Math.abs(Math.cos(this.bobT)) * bobAmp * 1.2;

    // fire kick decay
    this.kickZ *= Math.exp(-dt * 11);
    this.kickRot *= Math.exp(-dt * 12);

    // reload dip: gun swings down and back over the reload
    let reloadDip = 0;
    if (opts.reloadFrac > 0) {
      reloadDip = Math.sin(Math.min(1, opts.reloadFrac) * Math.PI) * 0.85;
      const magOut = Math.sin(Math.min(1, opts.reloadFrac) * Math.PI);
      this.active.mag.position.y = this.active.magHome.y - magOut * 0.12;
    } else {
      this.active.mag.position.copy(this.active.magHome);
    }

    // hip pose -> aim pose (centered under the eye)
    const px = 0.26 * (1 - a);
    const py = -0.25 + 0.06 * a;
    const pz = -0.45 + 0.1 * a;
    this.root.position.set(
      px + this.swayX + bobX,
      py + this.swayY + bobY - reloadDip * 0.12,
      pz + this.kickZ
    );
    this.root.rotation.set(-this.kickRot * 0.6 - reloadDip * 0.9 + this.swayY * 2, this.swayX * 2, 0);

    // fully scoped DMR: hide the gun, the scope overlay takes over
    this.active.group.visible = !this.scopedIn();

    // muzzle flash pulse
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.flash.visible = this.flashT > 0;
      this.flashLight.intensity = this.flashT > 0 ? 14 : 0;
    } else {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    }
  }
}
