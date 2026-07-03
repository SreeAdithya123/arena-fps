// Cloudflare Worker: serves the built client (static assets) and hosts friend
// rooms as Durable Objects. One DO instance per room code, WebSockets inside.
//
// Trust model (friends-scale): clients simulate their own movement and detect
// their own hits; the server owns health, kills, scores, teams, the 10-minute
// match timer, and basic sanity checks. The deterministic sim in src/sim/ is
// untouched and remains the seam for a future fully-authoritative server.

import { ARENA } from '../src/sim/arena.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — unambiguous
const MATCH_MS = 10 * 60 * 1000;
const RESET_DELAY_MS = 15 * 1000;
const TEAM_CAP = 6;
const SNAP_HZ = 20;
const MAX_HIT_DAMAGE = 110; // DMR headshot; anything above is a tampered client

function makeCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/create' && request.method === 'POST') {
      const code = makeCode();
      const room = env.ROOM.get(env.ROOM.idFromName(code));
      await room.fetch(new Request('https://room/create'));
      return Response.json({ code });
    }

    const wsMatch = url.pathname.match(/^\/ws\/([A-Z]{5})$/);
    if (wsMatch) {
      const room = env.ROOM.get(env.ROOM.idFromName(wsMatch[1]));
      return room.fetch(request);
    }

    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) {
      return new Response('not found', { status: 404 });
    }
    // Unmatched non-API paths reach here only when no static asset exists.
    return env.ASSETS.fetch(request);
  },
};

export class Room {
  constructor(state) {
    this.state = state;
    this.clients = new Map(); // id -> { ws, name, team, weapon, health, alive, kills, deaths, p, yaw, pitch, crouch, spawnIdx }
    this.nextId = 1;
    this.scores = { red: 0, blue: 0 };
    this.endsAt = 0;
    this.phase = 'waiting'; // waiting | live | over
    this.interval = null;
    this.resetTimer = null;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/create') {
      await this.state.storage.put('created', true);
      return new Response('ok');
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    if (!(await this.state.storage.get('created'))) {
      return new Response('room not found', { status: 404 });
    }

    const pair = new WebSocketPair();
    this.accept(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  accept(ws) {
    ws.accept();
    let id = null;
    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (id === null) {
        if (msg.t !== 'join') { ws.close(1002, 'expected join'); return; }
        id = this.join(ws, msg);
        return;
      }
      this.onMessage(id, msg);
    });
    const drop = () => { if (id !== null) this.leave(id); };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
  }

  join(ws, msg) {
    const red = [...this.clients.values()].filter((c) => c.team === 'red').length;
    const blue = [...this.clients.values()].filter((c) => c.team === 'blue').length;
    if (red + blue >= TEAM_CAP * 2) {
      ws.send(JSON.stringify({ t: 'error', msg: 'Room is full (12 players).' }));
      ws.close(1000, 'full');
      return null;
    }
    const team = blue < red ? 'blue' : 'red';
    const id = this.nextId++;
    const name = String(msg.name || 'PLAYER').slice(0, 14).toUpperCase() || 'PLAYER';
    const spawn = this.pickSpawn(team, id);
    // alive:false until the client picks a weapon and sends its first respawn
    const client = {
      ws, name, team,
      weapon: msg.weapon || 'ar',
      health: 100, alive: false, kills: 0, deaths: 0,
      p: [spawn.pos.x, spawn.pos.y, spawn.pos.z], yaw: spawn.yaw, pitch: 0, crouch: false,
    };
    this.clients.set(id, client);

    if (this.phase === 'waiting') {
      this.phase = 'live';
      this.endsAt = Date.now() + MATCH_MS;
    }
    this.startLoop();

    ws.send(JSON.stringify({
      t: 'welcome', id, team, endsAt: this.endsAt, spawn,
      scores: this.scores,
      players: [...this.clients.entries()]
        .filter(([pid]) => pid !== id)
        .map(([pid, c]) => ({
          id: pid, name: c.name, team: c.team, alive: c.alive,
          kills: c.kills, deaths: c.deaths, p: c.p, yaw: c.yaw,
        })),
    }));
    this.broadcast({ t: 'joined', id, name, team }, id);
    this.sendScores();
    return id;
  }

  leave(id) {
    if (!this.clients.has(id)) return;
    this.clients.delete(id);
    this.broadcast({ t: 'left', id });
    this.sendScores();
    if (this.clients.size === 0) this.stopLoop();
  }

