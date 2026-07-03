# DEPOT — browser arena FPS

Original browser arena shooter (Vyoman project). One industrial-depot arena,
three hitscan weapons with right-click ADS, and two modes:

- **Play with Bots** — solo warm-up against 5 bots that patrol and shoot back.
- **Play with Friends** — 6v6 team deathmatch rooms. Create a room, share the
  5-letter code, friends join, 10-minute matches with team scores, kill feed,
  and a Tab scoreboard. Auto-balanced red/blue teams, no friendly fire.

## Play locally

```
npm install
npm run build
npx wrangler dev --port 8787     # full stack (game + rooms) on :8787
```

or for client development with hot reload:

```
npm run dev:worker    # rooms backend on :8787
npm run dev           # vite on :5173, proxies /api + /ws to the worker
```

Controls: WASD move, Shift sprint, C crouch, Space jump, LMB fire,
**RMB scope/ADS** (all weapons; the DMR gets a full scope), R reload,
Tab scoreboard.

## Deploy (Cloudflare)

```
npx wrangler login    # once
npm run deploy
```

One Worker serves the static build and hosts rooms as Durable Objects
(SQLite-backed, works on the free plan). Each room code = one DO instance.

## Architecture

```
src/sim/     pure simulation. Zero three.js/DOM imports, fixed 60Hz tick,
             seeded RNG, command-in/events-out. Runs headless in Node
             (test/headless.js) and replays deterministically.
src/render/  three.js presentation: arena meshes from the sim's box list,
             viewmodels, remote player rendering, tracers, synth audio.
src/net.js   friend-room client: WebSocket, snapshot interpolation (120ms),
             shooter-side hit detection against remote hulls.
server/      Cloudflare Worker + Room Durable Object: teams, health, kills,
             scores, 10-minute timer, snapshot relay at 20Hz.
src/main.js  fixed-timestep loop + mode state machine (menu/bots/friends).
```

Rooms are client-authoritative for movement and shooter-side hit detection
(friends-scale trust model); the server owns health/kills/scores/timer and
validates damage, teams, and lifecycles. The deterministic sim seam is
untouched — a fully authoritative server remains possible later.

## Tests

```
npm run test        # 22 headless sim checks (movement, weapons, ADS, bots, determinism)
npm run test:net    # 18 room protocol checks (needs wrangler dev running)
node test/net.js https://your-deployment.workers.dev   # same, against prod
```

## Weapons

| | VK-32 Talon (AR) | HR-9 Ridgeline (DMR) | MK-4 Wasp (SMG) |
|---|---|---|---|
| Fire | 600 rpm auto | semi, 0.34s | 900 rpm auto |
| Damage (head ×) | 26 (×1.8) | 55 (×2.0) | 16 (×1.6) |
| Mag | 30 | 12 | 36 |
| ADS | 1.5× zoom | full scope | 1.36× zoom |

All assets are original: procedural canvas textures, primitive-built guns,
synthesized WebAudio SFX.
