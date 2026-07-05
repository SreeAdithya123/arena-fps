// Friend-room client: WebSocket to the Room Durable Object, snapshot
// interpolation for remote players, and client-side hit detection against
// remote hulls (mirrors the sim's bot hitboxes).

import { raySphere, rayAABB } from './sim/math.js';
import { WEAPONS, falloff } from './sim/weapons.js';

const INTERP_DELAY_MS = 120;
const BUFFER_KEEP_MS = 1000;

export class NetClient {
  constructor() {
    this.ws = null;
    this.id = null;
    this.team = null;
    this.code = null;
    this.phase = 'lobby';
    this.leader = null;
    this.mapId = 'depot';
    this.endsAt = 0;
    this.scores = { red: 0, blue: 0 };
    this.board = []; // roster players incl. spectators and self
    this.remotes = new Map(); // id -> { name, team, alive, weapon, buf: [{t, p, yaw, pitch, crouch}] }
    this.handlers = {};
    this.snapGaps = [];
    this.lastSnapAt = 0;
  }

  snapStats() {
    if (!this.snapGaps.length) return null;
    const g = [...this.snapGaps].sort((a, b) => a - b);
    return {
      n: g.length,
      mean: g.reduce((s, x) => s + x, 0) / g.length,
      p95: g[Math.floor(g.length * 0.95)],
      max: g[g.length - 1],
    };
  }

  get isLeader() { return this.id !== null && this.id === this.leader; }

  on(type, fn) {
    this.handlers[type] = fn;
    return this;
  }

  emit(type, data) {
    if (this.handlers[type]) this.handlers[type](data);
  }

  static async createRoom() {
    const res = await fetch('/api/create', { method: 'POST' });
    if (!res.ok) throw new Error('could not create room');
    return (await res.json()).code;
  }

  connect(code, name, weapon) {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${proto}//${location.host}/ws/${code}`);
      this.ws = ws;
      this.code = code;
      let welcomed = false;

      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ t: 'join', name, weapon }));
      });
      ws.addEventListener('message', (e) => {
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (!welcomed) {
          if (msg.t === 'welcome') {
            welcomed = true;
            this.onWelcome(msg);
            resolve(msg);
          } else if (msg.t === 'error') {
            reject(new Error(msg.msg));
          }
          return;
        }
        this.onMessage(msg);
      });
      ws.addEventListener('close', () => {
        if (!welcomed) reject(new Error('Room not found — check the code.'));
        else this.emit('close');
      });
      ws.addEventListener('error', () => {
        if (!welcomed) reject(new Error('Room not found — check the code.'));
      });
    });
  }

  onWelcome(msg) {
    this.id = msg.id;
    this.team = msg.team;
    this.phase = msg.phase;
    this.endsAt = msg.endsAt;
    this.scores = msg.scores;
    this.applyRoster(msg.roster);
    for (const p of msg.players) {
      this.remotes.set(p.id, {
        name: p.name, team: p.team, alive: p.alive, weapon: 'ar',
        buf: [{ t: performance.now(), p: p.p, yaw: p.yaw, pitch: 0, crouch: false }],
      });
    }
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'snap': {
        const now = performance.now();
        // tick-health instrumentation: gap between server snapshots (20Hz nominal)
        if (this.lastSnapAt) {
          this.snapGaps.push(now - this.lastSnapAt);
          if (this.snapGaps.length > 600) this.snapGaps.shift();
        }
        this.lastSnapAt = now;
        for (const s of msg.players) {
          if (s.id === this.id) continue;
          let r = this.remotes.get(s.id);
          if (!r) continue; // joined event not seen yet; next snap after it will land
          r.alive = s.alive;
          r.weapon = s.weapon;
          r.buf.push({ t: now, p: s.p, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch });
          while (r.buf.length > 2 && r.buf[0].t < now - BUFFER_KEEP_MS) r.buf.shift();
        }
        break;
      }
      case 'joined':
        // everyone joins pre-spawn; snapshots flip alive once they pick a weapon
        this.remotes.set(msg.id, {
          name: msg.name, team: msg.team, alive: false, weapon: 'ar',
          buf: [],
        });
        this.emit('joined', msg);
        break;
      case 'left':
        this.remotes.delete(msg.id);
        this.emit('left', msg);
        break;
      case 'scores': {
        this.scores = { red: msg.red, blue: msg.blue };
        for (const p of msg.board) {
          const b = this.board.find((x) => x.id === p.id);
          if (b) { b.kills = p.kills; b.deaths = p.deaths; }
        }
        this.emit('scores', msg);
        break;
      }
      case 'roster':
        this.applyRoster(msg);
        this.emit('roster', msg);
        break;
      case 'start':
        this.phase = 'live';
        this.endsAt = msg.endsAt;
        if (msg.map) this.mapId = msg.map;
        this.scores = { red: 0, blue: 0 };
        this.emit('start', msg);
        break;
      case 'over':
        this.phase = 'over';
        this.emit('over', msg);
        break;
      case 'lobby':
        this.phase = 'lobby';
        this.endsAt = 0;
        this.applyRoster(msg.roster);
        this.emit('lobby', msg);
        break;
      default:
        this.emit(msg.t, msg);
    }
  }

  applyRoster(roster) {
    this.leader = roster.leader;
    if (roster.phase) this.phase = roster.phase;
    if (roster.mapId) this.mapId = roster.mapId;
    this.board = roster.players;
    for (const p of roster.players) {
      if (p.id === this.id) {
        this.team = p.team;
      } else {
        const r = this.remotes.get(p.id);
        if (r) { r.team = p.team; r.name = p.name; }
      }
    }
  }

  send(msg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendState(player, weaponId) {
    this.send({
      t: 'state',
      p: [player.pos.x, player.pos.y, player.pos.z],
      yaw: player.yaw, pitch: player.pitch,
      crouch: player.crouched, weapon: weaponId,
    });
  }

  sendFire(origin, ends) {
    this.send({
      t: 'fire',
      o: [origin.x, origin.y, origin.z],
      es: ends.map((e) => [e.x, e.y, e.z]),
    });
  }

  sendHit(targetId, damage, headshot, end) {
    this.send({ t: 'hit', target: targetId, damage, headshot, e: [end.x, end.y, end.z] });
  }

  sendRespawn(weapon) {
    this.send({ t: 'respawn', weapon });
  }

  sendSwitchTeam(team) {
    this.send({ t: 'switchTeam', team });
  }

  sendReady(ready) {
    this.send({ t: 'ready', ready });
  }

  sendSetMap(map) {
    this.send({ t: 'setMap', map });
  }

  sendStart(matchMs = null) {
    this.send(matchMs ? { t: 'start', matchMs } : { t: 'start' });
  }

  disconnect() {
    if (this.ws) { try { this.ws.close(); } catch { /* already closed */ } }
    this.ws = null;
    this.remotes.clear();
  }

  // Interpolated render-state for a remote player, INTERP_DELAY_MS in the past.
  sampleRemote(id, now = performance.now()) {
    const r = this.remotes.get(id);
    if (!r || r.buf.length === 0) return null;
    const t = now - INTERP_DELAY_MS;
    const buf = r.buf;
    if (t <= buf[0].t || buf.length === 1) {
      const s = buf[0];
      return { p: s.p, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, alive: r.alive };
    }
    for (let i = buf.length - 1; i >= 0; i--) {
      if (buf[i].t <= t) {
        const a = buf[i], b = buf[i + 1] || a;
        const f = b === a ? 0 : Math.min(1, (t - a.t) / (b.t - a.t));
        let dy = b.yaw - a.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        return {
          p: [
            a.p[0] + (b.p[0] - a.p[0]) * f,
            a.p[1] + (b.p[1] - a.p[1]) * f,
            a.p[2] + (b.p[2] - a.p[2]) * f,
          ],
          yaw: a.yaw + dy * f,
          pitch: a.pitch + (b.pitch - a.pitch) * f,
          crouch: b.crouch,
          alive: r.alive,
        };
      }
    }
    const s = buf[buf.length - 1];
    return { p: s.p, yaw: s.yaw, pitch: s.pitch, crouch: s.crouch, alive: r.alive };
  }
}

