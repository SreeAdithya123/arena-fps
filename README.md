# DEPOT — browser arena FPS

Original browser arena shooter (Vyoman project). Three maps, five weapons,
solo bots mode and 6v6 friend rooms — all original assets (procedural
textures, primitive models, synthesized audio; see [CREDITS.md](CREDITS.md)
and [ART_DIRECTION.md](ART_DIRECTION.md)).

**Live at: https://arena-fps.sreeadithya-ndd.workers.dev**

- **Play with Bots** — solo warm-up against 5 bots on DEPOT.
- **Play with Friends** — create a room, share the 5-letter code (or copy a
  deep link). The lobby has team columns (red / blue / spectators), a READY
  toggle, and a leader-only START that unlocks when everyone is ready. The
  leader picks the map from live thumbnails. 10-minute team deathmatch with
  positional audio, kill feed, Tab scoreboard, then back to the lobby for a
  rematch. Spectators get follow + free cameras. No friendly fire.
- **Progression** — session stats plus lifetime kills stored locally; kill
  milestones unlock crosshair styles and personal accent colors (your HUD,
  crosshair, and weapon trim — enemy/teammate colors never change).

## Maps

| | Character |
|---|---|
| **DEPOT** | Mixed range — central platform, north walkway, lane screens |
| **COMPOUND** | Close quarters — four-room building, hub pillar, ring corridor |
| **PIPELINE** | Long lanes — walkable pipe spine, under-spine tunnels, spawn berms |

All three are bot-tested in CI: patrol coverage, spawn walk-outs, and zero
spawn-to-spawn sightlines are asserted headlessly.

## Weapons (pick at spawn, RMB = ADS on all)

| | Talon (AR) | Ridgeline (DMR) | Wasp (SMG) | Breaker (Shotgun) | Aurora (Sniper) |
|---|---|---|---|---|---|
| Fire | 600rpm auto | semi 0.34s | 900rpm auto | pump 0.85s | bolt 1.15s |
| Damage | 26 (×1.8 HS) | 55 (×2.0) | 16 (×1.6) | 8×13 pellets (×1.4) | 105 (×2.0) |
| Trait | recoil climb | 2-shot punch | falloff spray | falloff, 1-shot close | full scope, 1-shot body |

## Run / deploy

```
npm install
npm run build && npx wrangler dev --port 8787   # full stack on :8787
npm run dev:worker & npm run dev                # or: HMR client on :5173
npm run deploy                                  # Cloudflare (Worker + DO + assets)
```

Controls: WASD, Shift sprint, C crouch, Space jump, LMB fire, RMB scope,
R reload, T inspect, Tab scoreboard.

## Architecture

```
src/sim/       pure deterministic sim (no DOM/three.js), 60Hz, seeded RNG.
src/sim/maps/  map data: boxes, spawns, linked bot-patrol graphs, env.
src/render/    three.js: merged per-material arena meshes (~6 draws/map),
               baked static shadow map + blob shadows, soldiers, viewmodels,
               pooled tracers/impacts/decals, synthesized positional audio.
server/        Cloudflare Worker + Room Durable Object: lobby/live/over
               lifecycle, teams, ready gate, map select, per-weapon damage
               clamps, 20Hz snapshots, 10-minute timer.
```

Perf (measured, 12-player match on DEPOT at 1920×1080): render 2.8ms/frame,
sim+net tick 0.11ms — ~18% of the 60fps budget; server snapshots hold 20Hz.

## Tests

```
npm run test       # 36 headless checks: sim, weapons, ADS, determinism,
                   # per-map bot flow + spawn safety
npm run test:net   # 31 protocol checks: lobby, ready gate, map select, combat,
                   # spectators, clamps, over->lobby->rematch (needs wrangler dev)
node test/net.js https://arena-fps.sreeadithya-ndd.workers.dev   # against prod
```
