# STEM Ship Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A hands-on STEM-led tour of the Decentraland ship: fixed camera shots per desk, a STEM terminal dialog, and real pod deploys and docking, backed by the server's existing walkthrough state.

**Architecture:** The tour is data (`src/tour/script.ts`) run by a small state machine (`src/tour/runner.ts`) that owns a set of VirtualCameras (`src/tour/shots.ts`) and draws a bottom-of-screen dialog (`src/tour/dialog.tsx`). Deploy and dock code report success through `src/tour/events.ts`. The server keeps progress via the existing `/api/walkthrough` routes, gains a one-time `restart` action, and stops marking new Decentraland players as walkthrough-skipped.

**Tech Stack:** Decentraland SDK 7.23 (ECS, ReactEcs, VirtualCamera/MainCamera), TypeScript. Server: Express + Supabase + Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-stem-ship-tour-design.md`

## Global Constraints

- Node 20 for every command: `source ~/.nvm/nvm.sh && nvm use 20`.
- Server work happens in the worktree `~/Git/galaxy-gardeners-server-wt` on a branch off `origin/main`; never in `~/Git/galaxy-gardeners-server` (a feature branch is checked out there).
- Scene repo: `~/Git/galaxy-gardeners-dcl`, branch `feature/ship-stations`. `src/docking.ts` and `src/navConsole.ts` contain another agent's uncommitted BOARD STATION work: edit them surgically and stage only your own hunks (`git add -p`), never `git checkout`/`git stash` them.
- Never change `.editor/project.json` or `scene.json` `source.projectId`.
- All 2D UI sizes go through `px()` from `src/uiScale.ts`.
- Scene verification is `npm run build` (bundles + type checks); the scene has no unit test runner.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Player-facing copy: STEM calls the player "Captain"; desks are named as on the ship: Ship Overview, Pod Operations, Ship Systems (tabs of the ship desk), Collections (the flora desk: catalog, vault, cargo), Stellar Navigation console, Stellar Discovery desk, the hologram (galaxy map / star system view).

## Review Focus

1. A player who reloads mid-tour: the tour must resume at the stored scene with that scene's resume line, not restart at scene 1 and not duplicate a pod deploy (runner `alreadyDone` check, Task 5).
2. A player whose home system has no living planet, no low-risk belt, or no station, or who is away from home or in transit: every hands-on step must say why and move on, never wait forever (`blockedReason`, Task 5).
3. The console camera or HUD camera switcher fighting the tour camera: while a tour shot is applied, `consoleCamera.ts` must not overwrite `MainCamera`, and releasing must restore the player's mode (Task 3).
4. Sleep mode during the tour: the tour camera must be released while asleep and the step's shot re-applied on wake (Task 5 tick).
5. The one-time offer shown again after it was answered, or `restart` usable twice: `tourOffered` pref set on either answer (Task 5); server refuses `restart` once scene > 0 or completed (Task 1 tests).

---

### Task 1: Server — DCL players start with the walkthrough active; one-time `restart`

**Files:**
- Modify: `src/routes/galaxy.ts` (join route), `src/routes/walkthrough.ts` (progress route)
- Delete: nothing (keep `src/utils/dclIdentity.ts`; it stays exported for later use)
- Test: `src/routes/__tests__/galaxy-stem.test.ts`, `src/routes/__tests__/walkthrough.test.ts` (create if absent)

**Interfaces:**
- Produces: `POST /api/walkthrough/progress` with `{ action: 'restart' }` → 200 `{ walkthroughScene: 0, walkthroughCompleted: false, walkthroughSkipped: false }`, or 400 `{ error: 'Tour can only be restarted before it has begun' }`.

- [ ] **Step 1: Set up the branch**

```bash
cd ~/Git/galaxy-gardeners-server-wt && git fetch -q && git checkout -b feat/dcl-ship-tour origin/main
```

- [ ] **Step 2: Update the join test to expect no walkthrough flag**

In `src/routes/__tests__/galaxy-stem.test.ts`, the join tests currently expect `walkthroughSkipped: false` for a normal email and `walkthroughSkipped: true` for a `@dcl.galaxy-gardeners.app` email. Replace them so join is called with exactly the three original fields for both:

```ts
    expect(createPlayer).toHaveBeenCalledWith({
      galaxyId: 'gal-1',
      supabaseAuthId: 'auth-user-1',
      username: 'Captain Nova',
    });
```

and rename the Decentraland test to `'starts Decentraland players in the walkthrough (the ship has a tour)'`, asserting the same exact call. Remove the `auth.admin.getUserById` expectation if any; the mock may stay.

- [ ] **Step 3: Write the restart tests**

Create `src/routes/__tests__/walkthrough.test.ts` (if a walkthrough route test file already exists, add these to it, reusing its mock setup):

```ts
// Galaxy Gardeners — walkthrough restart (one-time opt-in for players who were marked skipped)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

let playerRow: any;
const updates: any[] = [];

vi.mock('../../middleware/auth.js', () => ({
  requirePlayer: (req: any, _res: any, next: any) => { req.playerId = 'player-1'; next(); },
}));
vi.mock('../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn(() => {
      const q: any = {};
      q.select = () => q;
      q.eq = () => q;
      q.single = async () => ({ data: playerRow, error: null });
      q.update = (u: any) => { updates.push(u); playerRow = { ...playerRow, ...u }; return q; };
      return q;
    }),
  },
}));

import { walkthroughRouter } from '../walkthrough.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/walkthrough', walkthroughRouter);
  return a;
}

