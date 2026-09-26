# STEM Ship Tour — Design

**Date:** 2026-09-26
**Status:** Draft for review
**Repos:** galaxy-gardeners-dcl (the tour), galaxy-gardeners-server (join flag revert, one new walkthrough action). iOS: no changes.

## Goal

New Decentraland players get a hands-on tour of their ship led by STEM, the ship's assistant. Fixed cameras frame
each desk while STEM explains it in a terminal-style dialog, and at the key moments the player does the real thing:
deploys their first exploration pod and mining pod and docks at their home station. The tour follows the iOS
walkthrough's seven scenes, reworded for the ship's desks, and uses the server's existing walkthrough state, so pods
can't be lost while it runs.

## Who gets it

- **New Decentraland players:** the tour starts automatically after joining. The server's join route stops marking
  Decentraland players as walkthrough-skipped (reverting the 2026-09-26 join flag), so they get the walkthrough's
  no-pod-loss protection until the tour completes or is skipped.
- **Existing Decentraland players** (marked skipped on 2026-09-26): on their next load STEM asks once, "Want a tour of
  the ship, Captain?", with TAKE TOUR / NO THANKS. The answer is remembered in player preferences (`tourOffered`), so
  it is asked only once. TAKE TOUR restarts their walkthrough on the server (see Server) so they get the same
  protection.
- **Which one happens on load** (from `GET /api/walkthrough/state` and prefs):
  - not completed and not skipped → the tour starts (or resumes at the stored scene);
  - skipped, not completed, and `tourOffered` not set → the one-time offer. TAKE TOUR calls `restart`; if the server
    refuses it (the player had advanced before), the tour runs as a replay without protection;
  - otherwise → nothing.
- **Anyone, any time:** the tour can be replayed from the STEM chat (a TOUR button in the chat header, or asking STEM
  for "tour" / "walkthrough"). A replay after the walkthrough is completed or skipped doesn't change server state and
  gives no protection.

## The scenes

| # | Scene | Camera | Player does |
|---|---|---|---|
| 1 | Welcome: STEM introduces itself | wide shot of the bridge | NEXT |
| 2 | Home system: "SYSTEM SCAN" panel (star, type, planets, belts, station) | hologram, star system view | NEXT |
| 3 | First pods: STEM names the safest living planet, then a low-risk belt | hologram close-up | deploys an exploration pod to the planet, then a mining pod to the belt |
| 4 | Ship tour: Ship Overview (fuel, refinery), Pod Operations (build pods), Ship Systems (upgrades), Collections (vault, cargo) | one shot per desk | NEXT on each |
| 5 | Fuel and stations: fuel rules, then docking | Ship Overview's fuel card, then the Stellar Navigation console | presses DOCK |
| 6 | Discovery: the four directions | Stellar Discovery desk | NEXT (no scan is forced) |
| 7 | Wrap-up: the galaxy map, "your pod is still scanning [planet]", STEM is one button away | top view of the galaxy map | FINISH |

Lines come from the iOS script (`galaxy-gardeners/Galaxy Gardeners/Walkthrough/WalkthroughScenes.swift`) with every
iOS instruction ("tap", tabs, Ship Dashboard) replaced by the desk and button that do it on the ship. Placeholders
({star_name}, {planet_name}, …) are filled from the server's `GET /api/walkthrough/scene-data/:scene`.

## Scene structure (scene repo)

- `src/tour/script.ts`: the tour as data. Each scene has steps; each step is
  `{ shot, lines: string[], panel?: { title, text }, waitFor? }`, with `waitFor` one of `exploration_deployed`,
  `mining_deployed`, `docked`. Each scene also has a resume line for when the tour restarts mid-scene after a reload.
- `src/tour/shots.ts`: one fixed camera per shot (bridge, hologram, hologram close-up, each desk, galaxy top view),
  positioned from the desks' placement in the scene. VirtualCamera with timed transitions, like `consoleCamera.ts`.
- `src/tour/runner.ts`: the state machine. Loads the walkthrough state and scene data, shows each step's lines one at
  a time (NEXT), moves the camera, and on a `waitFor` step hands the camera back to the player until the action
  happens. The deploy (`ui.tsx` deployPod) and docking (`docking.ts`) code report success to the runner through a
  small event hook, so the runner doesn't poll. Advancing a scene calls the server `advance`; the end calls
  `complete`; SKIP TOUR calls `skip`.
- `src/tour/dialog.tsx`: the STEM terminal dialog along the bottom of the screen: STEM's line, an optional data panel
  above it, NEXT (FINISH on the last step) and SKIP TOUR. All sizes through `px()`.

## Rules and edge cases

- **Hands-on step not possible:** no living planet or low-risk belt in scene data, no ready pod of that type, not in
  the home system, in transit, or no station in the current system. STEM says why in one line and the tour moves on.
- **Already done:** on resume, a hands-on step whose result already exists (an exploration or mining pod already out,
  already docked) is skipped.
- **Expeditions:** the tour never waits for one to finish. Protection is the server's existing rule: no pod loss while
  the walkthrough is neither completed nor skipped.
- **Reloads:** progress is stored per scene. A reload resumes at the stored scene with its resume line; steps within
  the scene restart.
- **SKIP TOUR:** confirms first ("Skip the tour? Pods can be lost once the tour ends."), then marks the walkthrough
  skipped and restores the player's camera.
- **Camera ownership:** while a tour shot is active the HUD camera switcher is hidden and the console camera is
  suspended; releasing the shot restores the player's chosen camera mode. Sleep mode pauses the tour and releases its
  camera; waking resumes the step.
- **Docked at the end:** the tour leaves the player docked; STEM's wrap-up mentions UNDOCK on the Stellar Navigation
  console.

## Server

- **Join:** remove the Decentraland `walkthroughSkipped` flag from `POST /api/galaxy/:id/join` (keep the moon-pod
  walkthrough fix). New Decentraland players start with the walkthrough active.
- **`POST /api/walkthrough/progress` gains `action: "restart"`:** sets `walkthrough_skipped = false` and
  `walkthrough_scene = 0`. Allowed only when `walkthrough_completed` is false and `walkthrough_scene` is 0 (the player
  has never advanced), otherwise 400. This makes the opt-in for existing players a one-time event, so restart can't be
  used to keep pods protected indefinitely.
- No migration: the walkthrough columns already exist.

## Testing

- Server: route tests for `restart` (allowed at scene 0 and not completed; refused after advancing or completing) and
  for join no longer setting `walkthrough_skipped` for Decentraland emails.
- Scene: `script.ts` placeholder filling and the runner's step logic (which step comes next, skipping impossible or
  already-done hands-on steps) as pure functions checked by the build's type checker and a manual pass. The scene has
  no unit test runner; manual test in the local preview: a fresh account (auto start, deploy both pods, dock, finish),
  a reload mid-scene (resume line), SKIP TOUR, the one-time offer for an existing account, and a STEM chat replay.

## Known risk (not addressed here)

A player who never finishes or skips the walkthrough keeps pod-loss protection indefinitely. This is true on iOS
today too; the tour doesn't make it worse (restart is one-time), but a time limit on protection would close it for
every client.
