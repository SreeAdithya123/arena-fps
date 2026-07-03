// Glue: fixed-timestep sim loop + render interpolation + mode flow.
// Modes: 'menu' -> 'bots' (local sim with bots) or 'friends' (local sim
// without bots + NetClient rooms). The sim itself is identical in both.

import * as THREE from 'three';
import {
  createSim, simTick, respawnPlayer, eyePos, currentSpread, DT, ARENA, WEAPONS,
} from './sim/sim.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { GameRenderer } from './render/renderer.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { Sfx } from './render/audio.js';
import { NetClient, resolveRemoteHit } from './net.js';
import { RemotePlayers } from './render/remotes.js';

const app = document.getElementById('app');
let state = createSim(1337);
const renderer = new GameRenderer(app);
const input = new Input(renderer.renderer.domElement);
const hud = new Hud();
const viewmodel = new ViewModel(renderer.camera, renderer.scene);
const effects = new Effects(renderer.scene);
const sfx = new Sfx();
const remotesView = new RemotePlayers(renderer.scene);

let mode = 'menu'; // 'menu' | 'bots' | 'friends'
let net = null;
let netHealth = 100;
let currentWeapon = 'ar';
let matchOver = false;
let myName = 'PLAYER';
let stateSendTick = 0;

// pre-menu backdrop
state.player.pos = { ...ARENA.playerSpawns[0].pos };
input.setView(ARENA.playerSpawns[0].yaw, 0);

let prevEye = eyePos(state.player);
let currEye = eyePos(state.player);
const muzzleTmp = new THREE.Vector3();

function nameOf(id) {
  if (net && id === net.id) return myName;
  if (net) {
    const r = net.remotes.get(id);
    if (r) return r.name;
    const b = net.board.find((p) => p.id === id);
    if (b) return b.name;
  }
  return '???';
}

function teamOf(id) {
  if (net && id === net.id) return net.team;
  const r = net && net.remotes.get(id);
  return r ? r.team : 'red';
}

// ---------- menu flow ----------
function showMainMenu() {
  mode = 'menu';
  hud.hideLoadout();
  hud.hideResume();
  hud.hideFriends();
  hud.hideMatchUI();
  hud.showMenu(startBots, openFriends);
}

function startBots() {
  hud.hideMenu();
  state = createSim(1337);
  state.player.pos = { ...ARENA.playerSpawns[0].pos };
  renderer.setBotsVisible(true);
  remotesView.clear();
  mode = 'bots';
  hud.showLoadout(false, (id) => {
    sfx.unlock();
    currentWeapon = id;
    const sp = respawnPlayer(state, id);
    afterSpawn(sp);
  });
}

function openFriends() {
  hud.hideMenu();
  hud.showFriends({
    onCreate: (name) => connectRoom(name, null),
    onJoin: (name, code) => connectRoom(name, code),
    onBack: showMainMenu,
  });
}

async function connectRoom(name, code) {
  myName = name;
  hud.setFriendsStatus(code ? 'Joining room…' : 'Creating room…');
  try {
    if (!code) code = await NetClient.createRoom();
    const n = new NetClient();
    wireNet(n);
    const welcome = await n.connect(code, name, currentWeapon);
    net = n;
    mode = 'friends';
    matchOver = false;
    netHealth = 100;

    state = createSim(Date.now() % 100000);
    state.bots.length = 0;
    renderer.setBotsVisible(false);
    remotesView.clear();
    for (const [id, r] of n.remotes) remotesView.ensure(id, r.name, r.team);

    state.player.pos = { ...welcome.spawn.pos };
    input.setView(welcome.spawn.yaw, 0);
    prevEye = currEye = eyePos(state.player);

    hud.hideFriends();
    hud.showMatchUI(code);
    hud.setTeamScores(n.scores.red, n.scores.blue);
    hud.showLoadout(false, pickFriendsWeapon, { code, team: n.team });
  } catch (err) {
    hud.setFriendsStatus(err.message || 'Connection failed.');
  }
}

