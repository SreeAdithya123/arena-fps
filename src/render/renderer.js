// Three.js presentation layer: arena meshes (built from the sim's box list),
// lighting, bot meshes, camera. Reads sim state; never writes it.

import * as THREE from 'three';
import { ARENA } from '../sim/arena.js';
import { BOT_HEAD_Y, BOT_HEAD_R } from '../sim/bots.js';

// ---------- procedural textures (original, canvas-generated) ----------

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noise(ctx, size, alpha, n = 900) {
  for (let i = 0; i < n; i++) {
    const g = Math.floor(Math.random() * 255);
    ctx.fillStyle = `rgba(${g},${g},${g},${alpha})`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
}

function makeTextures() {
  const concrete = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#8d9094';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 1400);
    ctx.strokeStyle = 'rgba(60,62,66,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2); // panel seam
    ctx.fillStyle = 'rgba(70,72,74,0.18)';
    ctx.fillRect(0, s * 0.72, s, 6);
  });

  const floor = canvasTex(512, (ctx, s) => {
    ctx.fillStyle = '#7d8084';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 3200);
    ctx.strokeStyle = 'rgba(52,54,58,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
    // hazard corner mark
    ctx.fillStyle = 'rgba(213,170,60,0.5)';
    ctx.fillRect(s * 0.04, s * 0.04, s * 0.2, 8);
    ctx.fillRect(s * 0.04, s * 0.04, 8, s * 0.2);
  });

  const metal = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#6a7176';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.04, 700);
    ctx.strokeStyle = 'rgba(40,44,48,0.55)';
    ctx.lineWidth = 3;
    for (const x of [0, s / 2]) {
      ctx.strokeRect(x + 1, 1, s / 2 - 2, s - 2);
    }
    ctx.fillStyle = 'rgba(30,32,36,0.6)';
    for (const x of [s * 0.08, s * 0.42, s * 0.58, s * 0.92]) {
      for (const y of [s * 0.08, s * 0.92]) ctx.fillRect(x - 2, y - 2, 5, 5); // rivets
    }
  });

  const crate = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#5f6e49';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 600);
    ctx.strokeStyle = 'rgba(35,40,28,0.85)';
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, s - 10, s - 10);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(10, 10); ctx.lineTo(s - 10, s - 10);
    ctx.moveTo(s - 10, 10); ctx.lineTo(10, s - 10);
    ctx.stroke();
    ctx.fillStyle = 'rgba(220,215,190,0.55)';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('VY-06', s * 0.36, s * 0.55);
  });

  const wall = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#75797e';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, 0.05, 1000);
    ctx.fillStyle = 'rgba(50,53,57,0.4)';
    ctx.fillRect(0, 0, s, 10);
    ctx.fillRect(0, s - 26, s, 26); // grime base
    ctx.strokeStyle = 'rgba(56,58,62,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, s - 2, s - 2);
  });

  return { concrete, floor, metal, crate, wall, rail: metal };
}

const MAT_PROPS = {
  floor: { rough: 0.93, metal: 0.0, texScale: 4 },
  concrete: { rough: 0.9, metal: 0.0, texScale: 3 },
  wall: { rough: 0.88, metal: 0.05, texScale: 4 },
  metal: { rough: 0.55, metal: 0.55, texScale: 2.5 },
  crate: { rough: 0.75, metal: 0.1, texScale: 1.2 },
  rail: { rough: 0.5, metal: 0.6, texScale: 2 },
};

const BOT_COLORS = [0xc25b4a, 0x4a86c2, 0xc2a24a, 0x7a4ac2, 0x4ac28d];

