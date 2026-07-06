# Landing Pad Scene (Genesis City Booth) — Design

**Date:** 2026-07-06
**Status:** Approved by user

## Summary

A new, standalone 1x2 Decentraland scene: the DaisyClass ship exterior floats over a landing pad, and FERN (Field Exploration & Resource Navigator), an AI concierge in a small booth, pitches the Galaxy Gardeners experience, registers the player against the existing backend, and sends them to the main world.

## Context & decisions (from brainstorming)

- **Deployment:** this booth scene deploys to Genesis City LAND (parcels TBD — placeholders `0,0`/`0,1` until known). The main experience deploys to a DCL World, with a possible future Genesis City deployment — so the travel destination is config-driven.
- **Project home:** new sibling repo/folder `~/Git/galaxy-gardeners-landing`, independent of `galaxy-gardeners-dcl`.
- **NPC tech:** `dcl-npc-toolkit` for FERN and the dialogue UI.
- **Assets:** primitives + placeholder NPC body now, real GLBs dropped in later. `DaisyClass_Exterior.glb` copied from the main repo.
- **Registration:** real, via the existing staging API (`getPlayerMe` / `getAvailableGalaxies` / `joinGalaxy`) — no new backend endpoints needed. Registration is a soft gate: if the API is unreachable or registration fails, FERN still offers travel (the main world runs its own join flow).

## Lore

The player is purchasing a luxury metaverse-only experience: a remote consciousness-link to their own ship in a far-away galaxy. They collect virtual samples of flora-based life forms; each world grows a species found nowhere else. Cozy, cooperative, trading-focused — no factions, no enemies. FERN is the sales-concierge AI at the departure terminal; the DaisyClass hovering overhead is the product on display.

## Project structure

```
~/Git/galaxy-gardeners-landing/
  scene.json          — 1x2 parcels (placeholders until LAND known)
  package.json        — @dcl/sdk + dcl-npc-toolkit
  src/
    index.ts          — scene assembly
    config.ts         — API_BASE, travel destination, toggles
    auth.ts           — copied from main scene
    api.ts            — trimmed: getPlayerMe, getAvailableGalaxies, joinGalaxy
    environment.ts    — pad, ship, booth, scenery
    fern.ts           — NPC entity + dialogue tree
  assets/models/DaisyClass_Exterior.glb
```

## Scene layout (16m × 32m)

- **Landing pad** in the far half: circular raised platform from primitives — dark metal disc with an emissive edge ring and pulsing landing lights, matching the main scene's glow language.
- **DaisyClass_Exterior** hovering ~8–10m above the pad, gently bobbing and slowly yawing via a transform system ("station-keeping"). Must fit the 2-parcel height limit (~31.7m).
- **FERN's booth** near the spawn end: kiosk from primitives (counter, canopy, holographic signage), placed so players pass it en route to the pad.
- **FERN** behind the counter: holographic-AI placeholder body (emissive teal primitives, slight idle hover) until a GLB is provided.

**Risk:** `DaisyClass_Exterior.glb` is 8.4MB; a 1x2 Genesis scene is capped at ~20k triangles total. Check triangle count during implementation; if over budget, request a decimated export with a stated target.

## FERN dialogue flow (dcl-npc-toolkit)

On activation, branch on `getPlayerMe()`:

- **New player:** luxury-concierge pitch (remote link to your own DaisyClass in a distant galaxy; collect one-of-a-kind flora). Choices: "Tell me more" (lore branch), "Sign me up", "Just looking."
- **"Sign me up":** `joinGalaxy(galaxyId, avatarName)` using the player's DCL display name → on success: "Registration complete, Commander. Your vessel is waiting." → travel offer.
- **Returning player:** "Welcome back, Commander <name>" → straight to travel offer.
- **API unreachable / registration fails:** graceful line ("the registry is offline — board anyway, we'll sort your paperwork aboard") → travel still offered. The booth never hard-blocks travel.

Dialogue text drafted in FERN's voice: polished, warm, slightly salesy AI concierge. User rewrites freely after seeing it.

## Travel & config

- `changeRealm()` from `~system/RestrictedActions`.
- `config.ts` destination shape: `{ mode: 'world', worldName: '<name>.dcl.eth' }` with a `{ mode: 'genesis', coords: 'x,y' }` variant (uses `teleportTo`) for the someday-LAND case.
- `API_BASE` in config; starts as the main scene's current value (`http://localhost:3000` staging).

## Error handling

All API calls wrapped; any failure degrades to the "board anyway" path with FERN flavor text rather than an error state. Console logging follows the main scene's `[api]` prefix style.

## Testing

- Local preview via `npm run start`.
- Exercise dialogue branches with the staging API up and deliberately down (new player, returning player, API-offline).
- `changeRealm` verified manually against a live destination.

## Out of scope

- Real payment / on-chain purchase (narrative + API registration only for now).
- Final GLBs for booth, pad, and FERN's body.
- Backend changes of any kind.
