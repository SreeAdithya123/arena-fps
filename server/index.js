// Cloudflare Worker: serves the built client (static assets) and hosts friend
// rooms as Durable Objects. One DO instance per room code, WebSockets inside.
//
// Room lifecycle: lobby -> live -> over -> lobby. The first player to join is
// the leader (migrates on leave); only the leader can start a match. In the
// lobby anyone can switch between red / blue / spectators. Spectators never
// spawn, never appear in snapshots, and can't deal or take damage.
//
// Trust model (friends-scale): clients simulate their own movement and detect
// their own hits; the server owns teams, health, kills, scores, phase, and the
// match timer. The deterministic sim in src/sim/ stays the seam for a future
// fully-authoritative server.

import { ARENA } from '../src/sim/arena.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O — unambiguous
const MATCH_MS_DEFAULT = 10 * 60 * 1000;
const MATCH_MS_MIN = 10 * 1000;
const LOBBY_RETURN_MS = 10 * 1000;
const TEAM_CAP = 6;
const SPEC_CAP = 6;
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
    this.clients = new Map(); // id -> { ws, name, team('red'|'blue'|'spec'), weapon, health, alive, kills, deaths, p, yaw, pitch, crouch }
    this.nextId = 1;
    this.leaderId = null;
    this.scores = { red: 0, blue: 0 };
    this.endsAt = 0;
    this.phase = 'lobby'; // lobby | live | over
    this.interval = null;
    this.lobbyTimer = null;
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
      try {
        if (id === null) {
          if (msg.t !== 'join') { ws.close(1002, 'expected join'); return; }
          id = this.join(ws, msg);
          return;
        }
        this.onMessage(id, msg);
      } catch (err) {
        // one bad message must never take down the room
        console.error('room message error:', err);
      }
    });
    const drop = () => { if (id !== null) this.leave(id); };
    ws.addEventListener('close', drop);
    ws.addEventListener('error', drop);
  }

  count(team) {
    let n = 0;
    for (const c of this.clients.values()) if (c.team === team) n++;
    return n;
  }

  join(ws, msg) {
    if (this.clients.size >= TEAM_CAP * 2 + SPEC_CAP) {
      ws.send(JSON.stringify({ t: 'error', msg: 'Room is full.' }));
      ws.close(1000, 'full');
      return null;
    }
    const red = this.count('red'), blue = this.count('blue');
    let team = blue < red ? 'blue' : 'red';
    if (red >= TEAM_CAP && blue >= TEAM_CAP) team = 'spec';

    const id = this.nextId++;
    const name = String(msg.name || 'PLAYER').slice(0, 14).toUpperCase() || 'PLAYER';
    const spawn = this.pickSpawn(team === 'spec' ? 'red' : team, id);
    const client = {
      ws, name, team,
      weapon: typeof msg.weapon === 'string' ? msg.weapon : 'ar',
      health: 100, alive: false, kills: 0, deaths: 0,
      p: [spawn.pos.x, spawn.pos.y, spawn.pos.z], yaw: spawn.yaw, pitch: 0, crouch: false,
    };
    this.clients.set(id, client);
    if (this.leaderId === null) this.leaderId = id;
    this.startLoop();

    ws.send(JSON.stringify({
      t: 'welcome', id, team, phase: this.phase, leader: this.leaderId,
      endsAt: this.endsAt, scores: this.scores, roster: this.roster(),
      players: [...this.clients.entries()]
        .filter(([pid]) => pid !== id)
        .map(([pid, c]) => ({ id: pid, name: c.name, team: c.team, alive: c.alive, p: c.p, yaw: c.yaw })),
    }));
    this.broadcast({ t: 'joined', id, name, team }, id);
    this.sendRoster();
    return id;
  }

  leave(id) {
    if (!this.clients.has(id)) return;
    this.clients.delete(id);
    if (this.leaderId === id) {
      this.leaderId = this.clients.size ? this.clients.keys().next().value : null;
    }
    this.broadcast({ t: 'left', id });
    this.sendRoster();
    if (this.clients.size === 0) this.stopLoop();
  }

  onMessage(id, msg) {
    const c = this.clients.get(id);
    if (!c) return;
    switch (msg.t) {
      case 'state':
        if (this.phase !== 'live' || c.team === 'spec') return;
        if (!Array.isArray(msg.p) || msg.p.length !== 3 || msg.p.some((v) => typeof v !== 'number' || !isFinite(v))) return;
        c.p = msg.p;
        c.yaw = +msg.yaw || 0;
        c.pitch = +msg.pitch || 0;
        c.crouch = !!msg.crouch;
        if (typeof msg.weapon === 'string') c.weapon = msg.weapon;
        break;
      case 'fire':
        if (this.phase !== 'live' || c.team === 'spec') return;
        this.broadcast({ t: 'shot', id, o: msg.o, e: msg.e }, id);
        break;
      case 'hit':
        this.applyHit(id, msg);
        break;
      case 'respawn':
        this.respawn(id, msg.weapon);
        break;
      case 'switchTeam':
        this.switchTeam(id, msg.team);
        break;
      case 'start':
        this.startMatch(id, msg.matchMs);
        break;
    }
  }

  switchTeam(id, team) {
    const c = this.clients.get(id);
    if (!c || this.phase !== 'lobby') return;
    if (!['red', 'blue', 'spec'].includes(team) || c.team === team) return;
    const cap = team === 'spec' ? SPEC_CAP : TEAM_CAP;
    if (this.count(team) >= cap) return;
    c.team = team;
    this.sendRoster();
  }

  startMatch(id, matchMs) {
    if (id !== this.leaderId || this.phase !== 'lobby') return;
    const fighters = [...this.clients.values()].filter((c) => c.team !== 'spec').length;
    if (fighters < 1) return;
    if (this.lobbyTimer) { clearTimeout(this.lobbyTimer); this.lobbyTimer = null; }

    this.phase = 'live';
    const ms = Math.min(MATCH_MS_DEFAULT, Math.max(MATCH_MS_MIN, +matchMs || MATCH_MS_DEFAULT));
    this.endsAt = Date.now() + ms;
    this.scores = { red: 0, blue: 0 };
    for (const c of this.clients.values()) {
      c.kills = 0;
      c.deaths = 0;
      c.alive = false; // everyone re-picks a weapon and respawns
      c.health = 100;
    }
    this.broadcast({ t: 'start', endsAt: this.endsAt });
    this.sendRoster();
  }

  applyHit(attackerId, msg) {
    if (this.phase !== 'live') return;
    const attacker = this.clients.get(attackerId);
    const victim = this.clients.get(msg.target);
    if (!attacker || !victim || !attacker.alive || !victim.alive) return;
    if (attacker.team === 'spec' || victim.team === 'spec') return;
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
    if (!c || c.alive || this.phase !== 'live' || c.team === 'spec') return;
    c.alive = true;
    c.health = 100;
    if (typeof weapon === 'string') c.weapon = weapon;
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
    if (this.lobbyTimer) { clearTimeout(this.lobbyTimer); this.lobbyTimer = null; }
    this.phase = 'lobby';
    this.endsAt = 0;
    this.scores = { red: 0, blue: 0 };
    this.leaderId = null;
  }

  tick() {
    if (this.phase === 'live' && Date.now() >= this.endsAt) {
      this.phase = 'over';
      this.broadcast({ t: 'over', scores: this.scores, board: this.boardPlayers() });
      this.lobbyTimer = setTimeout(() => this.toLobby(), LOBBY_RETURN_MS);
    }
    if (this.phase !== 'live') return;
    const players = [];
    for (const [id, c] of this.clients) {
      if (c.team === 'spec') continue;
      players.push({ id, p: c.p, yaw: c.yaw, pitch: c.pitch, crouch: c.crouch, alive: c.alive, weapon: c.weapon });
    }
    this.broadcast({ t: 'snap', players });
  }

  toLobby() {
    this.lobbyTimer = null;
    this.phase = 'lobby';
    this.endsAt = 0;
    for (const c of this.clients.values()) {
      c.alive = false;
      c.health = 100;
    }
    this.broadcast({ t: 'lobby', roster: this.roster(), leader: this.leaderId });
  }

  roster() {
    return {
      phase: this.phase,
      leader: this.leaderId,
      players: [...this.clients.entries()].map(([id, c]) => ({
        id, name: c.name, team: c.team, kills: c.kills, deaths: c.deaths, alive: c.alive,
      })),
    };
  }

  boardPlayers() {
    return this.roster().players.filter((p) => p.team !== 'spec');
  }

  sendRoster() {
    this.broadcast({ t: 'roster', ...this.roster() });
  }

  sendScores() {
    this.broadcast({ t: 'scores', red: this.scores.red, blue: this.scores.blue, board: this.boardPlayers() });
  }

  broadcast(msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const [id, c] of this.clients) {
      if (id === exceptId) continue;
      try { c.ws.send(data); } catch { /* dead socket; close event will clean up */ }
    }
  }
}
