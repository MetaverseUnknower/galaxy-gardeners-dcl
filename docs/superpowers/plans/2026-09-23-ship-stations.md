# Ship and Flora Stations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three floating panels (ship display, upgrades, catalog) with two desk-mounted stations driven by a reusable, config-based station framework.

**Architecture:** `src/stations.ts` spawns a station's two desk models and parents an invisible screen root to each desk, so tabs draw children in flat screen coordinates and never touch world space. Tabs are small modules with `render(root, ctx)` / `clear()`; the station owns the low screen (tab buttons + a permanent readout) and the shared dashboard fetch. Two config entries in `src/index.ts` create the ship station (east) and the flora station (west).

**Tech Stack:** Decentraland SDK7 (`@dcl/sdk` 7.22), TypeScript, ECS entities with `Transform`, `TextShape`, `MeshRenderer`, `Material`, `pointerEventsSystem`. No test runner exists in this repo.

**Spec:** `docs/superpowers/specs/2026-09-23-ship-stations-design.md`

## Global Constraints

- Node 20 for every command (`source ~/.nvm/nvm.sh && nvm use 20`); the shell default is Node 16, which breaks the SDK tooling.
- Verification per task is `npm run build` (type check must report "Type checking completed without errors") plus a check in the local preview. Start the preview once with `npm start` (it opens the desktop client; if not, run `open "decentraland://realm=http%3A%2F%2F127.0.0.1%3A8001&position=0%2C0&dclenv=org&local-scene=true"`). It recompiles on save; the log line `Found 0 errors` confirms a clean rebuild.
- The preview talks to the production API, so it shows real player data. Do not create galaxies or spend real resources beyond what the verification step names.
- Desk models: `assets/models/nav_panel_high_1.glb` (tall) and `assets/models/nav_panel_low_1.glb` (low). Both are 6m wide. Their front is model **-z**. Desk entities use `Quaternion.fromEulerDegrees(180, yaw, 180)` exactly like the existing desks in `src/environment.ts`.
- Screen coordinates: x to the viewer's right, y up, **negative z toward the viewer**. `TextShape` with identity rotation reads correctly from -z. Children sit at z = -0.02 to -0.05 so they float just off the glass.
- The galaxy map, its control panel, the display-screen desk north of center, the discovery desk and panel, `src/ui.tsx` overlays and `src/api.ts` are not modified except where a task names an exact line.
- Never commit `.dclignore` changes, `scene.json`, or `bin/`. Commit only the files each task lists.

## Review Focus