function pickFriendsWeapon(id) {
  sfx.unlock();
  currentWeapon = id;
  net.sendRespawn(id); // server replies 'respawned' with our spawn point
}

function afterSpawn(spawn) {
  input.setView(spawn.yaw, 0);
  prevEye = currEye = eyePos(state.player);
  viewmodel.setWeapon(currentWeapon);
  hud.hideLoadout();
  input.lock();
}

function leaveRoom() {
  if (net) net.disconnect();
  net = null;
  input.unlock();
  showMainMenu();
}

// ---------- net events ----------
function wireNet(n) {
  n.on('joined', (msg) => {
    remotesView.ensure(msg.id, msg.name, msg.team);
  });
  n.on('left', (msg) => {
    remotesView.remove(msg.id);
  });
  n.on('shot', (msg) => {
    const o = { x: msg.o[0], y: msg.o[1], z: msg.o[2] };
    const e = { x: msg.e[0], y: msg.e[1], z: msg.e[2] };
    effects.tracer(o, e, 0.55);
    sfx.botShot(Math.hypot(o.x - currEye.x, o.z - currEye.z));
  });
  n.on('damaged', (msg) => {
    netHealth = msg.health;
    hud.damageFlash();
    sfx.hurt();
  });
  n.on('hitConfirm', (msg) => {
    if (msg.killed) {
      hud.hitmarker('kill');
      sfx.kill();
    }
  });
  n.on('death', (msg) => {
    if (msg.victim === net.id) {
      netHealth = 0;
      state.player.alive = false;
      sfx.die();
      input.unlock();
      hud.hideResume();
      setTimeout(() => {
        if (mode === 'friends' && !state.player.alive) {
          hud.showLoadout(true, pickFriendsWeapon, { code: net.code, team: net.team });
        }
      }, 600);
    } else {
      remotesView.die(msg.victim);
    }
    hud.killFeed(nameOf(msg.killer), nameOf(msg.victim), msg.headshot, teamOf(msg.killer));
  });
  n.on('respawned', (msg) => {
    if (msg.id === net.id) {
      netHealth = 100;
      respawnPlayer(state, currentWeapon, msg.spawn);
      afterSpawn(msg.spawn);
    } else {
      remotesView.respawn(msg.id);
    }
  });
  n.on('scores', (msg) => {
    hud.setTeamScores(msg.red, msg.blue);
    hud.setScoreboard(msg.board, { red: msg.red, blue: msg.blue }, n.id);
  });
  n.on('over', (msg) => {
    matchOver = true;
    hud.setScoreboard(msg.board, msg.scores, n.id,
      msg.scores.red === msg.scores.blue ? 'DRAW — next round starting soon'
        : `${msg.scores.red > msg.scores.blue ? 'RED' : 'BLUE'} WINS — next round starting soon`);
    hud.showScoreboard(true);
  });
  n.on('reset', (msg) => {
    matchOver = false;
    netHealth = 100;
    hud.showScoreboard(false);
    hud.hideLoadout();
    const spawn = msg.spawns[net.id];
    if (spawn) {
      respawnPlayer(state, currentWeapon, spawn);
      viewmodel.setWeapon(currentWeapon);
      if (!input.locked) hud.showResume(() => { hud.hideResume(); input.lock(); });
    }
  });
  n.on('error', (msg) => hud.setFriendsStatus(msg.msg));
  n.on('close', () => {
    if (mode !== 'friends') return;
    remotesView.clear();
    hud.hideMatchUI();
    hud.showScoreboard(false);
    hud.hideLoadout();
    mode = 'menu';
    net = null;
    input.unlock();
    hud.hideMenu();
    hud.showFriends({
      onCreate: (name) => connectRoom(name, null),
      onJoin: (name, code) => connectRoom(name, code),
      onBack: showMainMenu,
    });
    hud.setFriendsStatus('Disconnected from room.');
  });
}

showMainMenu();