async function post(body: any) {
  const server = app().listen(0);
  const port = (server.address() as any).port;
  const res = await fetch(`http://127.0.0.1:${port}/walkthrough/progress`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json();
  server.close();
  return { status: res.status, body: json };
}

describe('POST /walkthrough/progress restart', () => {
  beforeEach(() => { updates.length = 0; });

  it('un-skips a player who never began the walkthrough', async () => {
    playerRow = { walkthrough_scene: 0, walkthrough_completed: false, walkthrough_skipped: true };
    const res = await post({ action: 'restart' });
    expect(res.status).toBe(200);
    expect(updates[0]).toEqual({ walkthrough_skipped: false, walkthrough_scene: 0 });
    expect(res.body).toEqual({ walkthroughScene: 0, walkthroughCompleted: false, walkthroughSkipped: false });
  });

  it('refuses once the player has advanced', async () => {
    playerRow = { walkthrough_scene: 3, walkthrough_completed: false, walkthrough_skipped: true };
    const res = await post({ action: 'restart' });
    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });

  it('refuses after the walkthrough was completed', async () => {
    playerRow = { walkthrough_scene: 0, walkthrough_completed: true, walkthrough_skipped: false };
    const res = await post({ action: 'restart' });
    expect(res.status).toBe(400);
    expect(updates).toEqual([]);
  });
});
```

If the repo's other route tests use a `req()` helper instead of `fetch` + `listen`, use that helper instead; the assertions stay the same.

- [ ] **Step 4: Run the tests to see them fail**

Run: `npx vitest run src/routes/__tests__/walkthrough.test.ts src/routes/__tests__/galaxy-stem.test.ts`
Expected: restart tests FAIL (400 "action must be…"), join tests FAIL (`walkthroughSkipped` still passed).

- [ ] **Step 5: Revert the join flag**

In `src/routes/galaxy.ts` remove these lines from the join route and the `isDecentralandEmail` import:

```ts
    // The Decentraland scene has no walkthrough, so its players start with it skipped
    const { data: authUser } = await supabase.auth.admin.getUserById(supabaseAuthId);
    const walkthroughSkipped = isDecentralandEmail(authUser?.user?.email);
```

and call `createPlayer({ galaxyId, supabaseAuthId, username })`. Leave `createPlayer`'s optional `walkthroughSkipped` parameter in place (unused callers are fine).

- [ ] **Step 6: Add the restart action**

In `src/routes/walkthrough.ts` `POST /progress`: allow `'restart'` in the action check and its message (`'action must be "advance", "skip", "complete", or "restart"'`), and before the existing `updates` block handle it:

```ts
    if (action === 'restart') {
      // One-time opt-in for players marked skipped before they ever began (e.g. Decentraland players before the
      // ship tour existed). Refused once they've advanced or completed, so it can't keep pods protected forever.
      const { data: current } = await supabase
        .from('players')
        .select('walkthrough_scene, walkthrough_completed')
        .eq('id', playerId)
        .single();
      if (!current || current.walkthrough_completed || (current.walkthrough_scene ?? 0) > 0) {
        res.status(400).json({ error: 'Tour can only be restarted before it has begun' });
        return;
      }
      updates.walkthrough_skipped = false;
      updates.walkthrough_scene = 0;
    } else if (action === 'advance') {
```

(the existing `if (action === 'advance')` becomes `else if`).

- [ ] **Step 7: Run the tests, the full suite and the type check**

Run: `npx vitest run && npx tsc --noEmit -p . 2>&1 | grep -v authDcl`
Expected: all pass; no type errors (the pre-existing `authDcl.ts` error is filtered).

- [ ] **Step 8: Commit** (do not push; pushing is decided at the end)

```bash
git add src/routes/galaxy.ts src/routes/walkthrough.ts src/routes/__tests__/galaxy-stem.test.ts src/routes/__tests__/walkthrough.test.ts
git commit -m "Walkthrough: Decentraland players start with it active (the ship has a tour); one-time restart action

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Scene — walkthrough API, tour events, station/camera hooks

**Files:**
- Modify: `src/api.ts` (append), `src/stations.ts`, `src/consoleCamera.ts`, `src/ui.tsx`, `src/docking.ts` (surgical)
- Create: `src/tour/events.ts`

**Interfaces:**
- Produces:
  - `api.getWalkthroughState(): Promise<WalkthroughState>`; `api.walkthroughProgress(action: 'advance' | 'skip' | 'complete' | 'restart', scene?: number): Promise<void>`; `api.getWalkthroughSceneData(scene: number): Promise<Record<string, any>>`; `type WalkthroughState = { walkthroughScene: number; walkthroughCompleted: boolean; walkthroughSkipped: boolean }`
  - `src/tour/events.ts`: `type TourEvent = 'exploration_deployed' | 'mining_deployed' | 'docked'`; `emitTourEvent(e: TourEvent): void`; `onTourEvent(fn: (e: TourEvent) => void): void`
  - `stations.ts`: `showStationView(stationId: string, viewId: string): Promise<void>`
  - `consoleCamera.ts`: `setCameraSuspended(on: boolean): void`, `isCameraSuspended(): boolean`

- [ ] **Step 1: API calls** — append to `src/api.ts`:

```ts
// Walkthrough (the STEM ship tour). Progress and per-scene data live on the server.
export type WalkthroughState = { walkthroughScene: number; walkthroughCompleted: boolean; walkthroughSkipped: boolean }

export async function getWalkthroughState(): Promise<WalkthroughState> {
  return apiGet<WalkthroughState>('/api/walkthrough/state')
}

export async function walkthroughProgress(action: 'advance' | 'skip' | 'complete' | 'restart', scene?: number): Promise<void> {
  await apiPost('/api/walkthrough/progress', scene === undefined ? { action } : { action, scene })
}

export async function getWalkthroughSceneData(scene: number): Promise<Record<string, any>> {
  return apiGet<Record<string, any>>(`/api/walkthrough/scene-data/${scene}`)
}
```

- [ ] **Step 2: Tour events** — create `src/tour/events.ts`:

```ts
// Real player actions the ship tour waits for. The deploy and docking code report them here so the tour
// doesn't poll the server.
export type TourEvent = 'exploration_deployed' | 'mining_deployed' | 'docked'

const listeners: ((e: TourEvent) => void)[] = []
export function onTourEvent(fn: (e: TourEvent) => void): void { listeners.push(fn) }
export function emitTourEvent(e: TourEvent): void { for (const fn of listeners) fn(e) }
```

- [ ] **Step 3: Report deploys** — in `src/ui.tsx` `deployPod`, after the success `showNotification(...)` line add:

```ts
    emitTourEvent(body.type === 'belt' ? 'mining_deployed' : 'exploration_deployed')
```

and import `import { emitTourEvent } from './tour/events'`.

- [ ] **Step 4: Report docking** — in `src/docking.ts` `dockAt`, immediately before the final `changed()` of the success path add `emitTourEvent('docked')` and import it. Stage only this hunk and the import: `git add -p src/docking.ts`.

- [ ] **Step 5: Station view switching** — in `src/stations.ts` after `refreshStation` add:

```ts
/** Shows a station's view (a desk tab), e.g. the ship tour pointing at Ship Systems. */
export function showStationView(stationId: string, viewId: string): Promise<void> {
  const s = stations.get(stationId)
  return s ? s.setView(viewId) : Promise.resolve()
}
```

- [ ] **Step 6: Camera suspension** — in `src/consoleCamera.ts` add near the other state:

```ts
// While the ship tour holds the camera, this module leaves MainCamera alone; on release it re-applies its own.
let suspended = false
export function setCameraSuspended(on: boolean): void { suspended = on; if (!on) appliedCamera = null; forceReapply = !on }
export function isCameraSuspended(): boolean { return suspended }
let forceReapply = false
```

and in `consoleCameraSystem`, right after the zone check block (`if (inZone !== active) {...}`), add `if (suspended) return`, then change the apply condition to `if (want !== appliedCamera || forceReapply) { ... ; forceReapply = false }`. (Setting `appliedCamera = null` alone isn't enough when the wanted camera is also null — the free camera — because the tour's camera would stay applied; `forceReapply` makes the next tick write MainCamera.)

- [ ] **Step 7: Hide the HUD camera switcher while the tour holds the camera** — in `src/ui.tsx` `CameraSwitch`, first line: `if (isCameraSuspended()) return null`, importing it from `./consoleCamera`.

- [ ] **Step 8: Build and commit**

Run: `npm run build` — Expected: "Type checking completed without errors".

```bash
git add src/api.ts src/tour/events.ts src/stations.ts src/consoleCamera.ts src/ui.tsx
git add -p src/docking.ts   # only the emitTourEvent hunk and its import
git commit -m "Tour plumbing: walkthrough API, tour events from deploy and dock, station view switching, camera suspension

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Scene — camera shots and the STEM dialog

**Files:**
- Create: `src/tour/shots.ts`, `src/tour/dialog.tsx`
- Modify: `src/ui.tsx` (render the dialog)

**Interfaces:**
- Consumes: `setCameraSuspended` (Task 2), `px` (`src/uiScale.ts`).
- Produces:
  - `shots.ts`: `type ShotId = 'bridge' | 'hologram' | 'hologramClose' | 'shipDesk' | 'floraDesk' | 'navConsole' | 'discovery' | 'galaxyTop'`; `setupTourShots(): void`; `applyShot(id: ShotId): void`; `releaseShot(): void`
  - `dialog.tsx`: `type DialogState = { lines: string[]; index: number; panel?: { title: string; text: string }; waiting: boolean; last: boolean; confirmSkip: boolean; offer: boolean }`; `setTourDialog(s: DialogState | null, handlers: DialogHandlers | null): void`; `type DialogHandlers = { next(): void; skip(): void; confirmSkip(yes: boolean): void; offer(yes: boolean): void }`; `TourDialog` component

- [ ] **Step 1: Shots** — create `src/tour/shots.ts`. Positions come from the scene layout (`index.ts` desks, `navConsole.ts` CONSOLE_POSITION, `discoveryPanel.ts` DISPLAY_CENTER, `consoleCamera.ts` cameras) and are tuned by eye in the preview in Task 6:

```ts
// Fixed cameras for the ship tour. Each shot is a VirtualCamera looking at a target; applying one takes the
// camera from the console camera module (suspended) and releasing hands it back.
import { engine, Entity, Transform, VirtualCamera, MainCamera } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { DECK_Y, PLATFORM_Y } from '../environment'
import { setCameraSuspended } from '../consoleCamera'

export type ShotId = 'bridge' | 'hologram' | 'hologramClose' | 'shipDesk' | 'floraDesk' | 'navConsole' | 'discovery' | 'galaxyTop'

// Desks sit at (128 ± 10.8, 121.3), angled toward the hologram at (128, 128); cameras stand ~5.5 m in front.
const SHOTS: Record<ShotId, { pos: Vector3; lookAt: Vector3 }> = {
  bridge:        { pos: Vector3.create(128, PLATFORM_Y + 3.2, 141.5), lookAt: Vector3.create(128, PLATFORM_Y + 1.2, 124) },
  hologram:      { pos: Vector3.create(128, PLATFORM_Y + 3.5, 137), lookAt: Vector3.create(128, PLATFORM_Y + 1.5, 128) },
  hologramClose: { pos: Vector3.create(128, PLATFORM_Y + 2.6, 133.5), lookAt: Vector3.create(128, PLATFORM_Y + 1.3, 128) },
  shipDesk:      { pos: Vector3.create(134.1, DECK_Y + 2.6, 124.2), lookAt: Vector3.create(138.8, DECK_Y + 2.6, 121.3) },
  floraDesk:     { pos: Vector3.create(121.9, DECK_Y + 2.6, 124.2), lookAt: Vector3.create(117.2, DECK_Y + 2.6, 121.3) },
  navConsole:    { pos: Vector3.create(128, DECK_Y + 3.4, 142.6), lookAt: Vector3.create(128, DECK_Y + 0.9, 134.5) },
  discovery:     { pos: Vector3.create(128, DECK_Y + 2.2, 119.8), lookAt: Vector3.create(128, DECK_Y + 1.0, 114.9) },
  galaxyTop:     { pos: Vector3.create(128, PLATFORM_Y + 15, 128.6), lookAt: Vector3.create(128, PLATFORM_Y + 1, 128) },
}

const cameras = new Map<ShotId, Entity>()

export function setupTourShots(): void {
  for (const id of Object.keys(SHOTS) as ShotId[]) {
    const target = engine.addEntity()
    Transform.create(target, { position: SHOTS[id].lookAt })
    const cam = engine.addEntity()
    Transform.create(cam, { position: SHOTS[id].pos })
    VirtualCamera.create(cam, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(1.2) }, lookAtEntity: target })
    cameras.set(id, cam)
  }
}