1. Dashboard fetch fails (API down or 401 mid-session): the tab must draw "Unable to load" and the readout must keep its last values, not throw. Test in Task 1 (stub tab with a forced rejection) and Task 2 (readout with `dashboard === null`).
2. Zero-length lists: no expeditions, no upgrades, no inventory rows, no specimens, no catalog species. Each tab must draw its empty-state text instead of nothing. Covered in Tasks 3, 4, 5, 6.
3. Rapid double-click on a tab button or an action button while a fetch is in flight: the second render must not leave orphaned entities. Task 1's `refresh()` clears before drawing and ignores overlapping calls with a `refreshing` flag.
4. Mission collect where `completeExpedition` throws but `collectExpedition` succeeds (already handled today by nested try/catch); the port in Task 3 keeps that exact control flow.
5. Catalog images that fail to load leave an empty tile; the name label still renders and the tile stays clickable only when an image exists (today's behavior). Task 6 preserves it and checks it in the preview with a species that has no image, if one exists.

---

### Task 1: Station framework

**Files:**
- Create: `src/stations.ts`
- Modify: `src/environment.ts` (remove the four station desk entities: `catalogNavPanel`, `catalogNavLow`, `mirrorNavPanel`, `mirrorNavLow`)
- Modify: `src/index.ts:104-116` (temporary stub stations for verification; replaced in Task 7)

**Interfaces:**
- Produces:
  ```ts
  export interface StationContext {
    dashboard: any | null            // result of api.getShipDashboard(), null on failure
    notify: (text: string, color: Color4) => void
    refresh: () => Promise<void>     // re-fetch dashboard and redraw both screens
    setTab: (id: string) => Promise<void>
  }
  export interface TabDefinition {
    id: string
    label: string
    render?: (root: Entity, ctx: StationContext) => Promise<void>
    clear?: () => void
    action?: () => void              // action-only tab: button calls this, active tab unchanged
  }
  export type ReadoutRenderer = { render: (root: Entity, ctx: StationContext) => void; clear: () => void }
  export interface StationConfig {
    id: string
    position: Vector3                // desk pair position on the deck (world)
    yaw: number                      // middle Euler value; framework applies (180, yaw, 180)
    tabs: TabDefinition[]
    readout: ReadoutRenderer
    notify: (text: string, color: Color4) => void
  }
  export interface Station { id: string; setTab(id: string): Promise<void>; refresh(): Promise<void>; destroy(): void }
  export function createStation(config: StationConfig): Station
  export function refreshStation(id: string): Promise<void>   // no-op if unknown id
  // Screen helpers (all push created entities into `into` and return the primary entity)
  export function screenText(into: Entity[], root: Entity, x: number, y: number, text: string, fontSize: number, color: Color4, align?: TextAlignMode, z?: number): Entity
  export function screenGlass(into: Entity[], root: Entity, x: number, y: number, w: number, h: number, z?: number): Entity
  export function screenButton(into: Entity[], root: Entity, x: number, y: number, w: number, h: number, label: string, hoverText: string, onClick: () => void, opts?: { fontSize?: number; active?: boolean; z?: number }): Entity
  export function screenImage(into: Entity[], root: Entity, x: number, y: number, size: number, src: string, opts?: { z?: number; clickable?: { hoverText: string; onClick: () => void } }): Entity
  export const TOP_SCREEN = { halfWidth: 2.8, halfHeight: 1.4 }
  export const LOW_SCREEN = { halfWidth: 2.8, halfHeight: 1.1 }   // usable area below the button row
  ```

- [ ] **Step 1: Create `src/stations.ts`**

```ts
// Galaxy Gardeners — Station framework
// A station is a tall desk (content screen) plus a low desk (buttons + readout). Screen roots are
// children of the desk entities, so tabs draw in screen coordinates and move with the desks.
import { engine, Entity, Transform, GltfContainer, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem, ColliderLayer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'

export interface StationContext {
  dashboard: any | null
  notify: (text: string, color: Color4) => void
  refresh: () => Promise<void>
  setTab: (id: string) => Promise<void>
}
export interface TabDefinition {
  id: string
  label: string
  render?: (root: Entity, ctx: StationContext) => Promise<void>
  clear?: () => void
  action?: () => void
}
export type ReadoutRenderer = { render: (root: Entity, ctx: StationContext) => void; clear: () => void }
export interface StationConfig {
  id: string
  position: Vector3
  yaw: number
  tabs: TabDefinition[]
  readout: ReadoutRenderer
  notify: (text: string, color: Color4) => void
}
export interface Station { id: string; setTab(id: string): Promise<void>; refresh(): Promise<void>; destroy(): void }

// ---- Desk geometry (model space, measured from the GLBs; front is -z) ----
// Tall desk: vertical screen slab, x ±3.0, y 2.22..5.27, front face at z 0.79.
const TOP_ROOT_OFFSET = Vector3.create(0, 3.75, 0.79)
const TOP_ROOT_ROT = Quaternion.fromEulerDegrees(0, 0, 0)
export const TOP_SCREEN = { halfWidth: 2.8, halfHeight: 1.4 }
// Low desk: sloped face from (y 0.5, z -1.3) at the front lip to (y 2.2, z 0.7) at the back.
// Center (1.35, -0.3); the face is ~50° from vertical, top leaning back toward +z.
const LOW_ROOT_OFFSET = Vector3.create(0, 1.35, -0.3)
const LOW_ROOT_ROT = Quaternion.fromEulerDegrees(50, 0, 0)
export const LOW_SCREEN = { halfWidth: 2.8, halfHeight: 1.1 }
const LOW_BUTTON_ROW_Y = 0.95   // tab buttons run along the top edge of the low screen

// Textured planes: the ship display rotated its icons 180° to read from -z. If images render
// mirrored in the preview, change this to fromEulerDegrees(0, 0, 0).
const IMAGE_ROT = Quaternion.fromEulerDegrees(0, 180, 0)

const GLASS = { albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4), emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND }
const BUTTON = { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 }
const BUTTON_ACTIVE = { albedoColor: Color4.create(0, 0.4, 0.5, 1), emissiveColor: Color3.create(0, 0.9, 1), emissiveIntensity: 2.5 }

// ---- Screen helpers ----
export function screenText(into: Entity[], root: Entity, x: number, y: number, text: string, fontSize: number, color: Color4, align: TextAlignMode = TextAlignMode.TAM_MIDDLE_CENTER, z: number = -0.03): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), parent: root })
  TextShape.create(e, { text, fontSize, textColor: color, textAlign: align })
  into.push(e)
  return e
}

export function screenGlass(into: Entity[], root: Entity, x: number, y: number, w: number, h: number, z: number = -0.01): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), scale: Vector3.create(w, h, 0.02), parent: root })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, GLASS)
  into.push(e)
  return e
}

export function screenButton(into: Entity[], root: Entity, x: number, y: number, w: number, h: number, label: string, hoverText: string, onClick: () => void, opts: { fontSize?: number; active?: boolean; z?: number } = {}): Entity {
  const z = opts.z ?? -0.02
  const btn = engine.addEntity()
  Transform.create(btn, { position: Vector3.create(x, y, z), scale: Vector3.create(w, h, 0.04), parent: root })
  MeshRenderer.setBox(btn); MeshCollider.setBox(btn)
  Material.setPbrMaterial(btn, opts.active ? BUTTON_ACTIVE : BUTTON)
  into.push(btn)
  screenText(into, root, x, y, label, opts.fontSize ?? 0.5, Color4.create(0, 0, 0, 1), TextAlignMode.TAM_MIDDLE_CENTER, z - 0.03)
  pointerEventsSystem.onPointerDown({ entity: btn, opts: { button: InputAction.IA_POINTER, hoverText, maxDistance: 10 } }, onClick)
  return btn
}

export function screenImage(into: Entity[], root: Entity, x: number, y: number, size: number, src: string, opts: { z?: number; clickable?: { hoverText: string; onClick: () => void } } = {}): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.03), scale: Vector3.create(size, size, 1), rotation: IMAGE_ROT, parent: root })
  MeshRenderer.setPlane(e)
  Material.setBasicMaterial(e, { texture: Material.Texture.Common({ src }) })
  if (opts.clickable) {
    MeshCollider.setPlane(e, ColliderLayer.CL_POINTER)
    pointerEventsSystem.onPointerDown({ entity: e, opts: { button: InputAction.IA_POINTER, hoverText: opts.clickable.hoverText, maxDistance: 12 } }, opts.clickable.onClick)
  }
  into.push(e)
  return e
}

// ---- Station ----
const stations = new Map<string, Station>()

export function refreshStation(id: string): Promise<void> {
  const s = stations.get(id)
  return s ? s.refresh() : Promise.resolve()
}

export function createStation(config: StationConfig): Station {
  const rotation = Quaternion.fromEulerDegrees(180, config.yaw, 180)
  const tallDesk = engine.addEntity()
  Transform.create(tallDesk, { position: config.position, rotation })
  GltfContainer.create(tallDesk, { src: 'assets/models/nav_panel_high_1.glb' })
  const lowDesk = engine.addEntity()
  Transform.create(lowDesk, { position: config.position, rotation })
  GltfContainer.create(lowDesk, { src: 'assets/models/nav_panel_low_1.glb' })

  const topRoot = engine.addEntity()
  Transform.create(topRoot, { position: TOP_ROOT_OFFSET, rotation: TOP_ROOT_ROT, parent: tallDesk })
  const lowRoot = engine.addEntity()
  Transform.create(lowRoot, { position: LOW_ROOT_OFFSET, rotation: LOW_ROOT_ROT, parent: lowDesk })

  const lowEntities: Entity[] = []
  const fallbackEntities: Entity[] = []   // "Unable to load" line drawn when a tab's render throws
  let activeTab: TabDefinition | undefined = config.tabs.find(t => t.render)
  let dashboard: any | null = null
  let refreshing = false

  const ctx: StationContext = {
    get dashboard() { return dashboard },
    notify: config.notify,
    refresh: () => station.refresh(),
    setTab: (id: string) => station.setTab(id),
  }

  function clearTop(): void {
    for (const e of fallbackEntities) engine.removeEntity(e)
    fallbackEntities.length = 0
    if (activeTab?.clear) activeTab.clear()
  }
  function clearLow(): void {
    for (const e of lowEntities) engine.removeEntity(e)
    lowEntities.length = 0
    config.readout.clear()
  }

  function drawLow(): void {
    clearLow()
    const n = config.tabs.length
    const gap = 0.15
    const w = Math.min(1.3, (LOW_SCREEN.halfWidth * 2 - gap * (n - 1)) / n)
    const startX = -((w + gap) * (n - 1)) / 2
    config.tabs.forEach((tab, i) => {
      const x = startX + i * (w + gap)
      screenButton(lowEntities, lowRoot, x, LOW_BUTTON_ROW_Y, w, 0.32, tab.label.toUpperCase(), tab.label, () => {
        if (tab.action) { tab.action(); return }
        station.setTab(tab.id)
      }, { fontSize: 0.45, active: tab === activeTab })
    })
    config.readout.render(lowRoot, ctx)
  }

  async function drawTop(): Promise<void> {
    clearTop()
    if (!activeTab?.render) return
    try {
      await activeTab.render(topRoot, ctx)
    } catch (err) {
      console.log(`[station ${config.id}] tab ${activeTab.id} failed:`, err)
      if (activeTab.clear) activeTab.clear()
      screenText(fallbackEntities, topRoot, 0, 0, 'Unable to load', 0.8, Color4.create(0.6, 0.3, 0.3, 1))
    }
  }

  const station: Station = {
    id: config.id,
    async setTab(id: string) {
      const tab = config.tabs.find(t => t.id === id && t.render)
      if (!tab) return
      clearTop()
      activeTab = tab
      drawLow()
      await drawTop()
    },
    async refresh() {
      if (refreshing) return
      refreshing = true
      try {
        try { dashboard = await api.getShipDashboard() } catch { /* keep last dashboard */ }
        drawLow()
        await drawTop()
      } finally { refreshing = false }
    },
    destroy() {
      clearTop(); clearLow()
      for (const e of [topRoot, lowRoot, tallDesk, lowDesk]) engine.removeEntity(e)
      stations.delete(config.id)
    },
  }
  stations.set(config.id, station)
  return station
}
```

- [ ] **Step 2: Remove the four station desk entities from `src/environment.ts`**

Delete the blocks that create `catalogNavPanel`, `catalogNavLow`, `mirrorNavPanel`, and `mirrorNavLow` (each is a `const X = engine.addEntity()` followed by `Transform.create` and `GltfContainer.create`, plus their comment lines). Keep `navPanel` (discovery desk) and `testModel` (galaxy control desk) untouched. The file must still export `PLATFORM_Y` and `DECK_Y`.

- [ ] **Step 3: Add temporary stub stations to `src/index.ts`**

Add these imports at the top of `src/index.ts` (keep the existing ones):

```ts
import { Color4 } from '@dcl/sdk/math'
import { createStation, screenText, screenGlass, TabDefinition, ReadoutRenderer } from './stations'
import { DECK_Y } from './environment'
```

Directly after the `createCatalogPanel()` call (line 116), add:

```ts
    // TEMP (Task 1 verification): stub stations; replaced in Task 7
    const stubTab = (label: string): TabDefinition => {
      const ents: any[] = []
      return {
        id: label.toLowerCase(), label,
        render: async (root, ctx) => {
          screenGlass(ents, root, 0, 0, 5.6, 2.8)
          screenText(ents, root, 0, 0.4, `${label} tab`, 1.2, Color4.create(0, 1, 1, 1))
          screenText(ents, root, 0, -0.4, `fuel ${ctx.dashboard?.ship?.fuel_current ?? '?'}`, 0.8, Color4.create(0.8, 0.8, 0.8, 1))
          if (label === 'Fail') throw new Error('forced')
        },
        clear: () => { for (const e of ents) engine.removeEntity(e); ents.length = 0 },
      }
    }
    const stubReadout = (): ReadoutRenderer => {
      const ents: any[] = []
      return {
        render: (root, ctx) => { screenText(ents, root, 0, 0, `readout fuel ${ctx.dashboard?.ship?.fuel_current ?? '?'}`, 0.7, Color4.create(1, 0.9, 0.3, 1)) },
        clear: () => { for (const e of ents) engine.removeEntity(e); ents.length = 0 },
      }
    }
    const west = createStation({ id: 'flora', position: Vector3.create(117.2, DECK_Y, 121.3), yaw: -32 + 90, tabs: [stubTab('One'), stubTab('Two'), stubTab('Fail'), { id: 'act', label: 'Act', action: () => showNotification('action!', Color4.create(0, 1, 0.5, 1)) }], readout: stubReadout(), notify: showNotification })
    const east = createStation({ id: 'ship', position: Vector3.create(128 + (128 - 117.2), DECK_Y, 121.3), yaw: -(-32 + 90), tabs: [stubTab('One')], readout: stubReadout(), notify: showNotification })
    await west.refresh(); await east.refresh()
```

- [ ] **Step 4: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 5: Preview check**

In the preview, walk to the west desk pair. Expected:
- Both desks are where they were (nothing moved).
- Low screen shows four buttons ONE / TWO / FAIL / ACT along the top edge, readable, ONE highlighted, and a yellow "readout fuel N" line below.
- Tall screen shows a glass panel with "One tab" and a fuel number. Text reads correctly (not mirrored) from the front.
- Click TWO: tall screen switches, TWO highlights. Click FAIL: tall screen shows "Unable to load". Click ACT: notification toast appears, highlight unchanged.
- Click ONE then TWO as fast as you can, three times: exactly one "Two tab" text remains, no ghost "One tab" text.
- East pair shows the same with one button, mirrored placement.
If text is mirrored or the low screen leans the wrong way, adjust `TOP_ROOT_ROT` / `LOW_ROOT_ROT` / `IMAGE_ROT` in `src/stations.ts` and note the final values in the commit message. If the low screen content floats above or sinks into the desk, adjust `LOW_ROOT_OFFSET.y` in 0.1 steps.

- [ ] **Step 6: Commit**

```bash
git add src/stations.ts src/environment.ts src/index.ts
git commit -m "Add station framework: desk-mounted screens with tabs and readout"
```

---

### Task 2: Ship readout (fuel gauge + ship stats)

**Files:**
- Create: `src/stations/shipReadout.ts`

**Interfaces:**
- Consumes: `ReadoutRenderer`, `StationContext`, `screenText`, `screenGlass`, `LOW_SCREEN` from `src/stations.ts`
- Produces:
  ```ts
  export const shipReadout: ReadoutRenderer
  export function setSolarRechargeRate(rate: number): void
  ```

- [ ] **Step 1: Create `src/stations/shipReadout.ts`**

```ts
// Permanent strip on the ship station's low screen: fuel gauge and ship stats.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextAlignMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { ReadoutRenderer, StationContext, screenText, screenGlass, LOW_SCREEN } from '../stations'

let solarRechargeRate = 0
export function setSolarRechargeRate(rate: number): void { solarRechargeRate = rate }

const ents: Entity[] = []
let lastShip: any = null   // survives a failed refresh

function gaugeBar(root: Entity, x: number, y: number, w: number, h: number, color: Color4, emissive: Color3, z: number): void {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), scale: Vector3.create(w, h, 0.02), parent: root })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, { albedoColor: color, emissiveColor: emissive, emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  ents.push(e)
}

export const shipReadout: ReadoutRenderer = {
  render(root: Entity, ctx: StationContext): void {
    const ship = ctx.dashboard?.ship ?? lastShip
    if (!ship) { screenText(ents, root, 0, 0, 'Ship data unavailable', 0.6, Color4.create(0.6, 0.3, 0.3, 1)); return }
    lastShip = ship

    // Fuel gauge across the top of the readout area
    const gaugeW = 4.4, gaugeY = 0.45
    screenText(ents, root, -LOW_SCREEN.halfWidth + 0.1, gaugeY, 'FUEL', 0.7, Color4.create(0, 1, 0.5, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    screenText(ents, root, LOW_SCREEN.halfWidth - 0.1, gaugeY, `${ship.fuel_current.toFixed(0)} / ${ship.fuel_capacity.toFixed(0)}`, 0.6, Color4.create(0.8, 0.8, 0.8, 1), TextAlignMode.TAM_MIDDLE_RIGHT)
    const pct = ship.fuel_capacity > 0 ? Math.max(0, Math.min(1, ship.fuel_current / ship.fuel_capacity)) : 0
    gaugeBar(root, 0, gaugeY - 0.3, gaugeW, 0.18, Color4.create(0.05, 0.1, 0.05, 0.6), Color3.create(0, 0.1, 0), -0.02)
    const fillW = Math.max(0.01, pct * gaugeW)
    gaugeBar(root, -(gaugeW - fillW) / 2, gaugeY - 0.3, fillW, 0.14, Color4.create(0, 0.8, 0.2, 0.8), Color3.create(0, 0.6, 0.15), -0.03)
    if (solarRechargeRate > 0) {
      screenText(ents, root, 0, gaugeY - 0.55, `Solar Recharge: +${solarRechargeRate.toFixed(1)} fuel/hr`, 0.4, Color4.create(1, 0.9, 0.3, 1))
    }

    // Ship stats, two columns of three
    const hullR = ship.hull_reinforcement || 0
    const podS = ship.pod_shielding || 0
    const stats = [
      ['Fuel Efficiency', `${ship.fuel_efficiency.toFixed(1)}x`],
      ['Cargo Capacity', `${ship.resource_storage}`],
      ['Vault Capacity', `${ship.specimen_vault}`],
      ['Expedition Speed', `${ship.expedition_speed.toFixed(1)}x`],
      ['Blast Shielding', `${(hullR * 100).toFixed(0)}%`],
      ['Env. Shielding', `${(podS * 100).toFixed(0)}%`],
    ]
    const colX = [-2.6, 0.3]
    const top = gaugeY - 0.9
    stats.forEach(([label, value], i) => {
      const col = i < 3 ? 0 : 1
      const row = i % 3
      const y = top - row * 0.3
      screenText(ents, root, colX[col], y, label, 0.45, Color4.create(0.5, 0.5, 0.5, 1), TextAlignMode.TAM_MIDDLE_LEFT)
      screenText(ents, root, colX[col] + 2.3, y, value, 0.45, Color4.create(0.9, 0.9, 0.9, 1), TextAlignMode.TAM_MIDDLE_RIGHT)
    })
  },
  clear(): void { for (const e of ents) engine.removeEntity(e); ents.length = 0 },
}
```

- [ ] **Step 2: Wire it into the east stub station in `src/index.ts`**

Replace `readout: stubReadout` in the `east` config with `readout: shipReadout`, and add at the top of the file:

```ts
import { shipReadout, setSolarRechargeRate } from './stations/shipReadout'
```

Change line 62 from `if (currentSys) setSolarRechargeRate(currentSys.solar_recharge_rate)` to keep the same call but drop `setSolarRechargeRate` from the `./shipDisplay` import on line 13 (the new import above provides it).

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check**

At the east desk pair, the low screen shows: FUEL label left, numbers right, a green fill bar proportional to fuel, the solar line if the current system has recharge, and six stats in two columns. Nothing overlaps the button row. Temporarily set `API_BASE` in `src/api.ts` to `https://invalid.galaxygardeners.app`, save, wait for rebuild, click a tab button: readout still shows the last values (or "Ship data unavailable" on a cold start). Restore `API_BASE` to `https://galaxygardeners.app` before continuing.

- [ ] **Step 5: Commit**

```bash
git add src/stations/shipReadout.ts src/index.ts
git commit -m "Add ship readout: fuel gauge and stats on the ship station's low screen"
```

---

### Task 3: Ship Overview tab (active missions)

**Files:**
- Create: `src/stations/shipOverviewTab.ts`

**Interfaces:**
- Consumes: `TabDefinition`, `StationContext`, `screenText`, `screenGlass`, `screenButton`, `TOP_SCREEN`, `refreshStation` from `src/stations.ts`; `api.getExpeditions`, `api.completeExpedition`, `api.collectExpedition`
- Produces: `export const shipOverviewTab: TabDefinition` (id `'overview'`)

- [ ] **Step 1: Create `src/stations/shipOverviewTab.ts`**

```ts
// Ship station — Overview tab: active missions with progress and collect buttons.
import { engine, Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { TabDefinition, StationContext, screenText, screenGlass, screenButton, TOP_SCREEN, refreshStation } from '../stations'

const MISSIONS_PER_PAGE = 6
const ents: Entity[] = []
let expeditions: any[] = []
let actionStatus: Record<string, string> = {}
let page = 0
let currentRoot: Entity | null = null
let currentCtx: StationContext | null = null

function clearEnts(): void { for (const e of ents) engine.removeEntity(e); ents.length = 0 }

function draw(): void {
  if (!currentRoot || !currentCtx) return
  clearEnts()
  const root = currentRoot
  const w = TOP_SCREEN.halfWidth * 2, h = TOP_SCREEN.halfHeight * 2
  screenGlass(ents, root, 0, 0, w, h)

  const totalPages = Math.max(1, Math.ceil(expeditions.length / MISSIONS_PER_PAGE))
  if (page >= totalPages) page = totalPages - 1
  if (page < 0) page = 0
  screenText(ents, root, 0, TOP_SCREEN.halfHeight - 0.3, totalPages > 1 ? `ACTIVE MISSIONS (${page + 1}/${totalPages})` : 'ACTIVE MISSIONS', 1.0, Color4.create(0, 1, 1, 1))

  if (expeditions.length === 0) {
    screenText(ents, root, 0, 0, 'No active missions', 0.7, Color4.create(0.4, 0.4, 0.4, 1))
    return
  }
  if (page > 0) screenButton(ents, root, -1.0, -TOP_SCREEN.halfHeight + 0.3, 0.9, 0.28, '< PREV', 'Previous Page', () => { page--; draw() }, { fontSize: 0.4 })
  if (page < totalPages - 1) screenButton(ents, root, 1.0, -TOP_SCREEN.halfHeight + 0.3, 0.9, 0.28, 'NEXT >', 'Next Page', () => { page++; draw() }, { fontSize: 0.4 })

  const start = page * MISSIONS_PER_PAGE
  const end = Math.min(start + MISSIONS_PER_PAGE, expeditions.length)
  for (let i = start; i < end; i++) {
    const exp = expeditions[i]
    const y = TOP_SCREEN.halfHeight - 0.9 - (i - start) * 0.34
    const isComplete = exp.status === 'completed' || (exp.completes_at && new Date(exp.completes_at).getTime() <= Date.now())
    const typeLabel = exp.expedition_type === 'mining' ? 'Mining' : 'Exploration'
    const status = actionStatus[exp.id]
    let timeText: string
    if (status) timeText = status
    else if (isComplete) timeText = 'READY'
    else { const mins = Math.max(0, Math.ceil((new Date(exp.completes_at).getTime() - Date.now()) / 60000)); const hrs = Math.floor(mins / 60); timeText = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m` }

    screenText(ents, root, -TOP_SCREEN.halfWidth + 0.3, y, typeLabel, 0.55, exp.expedition_type === 'mining' ? Color4.create(0.9, 0.7, 0.3, 1) : Color4.create(0.2, 0.8, 0.4, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    screenText(ents, root, 1.4, y, timeText, 0.55, isComplete ? Color4.create(1, 1, 0, 1) : Color4.create(0.6, 0.6, 0.6, 1), TextAlignMode.TAM_MIDDLE_RIGHT)
    if (isComplete && !status) {
      screenButton(ents, root, 2.2, y, 0.9, 0.26, 'COLLECT', 'Complete Mission', () => collect(exp.id), { fontSize: 0.4 })
    }
  }
}

