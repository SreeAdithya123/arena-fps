// Room protocol E2E — runs against a live worker (default: wrangler dev on
// http://localhost:8787; pass a URL argument to test a deployment).
// Covers the full lobby lifecycle: lobby -> team switch -> leader start ->
// combat -> match over -> back to lobby -> rematch. Uses Node's built-in
// fetch + WebSocket, no browser involved. Takes ~40s (plays a real short match).

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
const WS_BASE = BASE.replace(/^http/, 'ws');

let failures = 0;
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  — ' + detail}`);
  if (!cond) failures++;
}

function openClient(code, name) {
  const ws = new WebSocket(`${WS_BASE}/ws/${code}`);
  const client = { ws, msgs: [], closed: false, welcome: null };
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.t === 'welcome') client.welcome = msg;
    client.msgs.push(msg);
  });
  ws.addEventListener('close', () => { client.closed = true; });
  ws.addEventListener('open', () => ws.send(JSON.stringify({ t: 'join', name, weapon: 'ar' })));
  client.send = (m) => ws.send(JSON.stringify(m));
  client.next = (type, timeout = 3000, pred = null) => new Promise((resolve) => {
    const scan = () => {
      const i = client.msgs.findIndex((m) => m.t === type && (!pred || pred(m)));
      if (i >= 0) { resolve(client.msgs.splice(i, 1)[0]); return true; }
      return false;
    };
    if (scan()) return;
    const iv = setInterval(() => {
      if (scan() || client.closed) { clearInterval(iv); if (client.closed) resolve(null); }
    }, 25);
    setTimeout(() => { clearInterval(iv); resolve(null); }, timeout);
  });
  client.drain = () => { client.msgs.length = 0; };
  return client;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // --- create room ---
  const res = await fetch(`${BASE}/api/create`, { method: 'POST' });
  const { code } = await res.json();
  check('create room returns a 5-letter code', /^[A-Z]{5}$/.test(code), code);

  // --- lobby: A creates (leader), B and C join ---
  const a = openClient(code, 'ALPHA');
  const wa = await a.next('welcome');
  check('first joiner enters a lobby as leader', !!wa && wa.phase === 'lobby' && wa.leader === wa.id);

  const b = openClient(code, 'BRAVO');
  const wb = await b.next('welcome');
  check('second joiner lands on the other team', !!wb && wb.team !== wa.team);

  const c = openClient(code, 'CHARL');
  const wc = await c.next('welcome');

  // --- team switching in lobby ---
  a.drain(); b.drain(); c.drain();
  c.send({ t: 'switchTeam', team: 'spec' });
  const rosterSpec = await a.next('roster', 3000, (m) => m.players.some((p) => p.id === wc.id && p.team === 'spec'));
  check('players can switch to spectators in the lobby', !!rosterSpec);

  b.send({ t: 'switchTeam', team: wa.team });
  const rosterSame = await a.next('roster', 3000, (m) => m.players.some((p) => p.id === wb.id && p.team === wa.team));
  check('players can switch onto the other team in the lobby', !!rosterSame);
  b.send({ t: 'switchTeam', team: wb.team }); // move B back for the combat test
  await a.next('roster', 3000, (m) => m.players.some((p) => p.id === wb.id && p.team === wb.team));

  // --- respawn before the match starts is rejected ---
  a.drain();
  a.send({ t: 'respawn', weapon: 'ar' });
  check('cannot spawn during the lobby', (await a.next('respawned', 700)) === null);

  // --- only the leader can start ---
  a.drain(); b.drain();
  b.send({ t: 'start', matchMs: 20000 });
  check('non-leader start is rejected', (await b.next('start', 700)) === null);

  a.send({ t: 'start', matchMs: 20000 });
  const startMsg = await b.next('start', 3000);
  const startedAt = Date.now();
  check('leader start broadcasts to the room', !!startMsg && startMsg.endsAt > Date.now());
  check('short test match duration honored (~20s)', !!startMsg && Math.abs(startMsg.endsAt - Date.now() - 20000) < 3000,
    startMsg ? `${startMsg.endsAt - Date.now()}ms` : 'none');

  // --- team switching locked once live ---
  a.drain(); b.drain();
  b.send({ t: 'switchTeam', team: wa.team });
  check('team switch is rejected mid-match',
    (await a.next('roster', 700, (m) => m.players.some((p) => p.id === wb.id && p.team === wa.team))) === null);

  // --- spawn + combat ---
  a.send({ t: 'respawn', weapon: 'ar' });
  const ra = await a.next('respawned', 3000, (m) => m.id === wa.id);
  check('players spawn once the match is live', !!ra && !!ra.spawn.pos);
  b.send({ t: 'respawn', weapon: 'smg' });
  await b.next('respawned', 3000, (m) => m.id === wb.id);

  // spectator cannot spawn and is absent from snapshots
  c.drain();
  c.send({ t: 'respawn', weapon: 'ar' });
  check('spectator cannot spawn', (await c.next('respawned', 700, (m) => m.id === wc.id)) === null);
  const snap = await c.next('snap', 2000);
  check('spectator is excluded from snapshots', !!snap && !snap.players.some((p) => p.id === wc.id));

  // state relay
  a.drain(); b.drain();
  for (let i = 0; i < 5; i++) {
    a.send({ t: 'state', p: [1.5, 0, 2.5], yaw: 0.7, pitch: 0, crouch: false, weapon: 'ar' });
    await sleep(30);
  }
  let sawA = false;
  for (let i = 0; i < 20 && !sawA; i++) {
    const s = await b.next('snap', 500);
    if (s && s.players.some((p) => p.id === wa.id && Math.abs(p.p[0] - 1.5) < 0.01 && p.alive)) sawA = true;
  }
  check('positions relay through snapshots', sawA);

  // kill B: 4 x 26
  a.drain(); b.drain();
  for (let i = 0; i < 4; i++) a.send({ t: 'hit', target: wb.id, damage: 26, headshot: false, e: [0, 1, 0] });
  const death = await b.next('death', 3000);
  check('4x26 damage kills (death broadcast)', !!death && death.victim === wb.id && death.killer === wa.id);
  const scores = await a.next('scores', 3000);
  check('killer team scores', !!scores && scores[wa.team] === 1, JSON.stringify(scores && { red: scores.red, blue: scores.blue }));

  // dead players can't be re-hit; respawn works
  a.drain(); b.drain();
  a.send({ t: 'hit', target: wb.id, damage: 26, headshot: false, e: [0, 1, 0] });
  check('hits on a dead player are rejected', (await b.next('damaged', 700)) === null);
  b.send({ t: 'respawn', weapon: 'dmr' });
  const rb = await b.next('respawned', 3000, (m) => m.id === wb.id);
  check('dead player respawns with full health', !!rb && rb.health === 100);

  // spectator can't be damaged
  b.drain(); c.drain();
  a.send({ t: 'hit', target: wc.id, damage: 55, headshot: false, e: [0, 1, 0] });
  check('hits on spectators are rejected', (await c.next('damaged', 700)) === null);

  // --- match end -> lobby -> rematch ---
  const untilOver = Math.max(0, startedAt + 20000 - Date.now()) + 4000;
  const over = await a.next('over', untilOver);
  check('match ends with an over broadcast + board', !!over && Array.isArray(over.board));
  const lobby = await a.next('lobby', 15000);
  check('room returns to the lobby after the match', !!lobby && lobby.roster.phase === 'lobby');

  a.drain(); b.drain();
  a.send({ t: 'start', matchMs: 10000 });
  const restart = await b.next('start', 3000);
  check('leader can start a rematch from the lobby', !!restart);
  const roster2 = await a.next('roster', 3000);
  check('rematch resets kills on the roster', !!roster2 && roster2.players.every((p) => p.kills === 0));

  // --- bogus room code rejected ---
  const bogus = new WebSocket(`${WS_BASE}/ws/ZZZZZ`);
  const bogusResult = await new Promise((resolve) => {
    bogus.addEventListener('open', () => resolve('open'));
    bogus.addEventListener('error', () => resolve('rejected'));
    bogus.addEventListener('close', () => resolve('rejected'));
    setTimeout(() => resolve('timeout'), 3000);
  });
  check('joining a nonexistent room is rejected', bogusResult === 'rejected', bogusResult);

  // --- leader migration on leave ---
  a.drain(); b.drain(); c.drain();
  a.ws.close(); // leader leaves
  const rosterAfterLeave = await b.next('roster', 3000, (m) => m.leader !== wa.id && m.leader !== null);
  check('leadership migrates when the leader leaves', !!rosterAfterLeave, JSON.stringify(rosterAfterLeave && rosterAfterLeave.leader));

  b.ws.close();
  c.ws.close();

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