input.onUnlock = () => {
  if (state.player.alive && hud.el.loadout.classList.contains('hidden') && mode !== 'menu') {
    hud.showResume(() => {
      hud.hideResume();
      input.lock();
    });
  }
};

// ---------- sim event handling ----------
function handleEvent(ev) {
  switch (ev.type) {
    case 'shot': {
      // friends mode: check remote hulls before world feedback
      let remoteHit = null;
      if (mode === 'friends' && net) {
        remoteHit = resolveRemoteHit(ev, net);
        if (remoteHit) {
          ev.end = remoteHit.end;
          net.sendHit(remoteHit.id, remoteHit.damage, remoteHit.headshot, remoteHit.end);
        }
        net.sendFire(ev.origin, ev.end);
      }
      viewmodel.onShot(ev.weapon);
      sfx.shot(ev.weapon);
      viewmodel.muzzleWorld(muzzleTmp);
      effects.tracer(muzzleTmp, ev.end, 1);
      if (remoteHit) {
        effects.blood(remoteHit.end);
        remotesView.flash(remoteHit.id);
        hud.hitmarker(remoteHit.headshot ? 'head' : 'hit');
        sfx.hit(remoteHit.headshot);
        const s = renderer.project(remoteHit.end);
        if (s) hud.damageNumber(s.x, s.y, remoteHit.damage, remoteHit.headshot);
      } else if (ev.hit === 'world') {
        effects.impact(ev.end, ev.mat);
      }
      if (ev.hit === 'bot') {
        effects.blood(ev.end);
        renderer.flashBot(ev.botId);
        hud.hitmarker(ev.killed ? 'kill' : ev.headshot ? 'head' : 'hit');
        if (ev.killed) sfx.kill(); else sfx.hit(ev.headshot);
        const s = renderer.project(ev.end);
        if (s) hud.damageNumber(s.x, s.y, ev.damage, ev.headshot);
      }
      break;
    }
    case 'botshot': {
      effects.tracer(ev.origin, ev.end, 0.5);
      if (!ev.hitPlayer && ev.mat) effects.impact(ev.end, ev.mat);
      const d = Math.hypot(ev.origin.x - currEye.x, ev.origin.z - currEye.z);
      sfx.botShot(d);
      break;
    }
    case 'playerhit':
      hud.damageFlash();
      sfx.hurt();
      break;
    case 'botdie':
      renderer.killBot(ev.id);
      break;
    case 'botrespawn':
      renderer.respawnBot(ev.id);
      break;
    case 'reload':
      sfx.reload();
      break;
    case 'playerdie': // bots mode only; friends deaths come from the server
      sfx.die();
      input.unlock();
      hud.hideResume();
      setTimeout(() => {
        if (mode === 'bots') {
          hud.showLoadout(true, (id) => {
            sfx.unlock();
            currentWeapon = id;
            const sp = respawnPlayer(state, id);
            afterSpawn(sp);
          });
        }
      }, 600);
      break;
  }
}

// ---------- main loop ----------
let last = performance.now();
let acc = 0;
let fps = 60, fpsFrames = 0, fpsTime = 0;