async function collect(expeditionId: string): Promise<void> {
  const ctx = currentCtx
  if (!ctx) return
  actionStatus[expeditionId] = 'Processing...'
  draw()
  try {
    let result: any = null
    try { result = await api.completeExpedition(expeditionId) } catch {}
    if (result?.pod_lost) {
      ctx.notify('Expedition failed — pod destroyed!', Color4.create(1, 0.3, 0.3, 1))
    } else {
      try {
        await api.collectExpedition(expeditionId)
        if (result?.type === 'exploration') {
          const parts: string[] = []
          if (result.newSpecies) parts.push('New species!')
          if (result.sampleCollected) parts.push('Sample collected')
          ctx.notify(parts.length > 0 ? `Exploration success! ${parts.join(' — ')}` : 'Exploration complete!', Color4.create(0.2, 0.8, 0.4, 1))
          refreshStation('flora')
        } else if (result?.rewards) {
          const rt = Object.entries(result.rewards).filter(([k]) => k !== 'species_id').map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')
          ctx.notify(rt ? `Mining successful! ${rt}` : 'Mining complete!', Color4.create(0.9, 0.7, 0.3, 1))
          refreshStation('flora')
        } else { ctx.notify('Collected!', Color4.create(0, 1, 0.5, 1)) }
      } catch { ctx.notify('Already collected', Color4.create(0.7, 0.7, 0.7, 1)) }
    }
    delete actionStatus[expeditionId]
    await ctx.refresh()   // re-fetches dashboard (fuel/readout) and re-renders this tab
  } catch (err: any) { actionStatus[expeditionId] = err.message || 'Failed'; draw() }
}

