// Glue: fixed-timestep sim loop + render interpolation + mode flow.
// Modes: 'menu' -> 'bots' (local sim with bots) or 'friends' (rooms with a
// lobby -> live -> over -> lobby lifecycle owned by the server).

import * as THREE from 'three';
import {
  createSim, simTick, respawnPlayer, eyePos, currentSpread, DT, WEAPONS, MAPS, DEFAULT_MAP,
} from './sim/sim.js';
import { aimDir, norm } from './sim/math.js';
import { raycastArena } from './sim/arena.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { GameRenderer } from './render/renderer.js';
import { ViewModel } from './render/viewmodel.js';
import { Effects } from './render/effects.js';
import { Sfx } from './render/audio.js';
import { NetClient, resolveRemoteHits } from './net.js';
import { RemotePlayers } from './render/remotes.js';
import { Progress } from './progress.js';

const app = document.getElementById('app');
let state = createSim(1337);
const renderer = new GameRenderer(app);
const input = new Input(renderer.renderer.domElement);
const hud = new Hud();
const viewmodel = new ViewModel(renderer.camera, renderer.scene);
const effects = new Effects(renderer.scene);
const sfx = new Sfx();
const remotesView = new RemotePlayers(renderer.scene);
const progress = new Progress();

remotesView.onStep = (pos) => sfx.footstep(pos);

function applyCosmetics() {
  document.documentElement.style.setProperty('--accent', progress.accentColor);
  viewmodel.setAccent(progress.accentColor);
  hud.setCrosshairStyle(progress.data.crosshair);
}
progress.onChange = applyCosmetics;

// lobby/menu click feedback (audio starts after the first unlock gesture)
document.addEventListener('click', (e) => {
  if (e.target.closest('button, .card, .map-card, .mode-btn')) sfx.uiClick();
});

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
renderer.setMap(state.map);
state.player.pos = { ...state.map.playerSpawns[0].pos };
input.setView(state.map.playerSpawns[0].yaw, 0);

let prevEye = eyePos(state.player);
let currEye = eyePos(state.player);
const muzzleTmp = new THREE.Vector3();

// Swap the client to a map: fresh sim (bots only in bots mode), new meshes,
// camera parked at a spawn. No-op when already on that map.
function setClientMap(mapId, withBots) {
  if (state.mapId === mapId && (withBots ? state.bots.length > 0 : state.bots.length === 0)) return;
  state = createSim(withBots ? 1337 : Date.now() % 100000, mapId);
  if (!withBots) state.bots.length = 0;
  renderer.setMap(state.map);
  renderer.setBotsVisible(withBots);
  state.player.pos = { ...state.map.playerSpawns[0].pos };
  input.setView(state.map.playerSpawns[0].yaw, 0);
  prevEye = currEye = eyePos(state.player);
  sfx.setAmbient(state.map.env.ambient);
}

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
  hud.showMenu(startBots, openFriends, () => hud.showStats(progress));
}