export function applyShot(id: ShotId): void {
  const cam = cameras.get(id)
  if (!cam) return
  setCameraSuspended(true)
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: cam })
}

export function releaseShot(): void {
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  setCameraSuspended(false)   // the console camera re-applies the player's own mode on its next tick
}
```

- [ ] **Step 2: Dialog** — create `src/tour/dialog.tsx`:

```tsx
// The STEM terminal dialog for the ship tour: STEM's current line, an optional data panel above it,
// and NEXT / SKIP TOUR (or the skip confirmation, or the one-time tour offer).
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from '../uiScale'

export type DialogState = { lines: string[]; index: number; panel?: { title: string; text: string }; waiting: boolean; last: boolean; confirmSkip: boolean; offer: boolean }
export type DialogHandlers = { next(): void; skip(): void; confirmSkip(yes: boolean): void; offer(yes: boolean): void }

let state: DialogState | null = null
let handlers: DialogHandlers | null = null
export function setTourDialog(s: DialogState | null, h: DialogHandlers | null): void { state = s; handlers = h }

const CYAN = Color4.create(0, 0.9, 1, 1)
const MAGENTA = Color4.create(1, 0.25, 0.85, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const BG = Color4.create(0.02, 0.05, 0.12, 0.94)
const SLOT = Color4.create(0.05, 0.12, 0.2, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)
const W = 900

const Btn = (props: { label: string; primary?: boolean; color?: Color4; onClick: () => void }) => (
  <UiEntity uiTransform={{ height: px(34), padding: { left: px(18), right: px(18) }, margin: { left: px(8) }, justifyContent: 'center', alignItems: 'center' }}
    uiBackground={{ color: props.primary ? (props.color ?? CYAN) : SLOT }} onMouseDown={props.onClick}>
    <Label value={props.label} fontSize={px(13)} color={props.primary ? DARK : (props.color ?? CYAN)} />
  </UiEntity>
)

export const TourDialog = () => {
  if (!state || !handlers) return null
  const s = state, h = handlers
  const line = s.lines[s.index] ?? ''
  return (
    <UiEntity uiTransform={{ width: '100%', positionType: 'absolute', position: { bottom: px(90) }, flexDirection: 'column', alignItems: 'center' }}>
      {s.panel ? (
        <UiEntity uiTransform={{ width: px(W), flexDirection: 'column', padding: px(14), margin: { bottom: px(8) } }} uiBackground={{ color: BG }}>
          <Label value={s.panel.title} fontSize={px(13)} color={MAGENTA} uiTransform={{ height: px(22) }} textAlign="middle-left" />
          <UiEntity uiTransform={{ width: '100%', height: px(22 * s.panel.text.split('\n').length) }}
            uiText={{ value: s.panel.text, fontSize: px(15), color: Color4.White(), textAlign: 'top-left', textWrap: 'wrap' }} />
        </UiEntity>
      ) : null}
      <UiEntity uiTransform={{ width: px(W), flexDirection: 'column', padding: px(16) }} uiBackground={{ color: BG }}>
        <Label value="STEM" fontSize={px(13)} color={CYAN} uiTransform={{ height: px(22) }} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: '100%', height: px(88) }}
          uiText={{ value: line, fontSize: px(18), color: Color4.White(), textAlign: 'top-left', textWrap: 'wrap' }} />
        <UiEntity uiTransform={{ width: '100%', height: px(36), flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' }}>
          {s.offer ? [
            <Btn key="no" label="NO THANKS" onClick={() => h.offer(false)} />,
            <Btn key="yes" label="TAKE TOUR" primary onClick={() => h.offer(true)} />
          ] : s.confirmSkip ? [
            <Label key="q" value="Skip the tour? Pods can be lost once the tour ends." fontSize={px(14)} color={DIM} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />,
            <Btn key="stay" label="KEEP GOING" onClick={() => h.confirmSkip(false)} />,
            <Btn key="skip" label="SKIP TOUR" primary color={MAGENTA} onClick={() => h.confirmSkip(true)} />
          ] : [
            <Label key="w" value={s.waiting ? 'Waiting for you, Captain…' : ''} fontSize={px(14)} color={DIM} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />,
            <Btn key="skip" label="SKIP TOUR" color={MAGENTA} onClick={() => h.skip()} />,
            s.waiting ? null : <Btn key="next" label={s.last && s.index >= s.lines.length - 1 ? 'FINISH' : 'NEXT'} primary onClick={() => h.next()} />
          ]}
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
```

If the type checker rejects arrays of elements or `null` children in ReactEcs, render each button conditionally with `{cond ? <Btn .../> : null}` siblings instead of arrays; behaviour stays the same.

- [ ] **Step 3: Render it** — in `src/ui.tsx` import `TourDialog` from `./tour/dialog` and add `<TourDialog />` just before `<SleepCurtain />` in `uiComponent`.

- [ ] **Step 4: Build and commit**

Run: `npm run build` — Expected: no errors.

```bash
git add src/tour/shots.ts src/tour/dialog.tsx src/ui.tsx
git commit -m "Tour: fixed camera shots and the STEM terminal dialog

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Scene — the tour script

**Files:**
- Create: `src/tour/script.ts`

**Interfaces:**
- Consumes: `ShotId` (Task 3), `TourEvent` (Task 2).
- Produces: `type Step = { shot: ShotId; lines: string[]; panel?: { title: string; text: string }; waitFor?: TourEvent; setup?: StepSetup }`; `type StepSetup = 'systemView' | 'galaxyView' | 'shipOverview' | 'podOperations' | 'shipSystems' | 'floraSummary' | 'floraVault'`; `type TourScene = { number: number; resume: string; steps: Step[] }`; `const TOUR: TourScene[]`; `fill(text: string, data: Record<string, any>): string`

- [ ] **Step 1: Write the script** — create `src/tour/script.ts`. Lines follow `galaxy-gardeners/Galaxy Gardeners/Walkthrough/WalkthroughScenes.swift`, reworded for the ship's desks. Placeholders are `{key}` and are filled from `/api/walkthrough/scene-data/:scene` (scene 2: starName, starType, starDescription, planetCount, beltCount, stationName; scene 3: targetPlanet.name/type/riskTier, targetBelt.name/riskLevel, expeditionTimeMinutes; scene 4: vaultCapacity, miningPods, explorationPods; scene 5: fuelCapacity, fuelCurrent, homeStationName; scene 7: firstExpeditionPlanet).

```ts
// The STEM ship tour, scene by scene. Mirrors the iOS walkthrough's seven scenes with every instruction pointed at
// the ship's desks. {placeholders} come from the server's /api/walkthrough/scene-data/:scene (nested keys with dots).
import { ShotId } from './shots'
import { TourEvent } from './events'

export type StepSetup = 'systemView' | 'galaxyView' | 'shipOverview' | 'podOperations' | 'shipSystems' | 'floraSummary' | 'floraVault'
export type Step = { shot: ShotId; lines: string[]; panel?: { title: string; text: string }; waitFor?: TourEvent; setup?: StepSetup }
export type TourScene = { number: number; resume: string; steps: Step[] }

export const TOUR: TourScene[] = [
  {
    number: 1,
    resume: "Welcome back, Captain. Let's pick up where we left off.",
    steps: [
      { shot: 'bridge', panel: { title: 'SHIP STATUS', text: 'ALL SYSTEMS NOMINAL' }, lines: [
        "Welcome aboard, Captain. I'm STEM — your Ship Telemetry and Exploration Module. I run the navigation, monitor the systems, manage the pods, and keep the lights on.",
        "I've been with this ship a while. You're the new part. Let me show you around.",
      ] },
    ],
  },
  {
    number: 2,
    resume: 'Welcome back, Captain. I was showing you your home system.',
    steps: [
      { shot: 'hologram', setup: 'systemView',
        panel: { title: 'SYSTEM SCAN', text: 'HOME SYSTEM: {starName}\nSTAR TYPE: {starType} — {starDescription}\nPLANETS: {planetCount}\nASTEROID BELTS: {beltCount}' },
        lines: [
          'This is your home system on the hologram. Every explorer gets one — a patch of the galaxy to call their own.',
          "Some of these planets support life — alien flora that's never been cataloged. Barren worlds and gas giants won't have any, but the ones that do each host a unique species. That's where you come in.",
          'Your system also has a space station — {stationName}. We\'ll dock there later.',
        ] },
    ],
  },
  {
    number: 3,
    resume: 'Back online. We were setting up your first expeditions.',
    steps: [
      { shot: 'hologramClose', setup: 'systemView',
        panel: { title: 'EXPLORATION TARGET', text: 'TARGET: {targetPlanet.name}\nTYPE: {targetPlanet.type}\nRISK: {targetPlanet.riskTier}' },
        lines: [
          'Your exploration pods scan planets for alien flora without disturbing the ecosystem. Each scan brings back a holographic sample. The catalog entry is permanent.',
          '{targetPlanet.name} looks safe enough for your first scan. Click it on the hologram, then press DEPLOY EXPLORATION POD.',
        ], waitFor: 'exploration_deployed' },
      { shot: 'hologramClose', setup: 'systemView',
        panel: { title: 'MINING TARGET', text: 'TARGET: {targetBelt.name}\nRISK: {targetBelt.riskLevel}\nREWARDS: Iron Ore, Copper Ore, Helium-3' },
        lines: [
          "A scan of a safe planet takes about {expeditionTimeMinutes} minutes, and expeditions keep running while you're away.",
          'Your other pods are mining pods. They bring back resources from asteroid belts — fuel for the ship and materials for upgrades. Click {targetBelt.name} on the hologram and press DEPLOY MINING POD.',
        ], waitFor: 'mining_deployed' },
      { shot: 'hologram', lines: [
        "Two expeditions running at once. When they return you'll have your first specimen and your first batch of resources. Now, the ship.",
      ] },
    ],
  },
  {
    number: 4,
    resume: 'Systems restored. I was walking you through the ship.',
    steps: [
      { shot: 'shipDesk', setup: 'shipOverview', lines: [
        'This is the ship desk. Ship Overview shows your fuel, cargo, ship stats and active missions — collect finished expeditions here.',
        'REFINE turns mined Helium-3 into 20 fuel and Plasma Crystals into 50. It works anywhere, no station needed.',
      ] },
      { shot: 'shipDesk', setup: 'podOperations', lines: [
        'Pod Operations — view your pods and build new ones. You have {miningPods} mining and {explorationPods} exploration pods.',
      ] },
      { shot: 'shipDesk', setup: 'shipSystems', lines: [
        'Ship Systems — upgrade your fuel tank, shielding, pod bays and more. Upgrades install instantly while docked, and take time in the field.',
      ] },
      { shot: 'floraDesk', setup: 'floraVault', lines: [
        'The Collections desk holds your Flora Catalog, your Specimen Vault — {vaultCapacity} sample slots to start — and your cargo hold.',
      ] },
    ],
  },
  {
    number: 5,
    resume: "Reconnected. Let's talk about fuel and stations.",
    steps: [
      { shot: 'shipDesk', setup: 'shipOverview', panel: { title: 'FUEL STATUS', text: 'FUEL: {fuelCurrent} / {fuelCapacity}\nSOLAR RECHARGE: ACTIVE' }, lines: [
        'Fuel keeps you moving. Travel costs fuel for every galactic unit of distance. Run out and you wait for solar recharge.',
        'Three ways to refuel: refine Helium-3 or Plasma Crystals, wait for the star to recharge you, or buy Fuel Cells with BUY FUEL.',
      ] },
      { shot: 'navConsole', lines: [
        'This is the Stellar Navigation console. Your home station, {homeStationName}, is right here in your system. Press DOCK on the console.',
      ], waitFor: 'docked' },
      { shot: 'navConsole', lines: [
        "Docked. Stations mean cheaper repairs and instant upgrades. When you're ready to move on, press UNDOCK on this console.",
      ] },
    ],
  },
  {
    number: 6,
    resume: 'Signal reacquired. We were looking at the discovery system.',
    steps: [
      { shot: 'discovery', panel: { title: 'DISCOVERY ARRAY', text: 'STATUS: ONLINE\nDIRECTIONS: INWARD · LATERAL · VERTICAL · OUTWARD' }, lines: [
        'The galaxy is near-infinite. New systems are discovered as you push outward, from the Stellar Discovery desk.',
        'Inward — toward the core: riskier, rarer flora. Outward — toward the rim: safer, sparser. Lateral — same depth, new territory. Vertical — above or below the galactic plane, where unusual systems hide.',
        'Every system you discover is visible to all explorers, but you get credit as the discoverer — permanently.',
      ] },
    ],
  },
  {
    number: 7,
    resume: 'Back in range. Take a look at this, Captain.',
    steps: [
      { shot: 'galaxyTop', setup: 'galaxyView', panel: { title: 'TOUR COMPLETE', text: 'MINE · UPGRADE · EXPLORE · DISCOVER · TRADE' }, lines: [
        "This is the galaxy. Every dot is a star system. Most haven't been discovered yet.",
        'Your exploration pod is still scanning {firstExpeditionPlanet}. When it returns you\'ll have your first sample and your first catalog entry.',
        "I'll be here whenever you need me — press STEM at the top of the screen. The galaxy is yours, Captain.",
      ] },
    ],
  },
]

/** Replaces {key} and {nested.key} with values from the scene data; unknown keys become '—'. */
export function fill(text: string, data: Record<string, any>): string {
  return text.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_m, key: string) => {
    const v = key.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), data)
    return v === undefined || v === null || v === '' ? '—' : String(v)
  })
}
```

- [ ] **Step 2: Build and commit**

Run: `npm run build` — Expected: no errors.

```bash
git add src/tour/script.ts
git commit -m "Tour: the seven-scene STEM script, worded for the ship's desks

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Scene — the tour runner and its entry points

**Files:**
- Create: `src/tour/runner.ts`
- Modify: `src/index.ts` (setup and start), `src/stemChat.tsx` (TOUR button and "tour" query)

**Interfaces:**
- Consumes: everything from Tasks 2–4; `isDocked` (`docking.ts`), `isCurrentlyTraveling` (`navigation.ts`), `switchViewMode`/`getViewMode` (`galaxyMap.ts`), `showStationView` (`stations.ts`), `getPref`/`setPref` (`prefs.ts`), `isSleeping` (`sleepMode.ts`), `api.getShipDashboard`, `api.getPlayerMe`.
- Produces: `setupTour(): void`; `startTourIfNeeded(): Promise<void>`; `replayTour(): void`; `isTourRunning(): boolean`

- [ ] **Step 1: Write the runner** — create `src/tour/runner.ts`:

```ts
// Runs the STEM ship tour: one scene at a time, one step at a time, one STEM line at a time. Camera shots and desk
// tabs are set per step; hands-on steps release the camera and wait for the real action (tour events). Progress is
// stored per scene on the server; a replay after completion or skip touches nothing on the server.
import { engine } from '@dcl/sdk/ecs'
import * as api from '../api'
import { TOUR, TourScene, Step, fill } from './script'
import { TourEvent, onTourEvent } from './events'
import { setupTourShots, applyShot, releaseShot } from './shots'
import { setTourDialog, DialogState } from './dialog'
import { showStationView } from '../stations'
import { switchViewMode, getViewMode } from '../galaxyMap'
import { isDocked } from '../docking'
import { isCurrentlyTraveling } from '../navigation'
import { isSleeping } from '../sleepMode'
import { getPref, setPref } from '../prefs'

const OFFER_PREF = 'tourOffered'
const OFFER_LINE = 'Want a tour of the ship, Captain? I can show you the desks and get your first pods out.'

type Run = { sceneIdx: number; stepIdx: number; lineIdx: number; waiting: boolean; confirmSkip: boolean; tracked: boolean; resumeLine: string | null; blocked: string | null }
let run: Run | null = null
let offering = false
let data: Record<number, Record<string, any>> = {}
let sleptWith = false

export function isTourRunning(): boolean { return run !== null }

function scene(): TourScene | null { return run ? TOUR[run.sceneIdx] ?? null : null }
function step(): Step | null { const s = scene(); return s && run ? s.steps[run.stepIdx] ?? null : null }
function sceneData(): Record<string, any> { const s = scene(); return s ? data[s.number] ?? {} : {} }

async function loadSceneData(n: number): Promise<void> {
  if (data[n]) return
  try { data[n] = await api.getWalkthroughSceneData(n) } catch { data[n] = {} }
}

/** Why a hands-on step can't be done right now (null when it can). */
async function blockedReason(wait: TourEvent): Promise<string | null> {
  if (isCurrentlyTraveling()) return "We're in transit, Captain, so that will have to wait until we arrive."
  let player: any = null
  try { player = await api.getPlayerMe() } catch { /* treat as home */ }
  const home = !player || !player.home_system_id || player.home_system_id === player.current_system_id
  const d = sceneData()
  if (wait === 'exploration_deployed') {
    if (!home) return "We're away from your home system, so we'll skip the first scan for now."
    if (!d.targetPlanet) return "There's no living planet in range for a first scan, so let's move on."
    if (d.availableExplorationPods === 0) return 'Every exploration pod is already out, so let\'s move on.'
  }
  if (wait === 'mining_deployed' && (!home || !d.targetBelt)) return "There's no safe belt in range right now, so let's move on."
  if (wait === 'docked' && (!home || !d.homeStationId)) return "There's no station in this system, so docking will have to wait."
  return null
}

/** True when the step's action already happened (a reload after deploying or docking). */
async function alreadyDone(wait: TourEvent): Promise<boolean> {
  if (wait === 'docked') return isDocked()
  try {
    const dash = await api.getShipDashboard()
    const type = wait === 'mining_deployed' ? 'mining' : 'exploration'
    return (dash?.activeExpeditions || []).some((e: any) => e.expedition_type === type && e.status === 'in_progress')
  } catch { return false }
}

function applySetup(st: Step): void {
  switch (st.setup) {
    case 'systemView': if (getViewMode() !== 'system') switchViewMode('system'); break
    case 'galaxyView': if (getViewMode() !== 'galaxy') switchViewMode('galaxy'); break
    case 'shipOverview': void showStationView('ship', 'overview'); break
    case 'podOperations': void showStationView('ship', 'pods'); break
    case 'shipSystems': void showStationView('ship', 'systems'); break
    case 'floraSummary': void showStationView('flora', 'summary'); break
    case 'floraVault': void showStationView('flora', 'vault'); break
  }
}

function render(): void {
  if (offering) {
    const s: DialogState = { lines: [OFFER_LINE], index: 0, waiting: false, last: false, confirmSkip: false, offer: true }
    setTourDialog(s, handlers)
    return
  }
  const st = step()
  if (!run || !st) { setTourDialog(null, null); return }
  const lines = run.blocked ? [run.blocked] : (run.resumeLine ? [run.resumeLine] : []).concat(st.lines.map(l => fill(l, sceneData())))
  const sc = scene()!
  const lastStep = run.sceneIdx === TOUR.length - 1 && run.stepIdx === sc.steps.length - 1
  setTourDialog({
    lines, index: Math.min(run.lineIdx, lines.length - 1),
    panel: st.panel ? { title: st.panel.title, text: fill(st.panel.text, sceneData()) } : undefined,
    waiting: run.waiting, last: lastStep, confirmSkip: run.confirmSkip, offer: false,
  }, handlers)
}

async function enterStep(): Promise<void> {
  const st = step()
  if (!run || !st) return
  run.lineIdx = 0
  run.waiting = false
  run.blocked = null
  applySetup(st)
  applyShot(st.shot)
  render()
}

/** Called when the player has read the last line of a step. */
async function finishStepLines(): Promise<void> {
  const st = step()
  if (!run || !st) return
  if (run.blocked) return advanceStep()   // the player has read why the step can't be done
  if (st.waitFor) {
    if (await alreadyDone(st.waitFor)) return advanceStep()
    const why = await blockedReason(st.waitFor)
    if (why) {
      // Say why; NEXT then moves on (finishStepLines sees run.blocked).
      run.blocked = why
      run.lineIdx = 0
      render()
      return
    }
    run.waiting = true
    releaseShot()   // the player needs their own camera to click the hologram or the console
    render()
    return
  }
  return advanceStep()
}

async function advanceStep(): Promise<void> {
  if (!run) return
  run.resumeLine = null
  const sc = scene()!
  if (run.stepIdx < sc.steps.length - 1) { run.stepIdx++; return enterStep() }
  // Next scene
  if (run.sceneIdx < TOUR.length - 1) {
    run.sceneIdx++
    run.stepIdx = 0
    const n = TOUR[run.sceneIdx].number
    if (run.tracked) { try { await api.walkthroughProgress('advance', n) } catch { /* progress is best effort */ } }
    await loadSceneData(n)
    return enterStep()
  }
  // Finished
  if (run.tracked) { try { await api.walkthroughProgress('complete') } catch { /* best effort */ } }
  end()
}

function end(): void {
  run = null
  releaseShot()
  setTourDialog(null, null)
}

const handlers = {
  next(): void {
    if (!run || run.waiting) return
    const st = step()
    const total = run.blocked ? 1 : (run.resumeLine ? 1 : 0) + (st?.lines.length ?? 0)
    if (run.lineIdx < total - 1) { run.lineIdx++; render(); return }
    void finishStepLines()
  },
  skip(): void { if (run) { run.confirmSkip = true; render() } },
  confirmSkip(yes: boolean): void {
    if (!run) return
    if (!yes) { run.confirmSkip = false; render(); return }
    if (run.tracked) void api.walkthroughProgress('skip').catch(() => { /* best effort */ })
    end()
  },
  offer(yes: boolean): void {
    offering = false
    setPref(OFFER_PREF, true)
    if (!yes) { setTourDialog(null, null); return }
    void (async () => {
      let tracked = false
      try { await api.walkthroughProgress('restart'); tracked = true } catch { /* refused: run as a replay */ }
      await begin(0, tracked, null)
    })()
  },
}

async function begin(sceneIdx: number, tracked: boolean, resumeLine: string | null): Promise<void> {
  data = {}
  await loadSceneData(TOUR[sceneIdx].number)
  run = { sceneIdx, stepIdx: 0, lineIdx: 0, waiting: false, confirmSkip: false, tracked, resumeLine, blocked: null }
  await enterStep()
}

export function setupTour(): void {
  setupTourShots()
  onTourEvent((e) => {
    const st = step()
    if (!run || !run.waiting || st?.waitFor !== e) return
    void advanceStep()
  })
  // Sleep: release the tour camera while asleep, re-apply the step's shot on waking.
  let acc = 0
  engine.addSystem((dt: number) => {
    acc += dt
    if (acc < 0.5) return
    acc = 0
    const asleep = isSleeping()
    if (asleep && !sleptWith && run && !run.waiting) { releaseShot(); sleptWith = true }
    else if (!asleep && sleptWith) { sleptWith = false; const st = step(); if (run && st && !run.waiting) applyShot(st.shot) }
  })
}

/** On load: start or resume the tour for a player mid-walkthrough, or make the one-time offer. */
export async function startTourIfNeeded(): Promise<void> {
  let state: api.WalkthroughState
  try { state = await api.getWalkthroughState() } catch { return }
  if (!state.walkthroughCompleted && !state.walkthroughSkipped) {
    const idx = Math.max(0, TOUR.findIndex(s => s.number === state.walkthroughScene))
    const resume = state.walkthroughScene > 0 ? TOUR[idx].resume : null
    await begin(idx, true, resume)
    return
  }
  if (state.walkthroughSkipped && !state.walkthroughCompleted && !getPref<boolean>(OFFER_PREF, false)) {
    offering = true
    render()
  }
}

/** From the STEM chat: run the tour from the start without touching server progress. */
export function replayTour(): void {
  if (run) return
  offering = false
  void begin(0, false, null)
}
```

Notes for the implementer:
- `api.getPlayerMe()` returns `PlayerInfo` with `home_system_id` and `current_system_id` (see `src/types.ts`).
- The scene 3 data has `availableExplorationPods`; scene 5 has `homeStationId`. `blockedReason` reads these from `sceneData()`, so `loadSceneData` must have run for the current scene (it does in `begin`/`advanceStep`).
- A blocked hands-on step shows only STEM's one-line reason (`run.blocked`); NEXT then moves to the following step. The script itself is never modified.

- [ ] **Step 2: Start it** — in `src/index.ts`: import `{ setupTour, startTourIfNeeded }` from `./tour/runner`; call `setupTour()` next to `setupConsoleCamera()`; after `loadPrefs()` and the initial map/dashboard load have completed (after `restoreMapView()`), call `void startTourIfNeeded()`.

- [ ] **Step 3: Replay from STEM** — in `src/stemChat.tsx`:
  - import `{ replayTour }` from `./tour/runner`;
  - in the panel header, before the X button, add a TOUR button:

```tsx
        <UiEntity uiTransform={{ width: px(56), height: px(24), margin: { right: px(6) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
          onMouseDown={() => { open = false; replayTour() }}>
          <Label value="TOUR" fontSize={px(12)} color={CYAN} />
        </UiEntity>
```

  - in `send()`, before calling the server, handle the tour request locally:

```ts
  if (/\b(tour|walkthrough)\b/i.test(text)) {
    messages.push({ role: 'user', text }, { role: 'stem', text: "Starting the tour, Captain." })
    draft = ''
    inputGeneration++
    open = false
    replayTour()
    return
  }
```

- [ ] **Step 4: Build and commit**

Run: `npm run build` — Expected: no errors.

```bash
git add src/tour/runner.ts src/index.ts src/stemChat.tsx
git commit -m "Tour runner: scenes, hands-on steps, resume, skip, one-time offer, replay from STEM

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Verify end to end in the local preview

**Files:** tune `src/tour/shots.ts` positions only.

- [ ] **Step 1:** Push the server branch after review (the user approves pushes): `git push origin HEAD:main` from the worktree, wait for Railway.
- [ ] **Step 2:** `npm run start` in the scene repo; open the desktop client link it prints.
- [ ] **Step 3:** With an account whose walkthrough is active (a new account, or the one-time offer → TAKE TOUR), check each scene: camera framing per shot (adjust `SHOTS` by eye), desk tabs switch, placeholders filled (no `—` where data exists), scene 3 deploys advance the tour, scene 5 dock advances it, FINISH completes (server state `walkthroughCompleted: true`).
- [ ] **Step 4:** Reload mid-scene 4: the tour resumes at scene 4 with "Systems restored…". Reload after deploying in scene 3: the deploy steps are skipped.
- [ ] **Step 5:** SKIP TOUR → confirm → the camera returns to the player's mode and the HUD camera switcher reappears; server `walkthroughSkipped: true`.
- [ ] **Step 6:** STEM chat TOUR button and typing "tour" both replay without changing server state.
- [ ] **Step 7:** Sleep during a narrated step, wake: the shot is restored.
- [ ] **Step 8:** Commit any shot tuning: `git add src/tour/shots.ts && git commit -m "Tour: shot positions tuned in preview" ...`.