  onMessage(id, msg) {
    const c = this.clients.get(id);
    if (!c) return;
    switch (msg.t) {
      case 'state':
        if (!Array.isArray(msg.p) || msg.p.length !== 3 || msg.p.some((v) => typeof v !== 'number' || !isFinite(v))) return;
        c.p = msg.p;
        c.yaw = +msg.yaw || 0;
        c.pitch = +msg.pitch || 0;
        c.crouch = !!msg.crouch;
        if (msg.weapon) c.weapon = msg.weapon;
        break;
      case 'fire':
        this.broadcast({ t: 'shot', id, o: msg.o, e: msg.e }, id);
        break;
      case 'hit':
        this.applyHit(id, msg);
        break;
      case 'respawn':
        this.respawn(id, msg.weapon);
        break;
    }
  }

  applyHit(attackerId, msg) {
    if (this.phase !== 'live') return;
    const attacker = this.clients.get(attackerId);
    const victim = this.clients.get(msg.target);
    if (!attacker || !victim || !attacker.alive || !victim.alive) return;
    if (attacker.team === victim.team) return; // no friendly fire
    const damage = Math.min(MAX_HIT_DAMAGE, Math.max(1, Math.round(+msg.damage || 0)));

    victim.health -= damage;
    const killed = victim.health <= 0;
    attacker.ws.send(JSON.stringify({
      t: 'hitConfirm', target: msg.target, damage, headshot: !!msg.headshot, killed, e: msg.e,
    }));
    if (killed) {
      victim.alive = false;
      victim.health = 0;
      victim.deaths++;
      attacker.kills++;
      this.scores[attacker.team]++;
      this.broadcast({ t: 'death', victim: msg.target, killer: attackerId, headshot: !!msg.headshot });
      this.sendScores();
    } else {
      victim.ws.send(JSON.stringify({
        t: 'damaged', from: attackerId, damage, health: victim.health, fromPos: attacker.p,
      }));
    }
  }

  respawn(id, weapon) {
    const c = this.clients.get(id);
    if (!c || c.alive) return;
    c.alive = true;
    c.health = 100;
    if (weapon) c.weapon = weapon;
    const spawn = this.pickSpawn(c.team, id);
    c.p = [spawn.pos.x, spawn.pos.y, spawn.pos.z];
    this.broadcast({ t: 'respawned', id, spawn, health: 100 });
  }

  pickSpawn(team, seed) {
    const spawns = ARENA.teamSpawns[team];
    return spawns[(seed + Math.floor(Math.random() * spawns.length)) % spawns.length];
  }

  startLoop() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 1000 / SNAP_HZ);
  }

  stopLoop() {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
    if (this.resetTimer) { clearTimeout(this.resetTimer); this.resetTimer = null; }
    this.phase = 'waiting';
    this.scores = { red: 0, blue: 0 };
  }

  tick() {
    if (this.phase === 'live' && Date.now() >= this.endsAt) {
      this.phase = 'over';
      this.broadcast({ t: 'over', scores: this.scores, board: this.board() });
      this.resetTimer = setTimeout(() => this.resetMatch(), RESET_DELAY_MS);
    }
    const players = [];
    for (const [id, c] of this.clients) {
      players.push({ id, p: c.p, yaw: c.yaw, pitch: c.pitch, crouch: c.crouch, alive: c.alive, weapon: c.weapon });
    }
    this.broadcast({ t: 'snap', players });
  }

  resetMatch() {
    this.resetTimer = null;
    this.scores = { red: 0, blue: 0 };
    this.phase = 'live';
    this.endsAt = Date.now() + MATCH_MS;
    const spawns = {};
    for (const [id, c] of this.clients) {
      c.alive = true;
      c.health = 100;
      c.kills = 0;
      c.deaths = 0;
      const spawn = this.pickSpawn(c.team, id);
      c.p = [spawn.pos.x, spawn.pos.y, spawn.pos.z];
      spawns[id] = spawn;
    }
    this.broadcast({ t: 'reset', endsAt: this.endsAt, spawns });
    this.sendScores();
  }

  board() {
    return [...this.clients.entries()].map(([id, c]) => ({
      id, name: c.name, team: c.team, kills: c.kills, deaths: c.deaths,
    }));
  }

  sendScores() {
    this.broadcast({ t: 'scores', red: this.scores.red, blue: this.scores.blue, board: this.board() });
  }

  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const [id, c] of this.clients) {
      if (id === exceptId) continue;
      try { c.ws.send(data); } catch { /* dead socket; close event will clean up */ }
    }
  }
}
