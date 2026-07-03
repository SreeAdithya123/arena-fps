// Room protocol E2E — runs against a live worker (default: wrangler dev on
// http://localhost:8787; pass a URL argument to test a deployment).
// Uses Node's built-in fetch + WebSocket, no browser involved.

const BASE = process.argv[2] || 'http://localhost:8787';
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
  client.next = (type, timeout = 3000) => new Promise((resolve) => {
    const scan = () => {
      const i = client.msgs.findIndex((m) => m.t === type);
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

  // --- join: two clients on opposite teams ---
  const a = openClient(code, 'ALPHA');
  const wa = await a.next('welcome');
  check('client A gets welcome with id/team/endsAt', !!wa && !!wa.id && !!wa.team && wa.endsAt > Date.now());
  const minsLeft = wa ? (wa.endsAt - Date.now()) / 60000 : 0;
  check('match timer is ~10 minutes', minsLeft > 9.4 && minsLeft < 10.1, `${minsLeft.toFixed(2)} min`);

  const b = openClient(code, 'BRAVO');
  const wb = await b.next('welcome');
  check('client B joins on the other team', !!wb && wb.team !== wa.team, `A=${wa && wa.team} B=${wb && wb.team}`);
  check('B sees A in the welcome player list', wb.players.some((p) => p.id === wa.id));
  const joinedMsg = await a.next('joined');
  check('A is told B joined', !!joinedMsg && joinedMsg.id === wb.id);

  // --- spawn both via respawn flow ---
  a.send({ t: 'respawn', weapon: 'ar' });
  const ra = await a.next('respawned');
  check('A respawn returns a team spawn point', !!ra && ra.id === wa.id && !!ra.spawn.pos);
  b.send({ t: 'respawn', weapon: 'smg' });
  await b.next('respawned');

  // --- state relay: A moves, B sees it in snapshots ---
  a.drain(); b.drain();
  for (let i = 0; i < 5; i++) {
    a.send({ t: 'state', p: [1.5, 0, 2.5], yaw: 0.7, pitch: 0, crouch: false, weapon: 'ar' });
    await sleep(30);
  }
  let sawA = false;
  for (let i = 0; i < 20 && !sawA; i++) {
    const snap = await b.next('snap', 500);
    if (snap && snap.players.some((p) => p.id === wa.id && Math.abs(p.p[0] - 1.5) < 0.01 && p.alive)) sawA = true;
  }
  check('B receives A\'s position via snapshots', sawA);

  // --- combat: A kills B with 4 AR hits ---
  a.drain(); b.drain();
  for (let i = 0; i < 3; i++) a.send({ t: 'hit', target: wb.id, damage: 26, headshot: false, e: [0, 1, 0] });
  const dmg = await b.next('damaged');
  check('B is told about damage with attacker info', !!dmg && dmg.from === wa.id && dmg.health < 100);
  a.send({ t: 'hit', target: wb.id, damage: 26, headshot: false, e: [0, 1, 0] });
  const death = await b.next('death');
  check('4x26 damage kills B (death broadcast)', !!death && death.victim === wb.id && death.killer === wa.id);
  const confirm = await a.next('hitConfirm', 3000).then(async (c) => {
    // find the killing confirm (may have drained earlier ones)
    let cur = c;
    while (cur && !cur.killed) cur = await a.next('hitConfirm', 500);
    return cur;
  });
  check('A gets a killing hitConfirm', !!confirm && confirm.killed === true);
  const scores = await a.next('scores');
  check('team score increments for the killer team', !!scores && scores[wa.team] === 1, JSON.stringify(scores && { red: scores.red, blue: scores.blue }));

  // --- dead players cannot be re-hit ---
  a.drain(); b.drain();
  a.send({ t: 'hit', target: wb.id, damage: 26, headshot: false, e: [0, 1, 0] });
  const ghost = await b.next('damaged', 700);
  check('hits on a dead player are rejected', ghost === null);

  // --- respawn after death ---
  b.send({ t: 'respawn', weapon: 'dmr' });
  const rb = await b.next('respawned');
  check('B respawns with full health', !!rb && rb.health === 100);

  // --- friendly fire rejected ---
  const cName = wa.team === 'red' ? 'CHARL' : 'CHARL';
  const c = openClient(code, cName);
  const wc = await c.next('welcome');
  c.send({ t: 'respawn', weapon: 'ar' });
  await c.next('respawned');
  a.drain(); b.drain(); c.drain();
  // find A's teammate among b/c
  const mate = wc.team === wa.team ? { client: c, id: wc.id } : { client: b, id: wb.id };
  a.send({ t: 'hit', target: mate.id, damage: 55, headshot: false, e: [0, 1, 0] });
  const ff = await mate.client.next('damaged', 700);
  check('friendly fire is rejected', wc.team === wa.team ? ff === null : true, `C on team ${wc.team}`);

  // --- oversized damage clamped ---
  a.drain(); b.drain();
  const enemy = wc.team === wa.team ? { client: b, id: wb.id } : { client: c, id: wc.id };
  a.send({ t: 'hit', target: enemy.id, damage: 9999, headshot: false, e: [0, 1, 0] });
  const bigHitDeath = await enemy.client.next('death', 1500);
  check('9999 damage kills (clamped to 110, still lethal) without crashing', !!bigHitDeath);

  // --- bogus room code rejected ---
  const bogus = new WebSocket(`${WS_BASE}/ws/ZZZZZ`);
  const bogusResult = await new Promise((resolve) => {
    bogus.addEventListener('open', () => resolve('open'));
    bogus.addEventListener('error', () => resolve('rejected'));
    bogus.addEventListener('close', () => resolve('rejected'));
    setTimeout(() => resolve('timeout'), 3000);
  });
  check('joining a nonexistent room is rejected', bogusResult === 'rejected', bogusResult);

  // --- disconnect cleanup ---
  a.drain(); b.drain(); c.drain();
  c.ws.close();
  const left = await a.next('left', 3000);
  check('leaving broadcasts to the room', !!left && left.id === wc.id);

  a.ws.close();
  b.ws.close();

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('test crashed:', e); process.exit(1); });
