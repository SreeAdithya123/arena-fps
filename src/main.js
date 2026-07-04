// Glue: fixed-timestep sim loop + render interpolation + mode flow.
// Modes: 'menu' -> 'bots' (local sim with bots) or 'friends' (rooms with a
// lobby -> live -> over -> lobby lifecycle owned by the server).

import * as THREE from 'three';
import {
  createSim, simTick, respawnPlayer, eyePos, currentSpread, DT, ARENA, WEAPONS,
} from './sim/sim.js';
import { aimDir, norm } from './sim/math.js';
import { raycastArena } from './sim/arena.js';
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

// spectator camera (friends mode, team 'spec')
const spectate = {
  active: false,
  free: false,
  idx: 0,
  pos: { x: 0, y: 10, z: 16 },
  lastF: false,
  lastAim: false,
};

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
  exitSpectate();
  hud.hideLoadout();
  hud.hideResume();
  hud.hideFriends();
  hud.hideLobby();
  hud.hideMatchUI();
  hud.showScoreboard(false);
  hud.showMenu(startBots, openFriends);
}

function startBots() {
  hud.hideMenu();
  state = createSim(1337);
  state.player.pos = { ...ARENA.playerSpawns[0].pos };
  renderer.setBotsVisible(true);
  remotesView.clear();
  mode = 'bots';
  hud.showLoadout(false, pickBotsWeapon, null, showMainMenu);
}

function pickBotsWeapon(id) {
  sfx.unlock();
  currentWeapon = id;
  const sp = respawnPlayer(state, id);
  afterSpawn(sp);
}

function openFriends(prefillCode = '') {
  hud.hideMenu();
  if (prefillCode) hud.el.codeInput.value = prefillCode;
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
    await n.connect(code, name, currentWeapon);
    net = n;
    mode = 'friends';
    matchOver = false;
    netHealth = 100;

    state = createSim(Date.now() % 100000);
    state.bots.length = 0;
    renderer.setBotsVisible(false);
    rebuildRemotes();

    state.player.pos = { ...ARENA.playerSpawns[0].pos };
    input.setView(ARENA.playerSpawns[0].yaw, 0);
    prevEye = currEye = eyePos(state.player);

    hud.hideMenu();
    hud.hideFriends();
    if (n.phase === 'live') {
      // late join into a running match
      hud.showMatchUI(code);
      hud.setTeamScores(n.scores.red, n.scores.blue);
      if (n.team === 'spec') enterSpectate();
      else hud.showLoadout(false, pickFriendsWeapon, { code, team: n.team }, leaveRoom);
    } else {
      showLobbyScreen();
    }
  } catch (err) {
    hud.setFriendsStatus(err.message || 'Connection failed.');
  }
}

function roomLink() {
  return `${location.origin}/?room=${net.code}`;
}