export class GameRenderer {
  constructor(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1c232d);
    this.scene.fog = new THREE.Fog(0x1c232d, 60, 140);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 200);
    this.camera.rotation.order = 'YXZ';
    this.baseFov = 75;

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    this.buildLights();
    this.buildArena();
    this.buildBots();

    this.projVec = new THREE.Vector3();
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xbdd0e4, 0x55503f, 1.15);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe3b8, 2.4);
    sun.position.set(18, 30, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -32;
    sun.shadow.camera.right = 32;
    sun.shadow.camera.top = 32;
    sun.shadow.camera.bottom = -32;
    sun.shadow.camera.far = 80;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);

    // cool fill from the opposite side, no shadows — keeps dark faces readable
    const fill = new THREE.DirectionalLight(0x91a8c8, 0.5);
    fill.position.set(-14, 18, -20);
    this.scene.add(fill);
  }

  buildArena() {
    const tex = makeTextures();
    for (const box of ARENA.boxes) {
      const sx = box.max.x - box.min.x;
      const sy = box.max.y - box.min.y;
      const sz = box.max.z - box.min.z;
      const props = MAT_PROPS[box.mat] || MAT_PROPS.concrete;
      const t = tex[box.mat] ? tex[box.mat].clone() : tex.concrete.clone();
      const d1 = Math.max(sx, sz), d2 = Math.max(sy, Math.min(sx, sz));
      t.repeat.set(Math.max(1, Math.round(d1 / props.texScale)), Math.max(1, Math.round(d2 / props.texScale)));
      const mat = new THREE.MeshStandardMaterial({
        map: t, roughness: props.rough, metalness: props.metal,
      });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      mesh.position.set(box.min.x + sx / 2, box.min.y + sy / 2, box.min.z + sz / 2);
      mesh.castShadow = box.mat !== 'floor';
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }
  }

  buildBots() {
    this.botViews = ARENA.botSpawns.map((s, i) => {
      const group = new THREE.Group();
      const accent = new THREE.Color(BOT_COLORS[i % BOT_COLORS.length]);

      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a4046, roughness: 0.7, metalness: 0.15 });
      const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.55, metalness: 0.2 });
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.72, 6, 14), bodyMat);
      body.position.y = 0.78;
      body.castShadow = true;
      group.add(body);

      // chest plate — accent color for team-read
      const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.18), accentMat);
      chest.position.set(0, 1.05, -0.28);
      chest.castShadow = true;
      group.add(chest);

      const head = new THREE.Mesh(
        new THREE.SphereGeometry(BOT_HEAD_R, 14, 12),
        new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.4, metalness: 0.5 })
      );
      head.position.y = BOT_HEAD_Y;
      head.castShadow = true;
      group.add(head);

      // visor strip so facing reads at a glance
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.06),
        new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 0.9, roughness: 0.3 })
      );
      visor.position.set(0, BOT_HEAD_Y + 0.02, -0.21);
      group.add(visor);

      this.scene.add(group);
      return {
        group, bodyMat, accentMat,
        flash: 0, deathT: -1,
        prev: { x: s.x, y: s.y, z: s.z, yaw: 0 },
        curr: { x: s.x, y: s.y, z: s.z, yaw: 0 },
      };
    });
  }

  setBotsVisible(visible) {
    for (const v of this.botViews) {
      v.group.visible = visible && v.deathT < 0;
      if (visible) { v.deathT = -1; v.group.rotation.z = 0; }
    }
  }

  // called after every sim tick with fresh bot state
  snapshotBots(bots) {
    for (let i = 0; i < bots.length; i++) {
      const v = this.botViews[i];
      v.prev = v.curr;
      v.curr = { x: bots[i].pos.x, y: bots[i].pos.y, z: bots[i].pos.z, yaw: bots[i].yaw };
    }
  }

  flashBot(id) {
    this.botViews[id].flash = 1;
  }

  killBot(id) {
    this.botViews[id].deathT = 0;
  }

  respawnBot(id) {
    const v = this.botViews[id];
    v.deathT = -1;
    v.flash = 0;
    v.group.visible = true;
    v.group.rotation.z = 0;
    v.group.position.y = v.curr.y;
  }

  updateBots(bots, alpha, dt) {
    for (let i = 0; i < bots.length; i++) {
      const v = this.botViews[i];
      const g = v.group;
      g.position.set(
        v.prev.x + (v.curr.x - v.prev.x) * alpha,
        v.prev.y + (v.curr.y - v.prev.y) * alpha,
        v.prev.z + (v.curr.z - v.prev.z) * alpha
      );
      let dyaw = v.curr.yaw - v.prev.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      g.rotation.y = v.prev.yaw + dyaw * alpha;

      // hit flash
      if (v.flash > 0) {
        v.flash = Math.max(0, v.flash - dt * 7);
        const e = v.flash * 0.9;
        v.bodyMat.emissive.setRGB(e, e * 0.9, e * 0.8);
      } else if (v.bodyMat.emissive.r !== 0) {
        v.bodyMat.emissive.setRGB(0, 0, 0);
      }

      // death: keel over, then sink out
      if (v.deathT >= 0) {
        v.deathT += dt;
        const fall = Math.min(1, v.deathT / 0.35);
        g.rotation.z = (Math.PI / 2) * fall * fall;
        if (v.deathT > 1.6) {
          g.position.y -= (v.deathT - 1.6) * 1.2;
          if (v.deathT > 2.6) g.visible = false;
        }
      }
    }
  }

  setCamera(eye, yaw, pitch, recoilPitch, recoilYaw, targetFov = null) {
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(pitch + recoilPitch, yaw + recoilYaw, 0);
    const target = targetFov === null ? this.baseFov : targetFov;
    if (Math.abs(this.camera.fov - target) > 0.05) {
      this.camera.fov += (target - this.camera.fov) * 0.22;
      this.camera.updateProjectionMatrix();
    }
  }

  // world position -> screen px, or null if behind the camera
  project(p) {
    this.projVec.set(p.x, p.y, p.z).project(this.camera);
    if (this.projVec.z > 1) return null;
    return {
      x: (this.projVec.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projVec.y * 0.5 + 0.5) * window.innerHeight,
    };
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