function startBots() {
  hud.hideMenu();
  setClientMap(DEFAULT_MAP, true);
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

    setClientMap(n.mapId, false);
    rebuildRemotes();

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
    onReady: (ready) => net.sendReady(ready),
    onMap: (mapId) => net.sendSetMap(mapId),
    onLeave: leaveRoom,
    link: roomLink(),
  });
  hud.updateLobby({ leader: net.leader, mapId: net.mapId, players: net.board }, net.id, net.team);
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
  sfx.respawn();
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
    const hit = raycastArena(state.map, head, back, r);
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
      hud.updateLobby({ leader: n.leader, mapId: n.mapId, players: n.board }, n.id, n.team);
    }
  });
  n.on('roster', () => {
    if (!hud.el.lobby.classList.contains('hidden')) {
      if (mode === 'friends') setClientMap(n.mapId, false); // live map preview behind the lobby
      hud.updateLobby({ leader: n.leader, mapId: n.mapId, players: n.board }, n.id, n.team);
    }
  });
  n.on('start', () => {
    matchOver = false;
    netHealth = 100;
    sfx.matchStart();
    hud.hideLobby();
    hud.showScoreboard(false);
    setClientMap(n.mapId, false);
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
    for (const e of msg.es || []) {
      effects.tracer(o, { x: e[0], y: e[1], z: e[2] }, 0.55);
    }
    sfx.remoteShot(msg.weapon || 'ar', o);
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
      progress.addKill();
    }
  });
  n.on('death', (msg) => {
    if (msg.victim === net.id) {
      netHealth = 0;
      state.player.alive = false;
      progress.addDeath();
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
    const won = n.team !== 'spec' && msg.scores[n.team] > msg.scores[n.team === 'red' ? 'blue' : 'red'];
    sfx.matchEnd(won);
    if (won) progress.addWin();
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

applyCosmetics();

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
      // friends mode: run each pellet against remote hulls before world feedback
      let remoteHits = [];
      if (mode === 'friends' && net) {
        remoteHits = resolveRemoteHits(ev, net);
        for (const h of remoteHits) {
          net.sendHit(h.id, h.damage, h.headshot, h.end);
        }
        net.sendFire(ev.origin, ev.pellets.map((p) => p.end));
      }
      viewmodel.onShot(ev.weapon);
      sfx.shot(ev.weapon);
      viewmodel.muzzleWorld(muzzleTmp);
      for (const pellet of ev.pellets) {
        effects.tracer(muzzleTmp, pellet.end, 1);
        if (pellet.hit === 'world') {
          effects.impact(pellet.end, pellet.mat);
          effects.decal(pellet.end);
        }
      }
      for (const h of remoteHits) {
        effects.blood(h.end);
        remotesView.flash(h.id);
        hud.hitmarker(h.headshot ? 'head' : 'hit');
        sfx.hit(h.headshot);
        const s = renderer.project(h.end);
        if (s) hud.damageNumber(s.x, s.y, h.damage, h.headshot);
      }
      for (const h of ev.hits) {
        const bot = state.bots[h.botId];
        const at = bot ? { x: bot.pos.x, y: bot.pos.y + 1.2, z: bot.pos.z } : ev.pellets[0].end;
        effects.blood(at);
        renderer.flashBot(h.botId);
        hud.hitmarker(h.killed ? 'kill' : h.headshot ? 'head' : 'hit');
        if (h.killed) sfx.kill(); else sfx.hit(h.headshot);
        const s = renderer.project(at);
        if (s) hud.damageNumber(s.x, s.y, h.damage, h.headshot);
      }
      break;
    }
    case 'botshot': {
      effects.tracer(ev.origin, ev.end, 0.5);
      if (!ev.hitPlayer && ev.mat) {
        effects.impact(ev.end, ev.mat);
        effects.decal(ev.end);
      }
      sfx.remoteShot('ar', ev.origin);
      break;
    }
    case 'playerhit':
      hud.damageFlash();
      sfx.hurt();
      break;
    case 'botdie':
      renderer.killBot(ev.id);
      progress.addKill();
      break;
    case 'botrespawn':
      renderer.respawnBot(ev.id);
      break;
    case 'reload':
      sfx.reload();
      break;
    case 'playerdie': // bots mode only; friends deaths come from the server
      sfx.die();
      progress.addDeath();
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

let prevStepPhase = 0;
let lastInspectKey = false;

function runTick() {
  prevEye = currEye;
  const cmd = input.sample();
  if (spectate.active) spectateHandleCmd(cmd);
  const events = simTick(state, cmd);
  currEye = eyePos(state.player);
  renderer.snapshotBots(state.bots);
  for (const ev of events) handleEvent(ev);

  // own footsteps from the sim's walk cycle (two per stride)
  const p = state.player;
  if (p.alive && p.onGround) {
    if (Math.floor(p.stepPhase * 2) !== Math.floor(prevStepPhase * 2)) sfx.footstep(null, true);
  }
  prevStepPhase = p.stepPhase;

  // weapon inspect on T
  const t = input.keys.has('KeyT');
  if (t && !lastInspectKey && p.alive && !spectate.active) viewmodel.inspect();
  lastInspectKey = t;

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
    sfx.setListener(cam.pos, cam.yaw);
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
    sfx.setListener(eye, input.yaw);
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
    sprinting: p.sprinting,
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
  spawn: (weaponId, mapId = DEFAULT_MAP) => { // bots-mode spawn shortcut used by automated checks
    if (mode !== 'bots' || state.mapId !== mapId) {
      hud.hideMenu();
      setClientMap(mapId, true);
      remotesView.clear();
      mode = 'bots';
    }
    currentWeapon = weaponId;
    const sp = respawnPlayer(state, weaponId);
    input.setView(sp.yaw, 0);
    prevEye = currEye = eyePos(state.player);
    viewmodel.setWeapon(weaponId);
    hud.hideLoadout();
  },
  // Free-camera capture for thumbnails/screenshots (hides the viewmodel).
  snapAt: (pos, yaw, pitch, w = 560) => {
    viewmodel.root.visible = false;
    renderer.camera.fov = 65;
    renderer.camera.updateProjectionMatrix();
    renderer.setCamera(pos, yaw, pitch, 0, 0, 65);
    renderer.updateBots(state.bots, 1, 0.016);
    effects.update(0.008);
    renderer.render();
    viewmodel.root.visible = true;
    const src = renderer.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = Math.round(w * src.height / src.width);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.62);
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
        if (ev.type === 'botshot') continue;
        if (ev.type === 'shot') {
          log.push('shot:' + (ev.hits.length ? 'bot' : ev.pellets.some((p) => p.hit === 'world') ? 'world' : 'none'));
        } else {
          log.push(ev.type);
        }
      }
    }
    return log;
  },
};