function showLobbyScreen() {
  hud.hideMatchUI();
  hud.hideLoadout();
  hud.hideResume();
  hud.showScoreboard(false);
  hud.showLobby(net.code, {
    onSwitch: (team) => net.sendSwitchTeam(team),
    onStart: () => net.sendStart(),
    onLeave: leaveRoom,
    link: roomLink(),
  });
  hud.updateLobby({ leader: net.leader, players: net.board }, net.id, net.team);
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

function rebuildRemotes() {
  remotesView.clear();
  if (!net) return;
  for (const [id, r] of net.remotes) {
    if (r.team !== 'spec') remotesView.ensure(id, r.name, r.team);
  }
}

// ---------- spectate ----------
function spectateTargets() {
  const out = [];
  if (!net) return out;
  for (const [id, r] of net.remotes) {
    if (r.team === 'spec' || !r.alive) continue;
    if (net.sampleRemote(id)) out.push(id);
  }
  return out;
}

function enterSpectate() {
  spectate.active = true;
  spectate.free = false;
  spectate.idx = 0;
  spectate.pos = { x: 0, y: 10, z: 16 };
  hud.hideLoadout();
  hud.setSpectate(true);
  input.lock();
}

function exitSpectate() {
  if (!spectate.active) return;
  spectate.active = false;
  hud.setSpectate(false);
}

function spectateHandleCmd(cmd) {
  const targets = spectateTargets();
  if (cmd.fireEdge && targets.length) {
    spectate.free = false;
    spectate.idx = (spectate.idx + 1) % targets.length;
  }
  if (cmd.aim && !spectate.lastAim && targets.length) {
    spectate.free = false;
    spectate.idx = (spectate.idx - 1 + targets.length) % targets.length;
  }
  spectate.lastAim = cmd.aim;
  const fHeld = input.keys.has('KeyF');
  if (fHeld && !spectate.lastF) spectate.free = !spectate.free;
  spectate.lastF = fHeld;
}

// per-frame spectator camera; returns camera pose or null
function spectateCamera(dt) {
  const targets = spectateTargets();
  if (!spectate.free && targets.length) {
    const id = targets[spectate.idx % targets.length];
    const s = net.sampleRemote(id);
    const head = { x: s.p[0], y: s.p[1] + (s.crouch ? 1.1 : 1.6), z: s.p[2] };
    const dir = aimDir(input.yaw, input.pitch);
    // pull the orbit camera in when a wall sits between it and the target
    let r = 4.2;
    const back = norm({ x: -dir.x, y: -dir.y + 0.07, z: -dir.z });
    const hit = raycastArena(head, back, r);
    if (hit) r = Math.max(0.6, hit.t - 0.3);
    spectate.pos = { x: head.x + back.x * r, y: head.y + back.y * r, z: head.z + back.z * r };
    hud.setSpectate(true, nameOf(id));
    return { pos: spectate.pos, yaw: input.yaw, pitch: input.pitch };
  }
  // free fly
  const k = input.keys;
  const speed = (k.has('ShiftLeft') ? 22 : 12) * dt;
  const fwd = aimDir(input.yaw, input.pitch);
  const right = { x: Math.cos(input.yaw), z: -Math.sin(input.yaw) };
  const mz = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
  spectate.pos.x += (fwd.x * mz + right.x * mx) * speed;
  spectate.pos.y += (fwd.y * mz + ((k.has('Space') ? 1 : 0) - (k.has('KeyC') ? 1 : 0))) * speed;
  spectate.pos.z += (fwd.z * mz + right.z * mx) * speed;
  spectate.pos.y = Math.max(0.5, Math.min(30, spectate.pos.y));
  hud.setSpectate(true, 'FREE CAMERA');
  return { pos: spectate.pos, yaw: input.yaw, pitch: input.pitch };
}

// ---------- net events ----------
function wireNet(n) {
  n.on('joined', (msg) => {
    if (msg.team !== 'spec') remotesView.ensure(msg.id, msg.name, msg.team);
  });
  n.on('left', (msg) => {
    remotesView.remove(msg.id);
    if (!hud.el.lobby.classList.contains('hidden')) {
      hud.updateLobby({ leader: n.leader, players: n.board }, n.id, n.team);
    }
  });
  n.on('roster', () => {
    if (!hud.el.lobby.classList.contains('hidden')) {
      hud.updateLobby({ leader: n.leader, players: n.board }, n.id, n.team);
    }
  });
  n.on('start', () => {
    matchOver = false;
    netHealth = 100;
    hud.hideLobby();
    hud.showScoreboard(false);
    rebuildRemotes(); // teams are final now — meshes get the right colors
    hud.showMatchUI(n.code);
    hud.setTeamScores(0, 0);
    if (n.team === 'spec') {
      enterSpectate();
    } else {
      exitSpectate();
      hud.showLoadout(false, pickFriendsWeapon, { code: n.code, team: n.team }, leaveRoom);
    }
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
        if (mode === 'friends' && net && net.phase === 'live' && !state.player.alive) {
          hud.showLoadout(true, pickFriendsWeapon, { code: net.code, team: net.team }, leaveRoom);
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
    input.unlock();
    hud.hideResume();
    hud.hideLoadout();
    hud.setScoreboard(msg.board, msg.scores, n.id,
      (msg.scores.red === msg.scores.blue ? 'DRAW' :
        `${msg.scores.red > msg.scores.blue ? 'RED' : 'BLUE'} WINS`) + ' — back to lobby in a moment…');
    hud.showScoreboard(true);
  });
  n.on('lobby', () => {
    matchOver = false;
    exitSpectate();
    state.player.alive = false;
    input.unlock();
    showLobbyScreen();
  });
  n.on('error', (msg) => hud.setFriendsStatus(msg.msg));
  n.on('close', () => {
    if (mode !== 'friends') return;
    exitSpectate();
    remotesView.clear();
    hud.hideMatchUI();
    hud.hideLobby();
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

// boot: deep link support — /?room=CODE opens the join screen pre-filled
const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam && /^[A-Za-z]{5}$/.test(roomParam)) {
  mode = 'menu';
  openFriends(roomParam.toUpperCase());
} else {
  showMainMenu();
}

input.onUnlock = () => {
  const inGame = (state.player.alive || spectate.active) && mode !== 'menu';
  if (inGame && hud.el.loadout.classList.contains('hidden') && hud.el.lobby.classList.contains('hidden') && !matchOver) {
    hud.showResume(
      () => { hud.hideResume(); input.lock(); },
      () => { if (mode === 'friends') leaveRoom(); else showMainMenu(); }
    );
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
          hud.showLoadout(true, pickBotsWeapon, null, showMainMenu);
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
  const cmd = input.sample();
  if (spectate.active) spectateHandleCmd(cmd);
  const events = simTick(state, cmd);
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

  if (spectate.active) {
    const cam = spectateCamera(dt);
    renderer.setCamera(cam.pos, cam.yaw, cam.pitch, 0, 0, 75);
  } else {
    const eye = {
      x: prevEye.x + (currEye.x - prevEye.x) * alpha,
      y: prevEye.y + (currEye.y - prevEye.y) * alpha,
      z: prevEye.z + (currEye.z - prevEye.z) * alpha,
    };
    const recoilP = w ? w.recoilPitch * 0.7 : 0;
    const recoilY = w ? w.recoilYaw * 0.7 : 0;
    const targetFov = p.aiming && w ? WEAPONS[w.id].aimFov : 75 + (p.sprinting ? 5 : 0);
    renderer.setCamera(eye, input.yaw, input.pitch, recoilP, recoilY, targetFov);
  }

  renderer.updateBots(state.bots, alpha, dt);
  if (net) remotesView.update(net, dt);
  effects.update(dt);

  viewmodel.root.visible = !spectate.active;
  const md = input.consumeFrameDelta();
  viewmodel.update(dt, {
    mouseDX: md.x,
    mouseDY: md.y,
    speedFrac: p.moveFrac,
    onGround: p.onGround,
    reloadFrac: w && w.reloading ? 1 - w.reloadT / 2.2 : 0,
    aiming: p.aiming,
  });
  hud.setScope(!spectate.active && viewmodel.scopedIn());

  if (p.alive && w && !spectate.active) {
    hud.setHealth(mode === 'friends' ? netHealth : p.health);
    hud.setAmmo(w);
    hud.setCrosshairSpread(currentSpread(w, p.moveFrac, !p.onGround, p.crouched, p.aiming));
  }

  if (mode === 'friends' && net) {
    if (net.phase === 'live') hud.setTimer(net.endsAt - Date.now());
    hud.showScoreboard(matchOver || (net.phase === 'live' && input.keys.has('Tab')));
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
  get spectate() { return spectate; },
  input,
  hud,
  connectRoom,
  pickFriendsWeapon,
  startBots,
  leaveRoom,
  fps: () => fps,
  drive: (fn) => { input.drive = fn; },
  hideOverlays: () => { hud.hideMenu(); hud.hideFriends(); hud.hideLobby(); hud.hideLoadout(); hud.hideResume(); },
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
    if (spectate.active) {
      const cam = spectateCamera(0.016);
      renderer.setCamera(cam.pos, cam.yaw, cam.pitch, 0, 0, 75);
    } else {
      renderer.setCamera(currEye, input.yaw, input.pitch, 0, 0);
    }
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