// Client-side hit detection against remote players. Takes the sim's 'shot'
// event (each pellet already raycast against the world) and checks whether an
// enemy hull sits closer along each pellet ray. Hitboxes mirror the sim's
// bots: body AABB + head sphere, squashed when crouching. Mutates pellet ends
// to the impact points and returns per-target aggregates:
//   [{ id, damage, headshot, end }]
export function resolveRemoteHits(ev, net) {
  const origin = ev.origin;
  const def = WEAPONS[ev.weapon];
  const now = performance.now();

  // snapshot enemy hulls once (identical across pellets of the same shot)
  const hulls = [];
  for (const [id, r] of net.remotes) {
    if (!r.alive || r.team === 'spec' || r.team === net.team) continue;
    const s = net.sampleRemote(id, now);
    if (!s) continue;
    const [x, y, z] = s.p;
    hulls.push({
      id,
      head: { x, y: y + (s.crouch ? 1.05 : 1.62), z },
      min: { x: x - 0.38, y, z: z - 0.38 },
      max: { x: x + 0.38, y: y + (s.crouch ? 1.0 : 1.5), z: z + 0.38 },
    });
  }
  if (!hulls.length) return [];

  const perTarget = new Map();
  for (const pellet of ev.pellets) {
    const dir = pellet.dir;
    const tWorld = pellet.hit === 'none'
      ? 90
      : Math.hypot(pellet.end.x - origin.x, pellet.end.y - origin.y, pellet.end.z - origin.z);
    let best = null, tBest = tWorld, headshot = false;
    for (const h of hulls) {
      const tHead = raySphere(origin, dir, h.head, 0.24, tBest);
      if (tHead < tBest) { tBest = tHead; best = h.id; headshot = true; continue; }
      const tBody = rayAABB(origin, dir, h.min, h.max, tBest);
      if (tBody < tBest) { tBest = tBody; best = h.id; headshot = false; }
    }
    if (best === null) continue;
    pellet.end = {
      x: origin.x + dir.x * tBest,
      y: origin.y + dir.y * tBest,
      z: origin.z + dir.z * tBest,
    };
    pellet.hit = 'remote';
    const agg = perTarget.get(best) || { damage: 0, headshot: false, end: pellet.end };
    agg.damage += def.damage * (headshot ? def.headMult : 1) * falloff(def, tBest);
    agg.headshot = agg.headshot || headshot;
    agg.end = pellet.end;
    perTarget.set(best, agg);
  }

  return [...perTarget.entries()].map(([id, agg]) => ({
    id,
    damage: Math.max(1, Math.round(agg.damage)),
    headshot: agg.headshot,
    end: agg.end,
  }));
}
