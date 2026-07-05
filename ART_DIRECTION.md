# DEPOT — art direction

One page, applied everywhere. If a choice contradicts this, the choice is wrong.

**Target: stylized-realistic.** Clean PBR box-and-primitive geometry, readable
silhouettes, zero photorealism. 60fps with 12 players beats any visual flourish
— if a feature costs frame budget, the feature goes.

## Color logic

- **World**: desaturated industrial neutrals — concrete greys, olive crates,
  gunmetal. Each map gets one temperature identity via its `env` block
  (depot: cool blue-grey night; compound: warm dusty daylight; pipeline: cold
  steel dawn). Nothing in the world may be saturated red or blue.
- **Teams own red and blue.** `TEAM_COLORS` in `src/render/remotes.js` are the
  only saturated red/blue in the game; they appear on chest plate, backpack,
  shoulders, visor, and nameplate — friend/enemy must read in one glance at
  40m. No cosmetic may recolor another player's body.
- **Accent (default gold `--accent`)**: the player's personal color — HUD
  highlights, crosshair tint, weapon trim. Unlockables swap this and only this.
- **Feedback colors are fixed**: damage red, health green, headshot gold-white,
  kill-confirm red.

## Lighting

One warm directional sun (static, per-map angle) + hemisphere fill + one cool
rim fill. Shadow map is **baked once per map load** (`shadowMap.autoUpdate =
false`) — arenas are static; characters ground themselves with blob shadows.
No real-time post-processing chain: ACES tone mapping + MSAA only.

## Geometry & materials

Everything is boxes and primitives with procedural canvas textures (concrete,
panel metal, stenciled crates). Uniform texel density via world-space UVs;
one merged mesh per material per map (~6 draw calls for a whole arena).
Weapons are primitive-built with dark receivers + accent-color sights so the
silhouette, not the texture, carries identity.

## Motion & feedback

Weapon feel is the product: sway, bob, sprint pose, ADS blend, kick, reload
dip, inspect. Hits always answer with at least three channels at once
(hitmarker + sound + target flash/flinch). Tracers are additive and short;
muzzle flash is two frames and a light pulse. Decals persist ~8s.

## UI

Single system: dark translucent panels (`rgba(20,25,31,0.92)`), 1px white-14%
borders, radius 5–8px, Segoe UI stack, letter-spaced ALL-CAPS labels, accent
for interactive emphasis only. Every screen (menu, friends, lobby, loadout,
scoreboard, stats) uses the same panel recipe — no one-off styles.