export const shipOverviewTab: TabDefinition = {
  id: 'overview',
  label: 'Overview',
  async render(root: Entity, ctx: StationContext): Promise<void> {
    currentRoot = root; currentCtx = ctx
    const exps = await api.getExpeditions()   // throws -> framework shows "Unable to load"
    expeditions = exps.filter((e: any) => e.status !== 'collected')
    draw()
  },
  clear(): void { clearEnts(); currentRoot = null },
}
```

- [ ] **Step 2: Put it on the east stub station in `src/index.ts`**

Replace `tabs: [stubTab('One')]` in the `east` config with `tabs: [shipOverviewTab]` and add the import:

```ts
import { shipOverviewTab } from './stations/shipOverviewTab'
```

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check**

East tall screen lists active missions (or "No active missions"). If a mission shows READY, click COLLECT: the row shows "Processing...", a toast appears, the list re-renders without that mission, and the readout's fuel/stats redraw. Deploy a pod from the galaxy view if you need a mission (this is the one real action the verification allows).

- [ ] **Step 5: Commit**

```bash
git add src/stations/shipOverviewTab.ts src/index.ts
git commit -m "Add ship Overview tab: active missions on the ship station"
```

---

### Task 4: Ship Upgrades tab

**Files:**
- Create: `src/stations/shipUpgradesTab.ts`

**Interfaces:**
- Consumes: framework exports as in Task 3; `api.getAvailableUpgrades`, `api.applyUpgrade`
- Produces: `export const shipUpgradesTab: TabDefinition` (id `'upgrades'`)

- [ ] **Step 1: Create `src/stations/shipUpgradesTab.ts`**

```ts
// Ship station — Upgrades tab: available upgrades in two columns with install buttons.
import { engine, Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { TabDefinition, StationContext, screenText, screenGlass, screenButton, TOP_SCREEN } from '../stations'

const CATEGORY_LABELS: Record<string, string> = {
  fuel_tank: 'Fuel Tank', fuel_efficiency: 'Fuel Efficiency', cargo_hold: 'Cargo Hold', specimen_vault: 'Specimen Vault',
  mining_bay: 'Mining Bay', exploration_bay: 'Exploration Bay', expedition_speed: 'Expedition Speed',
  hull_reinforcement: 'Blast Shielding', pod_shielding: 'Env. Shielding', discovery_array: 'Discovery Array',
}
const ents: Entity[] = []
let upgrades: any[] = []
let actionStatus: Record<string, string> = {}
let currentRoot: Entity | null = null
let currentCtx: StationContext | null = null

function labelFor(category: string): string {
  return CATEGORY_LABELS[category] || category.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
}
function clearEnts(): void { for (const e of ents) engine.removeEntity(e); ents.length = 0 }

function draw(): void {
  if (!currentRoot) return
  clearEnts()
  const root = currentRoot
  screenGlass(ents, root, 0, 0, TOP_SCREEN.halfWidth * 2, TOP_SCREEN.halfHeight * 2)
  screenText(ents, root, 0, TOP_SCREEN.halfHeight - 0.3, 'SHIP UPGRADES', 1.0, Color4.create(0, 1, 1, 1))
  if (upgrades.length === 0) {
    screenText(ents, root, 0, 0, 'All upgrades maxed!', 0.7, Color4.create(0.4, 0.4, 0.4, 1))
    return
  }
  const colX = [-2.6, 0.2]
  const rowH = 0.42
  upgrades.forEach((u, i) => {
    const col = i < 5 ? 0 : 1
    const row = i < 5 ? i : i - 5
    const x = colX[col]
    const y = TOP_SCREEN.halfHeight - 0.85 - row * rowH
    const status = actionStatus[u.category]
    const costs = Object.entries(u.resourceCosts as Record<string, number>).map(([k, v]) => `${v} ${labelFor(k)}`).join(', ')
    screenText(ents, root, x, y, `${labelFor(u.category)} T${u.tier}`, 0.42, Color4.create(0, 0.8, 1, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    screenText(ents, root, x, y - 0.16, status || costs, 0.3, status ? Color4.create(0, 1, 0.5, 1) : (u.canAfford ? Color4.create(0.7, 0.7, 0.7, 1) : Color4.create(0.8, 0.3, 0.3, 1)), TextAlignMode.TAM_MIDDLE_LEFT)
    if (u.canAfford && !status) {
      screenButton(ents, root, x + 2.1, y - 0.06, 0.7, 0.24, 'UPGRADE', `Upgrade ${labelFor(u.category)}`, () => install(u.category), { fontSize: 0.32 })
    } else if (!status) {
      screenText(ents, root, x + 2.1, y - 0.06, 'NEED RESOURCES', 0.26, Color4.create(0.4, 0.4, 0.4, 1))
    }
  })
}

async function install(category: string): Promise<void> {
  const ctx = currentCtx
  if (!ctx) return
  actionStatus[category] = 'Upgrading...'
  draw()
  try {
    await api.applyUpgrade(category)
    ctx.notify(`${labelFor(category)} upgraded!`, Color4.create(0, 1, 0.5, 1))
  } catch (err: any) {
    ctx.notify(err.message || 'Upgrade failed', Color4.create(1, 0.3, 0.3, 1))
  }
  delete actionStatus[category]
  await ctx.refresh()   // readout stats change after an upgrade; tab re-renders via render()
}

export const shipUpgradesTab: TabDefinition = {
  id: 'upgrades',
  label: 'Upgrades',
  async render(root: Entity, ctx: StationContext): Promise<void> {
    currentRoot = root; currentCtx = ctx
    upgrades = await api.getAvailableUpgrades()
    draw()
  },
  clear(): void { clearEnts(); currentRoot = null },
}
```

- [ ] **Step 2: Add it to the east stub station in `src/index.ts`**

`tabs: [shipOverviewTab, shipUpgradesTab]` and import `shipUpgradesTab` from `./stations/shipUpgradesTab`.

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check**

Click UPGRADES on the east low screen: the tall screen lists upgrades in two columns with tier, cost, and either an UPGRADE button or NEED RESOURCES. Do not click UPGRADE unless you intend to spend the resources. Switch back to OVERVIEW and confirm no upgrade text remains.

- [ ] **Step 5: Commit**

```bash
git add src/stations/shipUpgradesTab.ts src/index.ts
git commit -m "Add ship Upgrades tab"
```

---

### Task 5: Flora readout and Inventory tab

**Files:**
- Create: `src/stations/floraReadout.ts`
- Create: `src/stations/inventoryTab.ts`

**Interfaces:**
- Consumes: framework exports; dashboard fields `ship.specimen_vault`, `specimenSamples[]`, `inventory[]` (rows from the `resource_inventory` table: `resource_type: string`, `quantity: number`; verified in the server's `supabase/migrations/002_tables.sql`)
- Produces: `export const floraReadout: ReadoutRenderer`; `export const inventoryTab: TabDefinition` (id `'inventory'`)

- [ ] **Step 1: Create `src/stations/floraReadout.ts`**

```ts
// Permanent strip on the flora station's low screen: vault usage and species discovered.
import { engine, Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { ReadoutRenderer, StationContext, screenText, LOW_SCREEN } from '../stations'

const ents: Entity[] = []
let last: { jars: number; capacity: number; species: number } | null = null
let speciesCount = 0
export function setSpeciesCount(n: number): void { speciesCount = n }

export const floraReadout: ReadoutRenderer = {
  render(root: Entity, ctx: StationContext): void {
    const d = ctx.dashboard
    if (d?.ship) last = { jars: (d.specimenSamples || []).length, capacity: d.ship.specimen_vault ?? 0, species: speciesCount }
    if (!last) { screenText(ents, root, 0, 0.3, 'Vault data unavailable', 0.6, Color4.create(0.6, 0.3, 0.3, 1)); return }
    const y = 0.4
    screenText(ents, root, -LOW_SCREEN.halfWidth + 0.1, y, 'SPECIMEN VAULT', 0.6, Color4.create(0, 1, 0.5, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    screenText(ents, root, LOW_SCREEN.halfWidth - 0.1, y, `${last.jars} / ${last.capacity} jars`, 0.6, Color4.create(0.8, 0.8, 0.8, 1), TextAlignMode.TAM_MIDDLE_RIGHT)
    screenText(ents, root, -LOW_SCREEN.halfWidth + 0.1, y - 0.4, 'SPECIES DISCOVERED', 0.6, Color4.create(0, 1, 0.5, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    screenText(ents, root, LOW_SCREEN.halfWidth - 0.1, y - 0.4, `${last.species}`, 0.6, Color4.create(0.8, 0.8, 0.8, 1), TextAlignMode.TAM_MIDDLE_RIGHT)
  },
  clear(): void { for (const e of ents) engine.removeEntity(e); ents.length = 0 },
}
```

- [ ] **Step 2: Create `src/stations/inventoryTab.ts`**

```ts
// Flora station — Inventory tab: mined resources with quantities.
import { engine, Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { TabDefinition, StationContext, screenText, screenGlass, TOP_SCREEN } from '../stations'

const ents: Entity[] = []
function pretty(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

export const inventoryTab: TabDefinition = {
  id: 'inventory',
  label: 'Inventory',
  async render(root: Entity, ctx: StationContext): Promise<void> {
    screenGlass(ents, root, 0, 0, TOP_SCREEN.halfWidth * 2, TOP_SCREEN.halfHeight * 2)
    screenText(ents, root, 0, TOP_SCREEN.halfHeight - 0.3, 'CARGO INVENTORY', 1.0, Color4.create(0, 1, 1, 1))
    if (!ctx.dashboard) throw new Error('no dashboard')
    const rows: any[] = (ctx.dashboard.inventory || []).filter((r: any) => (r.quantity ?? 0) > 0)
    const capacity = ctx.dashboard.ship?.resource_storage
    const total = rows.reduce((s: number, r: any) => s + (r.quantity ?? 0), 0)
    screenText(ents, root, 0, TOP_SCREEN.halfHeight - 0.7, capacity ? `${total} / ${capacity} units` : `${total} units`, 0.5, Color4.create(0.5, 0.5, 0.5, 1))
    if (rows.length === 0) {
      screenText(ents, root, 0, 0, 'Cargo hold is empty.\nMine asteroid belts to gather resources.', 0.6, Color4.create(0.4, 0.4, 0.4, 1))
      return
    }
    rows.sort((a: any, b: any) => (b.quantity ?? 0) - (a.quantity ?? 0))
    const colX = [-2.6, 0.2]
    rows.slice(0, 12).forEach((r: any, i: number) => {
      const col = i < 6 ? 0 : 1
      const row = i % 6
      const y = TOP_SCREEN.halfHeight - 1.1 - row * 0.32
      screenText(ents, root, colX[col], y, pretty(r.resource_type), 0.45, Color4.create(0.8, 0.8, 0.8, 1), TextAlignMode.TAM_MIDDLE_LEFT)
      screenText(ents, root, colX[col] + 2.3, y, `${r.quantity}`, 0.45, Color4.create(0.9, 0.7, 0.3, 1), TextAlignMode.TAM_MIDDLE_RIGHT)
    })
  },
  clear(): void { for (const e of ents) engine.removeEntity(e); ents.length = 0 },
}
```

- [ ] **Step 3: Wire into the west stub station in `src/index.ts`**

West config: `tabs: [inventoryTab, stubTab('Two')]`, `readout: floraReadout`. Imports:

```ts
import { floraReadout } from './stations/floraReadout'
import { inventoryTab } from './stations/inventoryTab'
```

- [ ] **Step 4: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 5: Preview check**

West low screen shows jar count against capacity and a species count (0 until Task 6 sets it). Tall screen lists resources with quantities, or the empty-cargo message. Numbers match the 2D refinery overlay's stock for helium/plasma/fuel cells.

- [ ] **Step 6: Commit**

```bash
git add src/stations/floraReadout.ts src/stations/inventoryTab.ts src/index.ts
git commit -m "Add flora readout and Inventory tab"
```

---

### Task 6: Vault and Catalog tabs

**Files:**
- Create: `src/stations/floraTabs.ts` (shared tile grid + both tabs)

**Interfaces:**
- Consumes: framework exports incl. `screenImage`; `api.getCatalog`, `api.getCatalogDetail`; `selectBody` from `src/systemView.ts`; `setSpeciesCount` from `./floraReadout`
- Produces:
  ```ts
  export const vaultTab: TabDefinition      // id 'vault'
  export const catalogTab: TabDefinition    // id 'catalog'
  export function setFloraSelectCallback(cb: (flora: any) => void): void
  ```

- [ ] **Step 1: Create `src/stations/floraTabs.ts`**

```ts
// Flora station — Vault and Catalog tabs. Both draw a paged 6x2 tile grid of species.
import { engine, Entity, MeshRenderer, Material, MaterialTransparencyMode, Transform, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'
import * as api from '../api'
import { selectBody } from '../systemView'
import { TabDefinition, StationContext, screenText, screenGlass, screenButton, screenImage, TOP_SCREEN } from '../stations'
import { setSpeciesCount } from './floraReadout'

const COLS = 6, ROWS = 2, PER_PAGE = COLS * ROWS
const TILE = 0.72, SPACING = 0.9
const RARITY_COLORS: Record<string, Color4> = {
  common: Color4.create(0.6, 0.6, 0.6, 1), uncommon: Color4.create(0.2, 0.8, 0.3, 1), rare: Color4.create(0.2, 0.5, 1, 1),
  epic: Color4.create(0.7, 0.3, 1, 1), legendary: Color4.create(1, 0.7, 0.1, 1), mythic: Color4.create(1, 0.3, 0.5, 1),
}
let onFloraSelect: ((flora: any) => void) | null = null
export function setFloraSelectCallback(cb: (flora: any) => void): void { onFloraSelect = cb }

let catalogData: any[] = []
const catalogDetails: Record<string, any> = {}
function capitalize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

async function loadCatalog(): Promise<void> {
  const catalog = await api.getCatalog()
  catalogData = catalog.reverse()
  setSpeciesCount(catalogData.length)
}

function handleFloraSelect(entry: any, detail: any, loading: boolean): void {
  selectBody(null)
  const details: Record<string, string> = {}
  details['Rarity'] = capitalize(entry.rarity || 'unknown')
  if (entry.count) details['Specimens'] = `${entry.count}`
  details['Location'] = entry.body_name || entry.planet_name || 'Unknown'
  details['System'] = entry.system_name || 'Unknown'
  if (loading) details['Traits'] = 'Loading...'
  else if (detail) {
    for (const k of ['atmosphere', 'temperature', 'gravity', 'moisture', 'radiation', 'soil']) if (detail[k]) details[capitalize(k)] = capitalize(detail[k])
    if (detail.discovered_by) details['Discovered By'] = detail.discovered_by
  }
  if (onFloraSelect) onFloraSelect({ type: 'flora', name: entry.name, id: entry.id, imageUrl: entry.image_url, details, canDeploy: false })
}

async function onTileClick(entry: any): Promise<void> {
  handleFloraSelect(entry, catalogDetails[entry.id], !catalogDetails[entry.id])
  if (!catalogDetails[entry.id]) {
    try { catalogDetails[entry.id] = await api.getCatalogDetail(entry.id) } catch {}
    handleFloraSelect(entry, catalogDetails[entry.id], false)
  }
}

// One grid renderer shared by both tabs. `state` holds the page so PREV/NEXT can redraw.
function makeGridTab(id: string, label: string, title: string, emptyText: string, getEntries: (ctx: StationContext) => Promise<any[]>, countLine: (entries: any[], ctx: StationContext) => string, showCount: boolean): TabDefinition {
  const ents: Entity[] = []
  let page = 0
  let root: Entity | null = null
  let ctx: StationContext | null = null
  let entries: any[] = []

  function clearEnts(): void { for (const e of ents) engine.removeEntity(e); ents.length = 0 }
  function draw(): void {
    if (!root || !ctx) return
    clearEnts()
    screenGlass(ents, root, 0, 0, TOP_SCREEN.halfWidth * 2, TOP_SCREEN.halfHeight * 2)
    screenText(ents, root, 0, TOP_SCREEN.halfHeight - 0.3, title, 1.0, Color4.create(0, 1, 1, 1))
    const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE))
    if (page >= totalPages) page = totalPages - 1
    if (page < 0) page = 0
    screenText(ents, root, 0, TOP_SCREEN.halfHeight - 0.65, `${countLine(entries, ctx)}${totalPages > 1 ? ` — Page ${page + 1}/${totalPages}` : ''}`, 0.45, Color4.create(0.5, 0.5, 0.5, 1))
    if (entries.length === 0) { screenText(ents, root, 0, -0.1, emptyText, 0.55, Color4.create(0.4, 0.4, 0.4, 1)); return }
    const start = page * PER_PAGE
    const slice = entries.slice(start, Math.min(start + PER_PAGE, entries.length))
    const gridTopY = TOP_SCREEN.halfHeight - 1.3
    const gridLeftX = -((COLS - 1) * SPACING) / 2
    slice.forEach((entry, i) => {
      const x = gridLeftX + (i % COLS) * SPACING
      const y = gridTopY - Math.floor(i / COLS) * (SPACING + 0.25)
      const bg = engine.addEntity()
      Transform.create(bg, { position: Vector3.create(x, y, -0.02), scale: Vector3.create(TILE, TILE, 0.01), parent: root! })
      MeshRenderer.setBox(bg)
      Material.setPbrMaterial(bg, { albedoColor: Color4.create(0.02, 0.02, 0.05, 0.8), transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
      ents.push(bg)
      if (entry.image_url) screenImage(ents, root!, x, y, TILE - 0.05, entry.image_url, { z: -0.035, clickable: { hoverText: entry.name, onClick: () => onTileClick(entry) } })
      screenText(ents, root!, x, y - TILE / 2 - 0.14, showCount ? `${entry.name} (x${entry.count})` : entry.name, 0.38, RARITY_COLORS[entry.rarity] || Color4.create(0.8, 0.8, 0.8, 1))
    })
    if (page > 0) screenButton(ents, root, -0.6, -TOP_SCREEN.halfHeight + 0.25, 0.8, 0.26, '< PREV', 'Previous Page', () => { page--; draw() }, { fontSize: 0.36 })
    if (page < totalPages - 1) screenButton(ents, root, 0.6, -TOP_SCREEN.halfHeight + 0.25, 0.8, 0.26, 'NEXT >', 'Next Page', () => { page++; draw() }, { fontSize: 0.36 })
  }

  return {
    id, label,
    async render(r: Entity, c: StationContext): Promise<void> {
      root = r; ctx = c
      entries = await getEntries(c)
      draw()
    },
    clear(): void { clearEnts(); root = null },
  }
}

export const catalogTab = makeGridTab('catalog', 'Catalog', 'FLORA CATALOG',
  'No species discovered yet.\nExplore life-bearing planets\nto discover alien flora!',
  async () => { await loadCatalog(); return catalogData },
  (entries) => `${entries.length} species cataloged`, false)

export const vaultTab = makeGridTab('vault', 'Vault', 'SPECIMEN VAULT',
  'No specimens in vault.\nComplete exploration expeditions\nto collect samples!',
  async (ctx) => {
    if (catalogData.length === 0) await loadCatalog()
    if (!ctx.dashboard) throw new Error('no dashboard')
    const samples: any[] = ctx.dashboard.specimenSamples || []
    const counts: Record<string, number> = {}
    for (const s of samples) counts[s.species_id] = (counts[s.species_id] || 0) + 1
    return Object.entries(counts).map(([speciesId, count]) => {
      const c = catalogData.find(e => e.id === speciesId)
      return { id: speciesId, name: c?.name || 'Unknown Species', rarity: c?.rarity || 'common', image_url: c?.image_url || null, count }
    })
  },
  (_entries, ctx) => `${(ctx.dashboard?.specimenSamples || []).length} specimens stored`, true)
```

- [ ] **Step 2: Wire into the west stub station in `src/index.ts`**

West config: `tabs: [inventoryTab, vaultTab, catalogTab]`. Replace the existing `setFloraSelectCallback` import from `./catalogPanel` with one from `./stations/floraTabs` and import `vaultTab, catalogTab` from the same module. Keep the existing `setFloraSelectCallback((flora) => { clearSelectedFlora(); setSelectedFlora(flora) })` call.

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check**

West station: CATALOG shows the species grid with images and rarity-colored names; clicking a tile opens the flora detail in the 2D UI (same as before) and the galaxy view responds. VAULT shows grouped specimens with (xN) counts. Readout's species count now matches the catalog count. Images must not be mirrored; if they are, flip `IMAGE_ROT` in `src/stations.ts` and re-check Task 1's icons too. Page through if more than 12 entries.

- [ ] **Step 5: Commit**

```bash
git add src/stations/floraTabs.ts src/index.ts
git commit -m "Add Vault and Catalog tabs on the flora station"
```

---

### Task 7: Final wiring, action tabs, remove the old panels

**Files:**
- Modify: `src/index.ts` (replace stub code; final station configs)
- Modify: `src/ui.tsx:13` and `src/ui.tsx:94`
- Delete: `src/shipDisplay.ts`, `src/upgradesPanel.ts`, `src/catalogPanel.ts`

**Interfaces:**
- Consumes: everything produced in Tasks 1-6; `openRefineryDialog`, `openPurchaseDialog`, `showNotification` from `src/ui.tsx`

- [ ] **Step 1: Replace the stub block and old panel wiring in `src/index.ts`**

Remove these imports: `./shipDisplay` (line 13), `./upgradesPanel` (line 16), `./catalogPanel` (line 17). Remove lines 58-63 (`setMissionNotifyCallback` … `createShipDisplay()`), lines 104-105 (`setUpgradeNotifyCallback` / `createUpgradesPanel()`), the `createCatalogPanel()` call, and the whole TEMP stub block. Keep `setCloseDetailCallback` and `setFloraSelectCallback` calls. Then add, where the TEMP block was:

```ts
    const currentSys = systems.find(s => s.id === playerInfo!.current_system_id)
    if (currentSys) setSolarRechargeRate(currentSys.solar_recharge_rate)

    const floraStation = createStation({
      id: 'flora',
      position: Vector3.create(117.2, DECK_Y, 121.3),
      yaw: -32 + 90,
      tabs: [inventoryTab, vaultTab, catalogTab],
      readout: floraReadout,
      notify: showNotification,
    })
    const shipStation = createStation({
      id: 'ship',
      position: Vector3.create(128 + (128 - 117.2), DECK_Y, 121.3),
      yaw: -(-32 + 90),
      tabs: [
        shipOverviewTab,
        shipUpgradesTab,
        { id: 'refinery', label: 'Refinery', action: () => openRefineryDialog() },
        { id: 'buyfuel', label: 'Buy Fuel', action: () => openPurchaseDialog() },
      ],
      readout: shipReadout,
      notify: showNotification,
    })
    await Promise.all([floraStation.refresh(), shipStation.refresh()])
```

Final import block additions at the top of `src/index.ts`:

```ts
import { createStation } from './stations'
import { shipReadout, setSolarRechargeRate } from './stations/shipReadout'
import { shipOverviewTab } from './stations/shipOverviewTab'
import { shipUpgradesTab } from './stations/shipUpgradesTab'
import { floraReadout } from './stations/floraReadout'
import { inventoryTab } from './stations/inventoryTab'
import { vaultTab, catalogTab, setFloraSelectCallback } from './stations/floraTabs'
import { DECK_Y } from './environment'
```

Make sure `createEnvironment, respawnSystem, twinkleSystem` stay imported from `./environment` alongside `DECK_Y`.

- [ ] **Step 2: Update `src/ui.tsx`**

Line 13: replace `import { refreshMissions, createShipDisplay } from './shipDisplay'` with `import { refreshStation } from './stations'`.
Line 94: replace `refreshMissions()` with `refreshStation('ship')`.
Search the file for any remaining `createShipDisplay(` call (the refinery/purchase overlays may refresh the ship display after a successful action) and replace each with `refreshStation('ship')`.

- [ ] **Step 3: Delete the old modules**

```bash
git rm src/shipDisplay.ts src/upgradesPanel.ts src/catalogPanel.ts
```

- [ ] **Step 4: Build and grep for stragglers**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2 && grep -rn "shipDisplay\|upgradesPanel\|catalogPanel\|refreshMissions\|refreshCatalog" src/ || echo "no stragglers"`
Expected: `Type checking completed without errors` and `no stragglers`

- [ ] **Step 5: Full preview walkthrough (spec verification list)**

1. The floating fuel/missions display behind the galaxy controls is gone; the galaxy control panel and its desk are unchanged.
2. The east-wall upgrades panel is gone. The floating catalog panel above the west desks is gone.
3. Ship station: OVERVIEW lists missions; UPGRADES lists upgrades; REFINERY opens the 2D refinery overlay; BUY FUEL opens the purchase overlay; readout shows fuel and stats. Close the refinery overlay after a refine (if you have stock) and confirm the readout fuel updates.
4. Flora station: INVENTORY, VAULT, CATALOG all render; selecting a species opens its detail and drives the galaxy view.
5. Deploy a pod from the galaxy view: OVERVIEW picks up the new mission after the overlay's refresh.
6. Walk away 12m+ and back: nothing has moved.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/ui.tsx
git commit -m "Wire ship and flora stations; remove the old floating panels"
```

- [ ] **Step 7: Deploy to the world**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run deploy -- --target-content https://worlds-content-server.decentraland.org`
Sign in the browser with the `0x7e56…374c` wallet. Expected log line: `Content uploaded successfully`. Then load `https://play.decentraland.org/?realm=metapetal.dcl.eth&position=0,0` and repeat items 3 and 4 of Step 5.
