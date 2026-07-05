// Pooled transient effects: tracers and impact puffs. No allocation per shot.

import * as THREE from 'three';

const TRACER_LIFE = 0.07;
const IMPACT_LIFE = 0.3;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // --- tracers: thin additive boxes stretched origin->end ---
    this.tracers = [];
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffd9a0, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    });
    const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    for (let i = 0; i < 24; i++) {
      const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
      mesh.visible = false;
      scene.add(mesh);
      this.tracers.push({ mesh, t: 0 });
    }
    this.tracerIdx = 0;

    // --- impact puffs: additive sprites that pop and fade ---
    const puffTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.5, 'rgba(200,200,200,0.4)');
      g.addColorStop(1, 'rgba(160,160,160,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })();
    this.impacts = [];
    for (let i = 0; i < 32; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: puffTex, transparent: true, depthWrite: false,
      }));
      sprite.visible = false;
      scene.add(sprite);
      this.impacts.push({ sprite, t: 0 });
    }
    this.impactIdx = 0;

    // --- persistent bullet decals: small scorch sprites, ~8s life ---
    const decalTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 32;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(16, 16, 2, 16, 16, 14);
      g.addColorStop(0, 'rgba(20,18,16,0.8)');
      g.addColorStop(0.6, 'rgba(25,23,20,0.45)');
      g.addColorStop(1, 'rgba(30,28,24,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 32, 32);
      return new THREE.CanvasTexture(c);
    })();
    this.decals = [];
    for (let i = 0; i < 48; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: decalTex, transparent: true, depthWrite: false, opacity: 0,
      }));
      sprite.scale.set(0.22, 0.22, 1);
      sprite.visible = false;
      scene.add(sprite);
      this.decals.push({ sprite, t: 0 });
    }
    this.decalIdx = 0;

    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
  }

  decal(pos) {
    const d = this.decals[this.decalIdx];
    this.decalIdx = (this.decalIdx + 1) % this.decals.length;
    d.sprite.position.set(pos.x, pos.y, pos.z);
    d.sprite.material.opacity = 0.75;
    d.sprite.visible = true;
    d.t = 8;
  }

  tracer(from, to, hot = 1) {
    const tr = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    this.from.set(from.x, from.y, from.z);
    this.to.set(to.x, to.y, to.z);
    const len = this.from.distanceTo(this.to);
    if (len < 0.3) return;
    tr.mesh.position.copy(this.from).lerp(this.to, 0.5);
    tr.mesh.scale.set(1, 1, len);
    tr.mesh.lookAt(this.to);
    tr.mesh.material.opacity = 0.55 * hot;
    tr.mesh.visible = true;
    tr.t = TRACER_LIFE;
  }

  impact(pos, mat) {
    const im = this.impacts[this.impactIdx];
    this.impactIdx = (this.impactIdx + 1) % this.impacts.length;
    im.sprite.position.set(pos.x, pos.y, pos.z);
    const metal = mat === 'metal' || mat === 'rail';
    im.sprite.material.color.setHex(metal ? 0xffd080 : 0xb9b4aa);
    im.sprite.scale.set(0.12, 0.12, 1);
    im.sprite.material.opacity = 0.9;
    im.sprite.visible = true;
    im.t = IMPACT_LIFE;
  }

  // red-tinted puff for hits on bots
  blood(pos) {
    const im = this.impacts[this.impactIdx];
    this.impactIdx = (this.impactIdx + 1) % this.impacts.length;
    im.sprite.position.set(pos.x, pos.y, pos.z);
    im.sprite.material.color.setHex(0xd0483a);
    im.sprite.scale.set(0.16, 0.16, 1);
    im.sprite.material.opacity = 0.95;
    im.sprite.visible = true;
    im.t = IMPACT_LIFE;
  }

  update(dt) {
    for (const tr of this.tracers) {
      if (!tr.mesh.visible) continue;
      tr.t -= dt;
      if (tr.t <= 0) tr.mesh.visible = false;
      else tr.mesh.material.opacity = 0.55 * (tr.t / TRACER_LIFE);
    }
    for (const im of this.impacts) {
      if (!im.sprite.visible) continue;
      im.t -= dt;
      if (im.t <= 0) { im.sprite.visible = false; continue; }
      const f = im.t / IMPACT_LIFE;
      im.sprite.material.opacity = f * 0.9;
      const s = im.sprite.scale.x + dt * 1.6;
      im.sprite.scale.set(s, s, 1);
    }
    for (const d of this.decals) {
      if (!d.sprite.visible) continue;
      d.t -= dt;
      if (d.t <= 0) { d.sprite.visible = false; continue; }
      if (d.t < 2) d.sprite.material.opacity = 0.75 * (d.t / 2);
    }
  }
}