function runTick() {
  prevEye = currEye;
  const events = simTick(state, input.sample());
  currEye = eyePos(state.player);
  renderer.snapshotBots(state.bots);
  for (const ev of events) handleEvent(ev);

  if (mode === 'friends' && net && state.player.alive) {
    stateSendTick++;
    if (stateSendTick % 3 === 0) net.sendState(state.player, currentWeapon); // 20 Hz
  }
  return events;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  fpsFrames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    fps = fpsFrames / fpsTime;
    fpsFrames = 0;
    fpsTime = 0;
    hud.setFps(fps);
  }

  acc += dt;
  while (acc >= DT) {
    acc -= DT;
    runTick();
  }
  const alpha = acc / DT;

  const p = state.player;
  const w = p.weapon;

  const eye = {
    x: prevEye.x + (currEye.x - prevEye.x) * alpha,
    y: prevEye.y + (currEye.y - prevEye.y) * alpha,
    z: prevEye.z + (currEye.z - prevEye.z) * alpha,
  };
  const recoilP = w ? w.recoilPitch * 0.7 : 0;
  const recoilY = w ? w.recoilYaw * 0.7 : 0;
  const targetFov = p.aiming && w ? WEAPONS[w.id].aimFov : 75 + (p.sprinting ? 5 : 0);
  renderer.setCamera(eye, input.yaw, input.pitch, recoilP, recoilY, targetFov);

  renderer.updateBots(state.bots, alpha, dt);
  if (net) remotesView.update(net, dt);
  effects.update(dt);

  const md = input.consumeFrameDelta();
  viewmodel.update(dt, {
    mouseDX: md.x,
    mouseDY: md.y,
    speedFrac: p.moveFrac,
    onGround: p.onGround,
    reloadFrac: w && w.reloading ? 1 - w.reloadT / 2.2 : 0,
    aiming: p.aiming,
  });
  hud.setScope(viewmodel.scopedIn());

  if (p.alive && w) {
    hud.setHealth(mode === 'friends' ? netHealth : p.health);
    hud.setAmmo(w);
    hud.setCrosshairSpread(currentSpread(w, p.moveFrac, !p.onGround, p.crouched, p.aiming));
  }

  if (mode === 'friends' && net) {
    hud.setTimer(net.endsAt - Date.now());
    const me = net.board.find((b) => b.id === net.id);
    if (me) hud.setScore(me.kills, me.deaths);
    hud.showScoreboard(matchOver || input.keys.has('Tab'));
  } else {
    hud.setScore(state.kills, state.deaths);
  }
  hud.update(dt);

  renderer.render();
}
requestAnimationFrame(frame);

// Test seam: lets an automated harness drive the game without pointer lock.
window.__game = {
  get state() { return state; },
  get net() { return net; },
  input,
  hud,
  connectRoom,
  pickFriendsWeapon,
  startBots,
  leaveRoom,
  fps: () => fps,
  drive: (fn) => { input.drive = fn; },
  hideOverlays: () => { hud.hideMenu(); hud.hideFriends(); hud.hideLoadout(); hud.hideResume(); },
  spawn: (weaponId) => { // bots-mode spawn shortcut used by automated checks
    if (mode !== 'bots') { hud.hideMenu(); state = createSim(1337); renderer.setBotsVisible(true); remotesView.clear(); mode = 'bots'; }
    currentWeapon = weaponId;
    const sp = respawnPlayer(state, weaponId);
    input.setView(sp.yaw, 0);
    prevEye = currEye = eyePos(state.player);
    viewmodel.setWeapon(weaponId);
    hud.hideLoadout();
  },
  // Render-only cost per frame in ms (n renders + one GPU sync at the end).
  bench: (n = 120) => {
    const gl = renderer.renderer.getContext();
    renderer.render();
    gl.finish();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) renderer.render();
    gl.finish();
    return (performance.now() - t0) / n;
  },
  // Render one frame off-rAF and return a downscaled JPEG (for automated visual checks).
  snap: (w = 480) => {
    const p = state.player;
    renderer.setCamera(currEye, input.yaw, input.pitch, 0, 0);
    renderer.updateBots(state.bots, 1, 0.016);
    viewmodel.update(0.016, { mouseDX: 0, mouseDY: 0, speedFrac: p.moveFrac, onGround: p.onGround, reloadFrac: 0, aiming: p.aiming });
    effects.update(0.008);
    renderer.render();
    const src = renderer.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(w * src.height / src.width);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.5);
  },
  // Synchronously run n sim ticks (rAF suspends in hidden tabs; this doesn't).
  step: (n) => {
    const log = [];
    for (let i = 0; i < n; i++) {
      for (const ev of runTick()) {
        if (ev.type !== 'botshot') log.push(ev.type + (ev.hit ? ':' + ev.hit : ''));
      }
    }
    return log;
  },
};
