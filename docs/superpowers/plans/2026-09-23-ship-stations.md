# Ship and Flora Stations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the three floating panels (ship display, upgrades, catalog) with two desk-mounted stations, styled after the concept art, driven by a reusable config-based station framework.

**Architecture:** `src/stations.ts` spawns a station's two desk models and parents an invisible screen root to each, so views draw children in flat screen coordinates and never touch world space. A view renders both screens (top and low) at once; the station owns view switching, the shared dashboard fetch and error fallback. `src/stations/draw.ts` implements the concept's visual language once (frames, headers, bars, buttons, tiles, list rows, hologram). Two config entries in `src/index.ts` create the ship station (east) and the flora station (west).

**Tech Stack:** Decentraland SDK7 (`@dcl/sdk` 7.22), TypeScript, ECS entities with `Transform`, `TextShape`, `MeshRenderer`, `Material`, `GltfContainer`, `pointerEventsSystem`. No test runner exists in this repo.

**Spec:** `docs/superpowers/specs/2026-09-23-ship-stations-design.md` (read it first; view the four PNGs in `docs/superpowers/specs/references/` with the Read tool before drawing any screen).

## Global Constraints

- Node 20 for every command (`source ~/.nvm/nvm.sh && nvm use 20`); the shell default is Node 16, which breaks the SDK tooling.
- Verification per task is `npm run build` (type check must print "Type checking completed without errors") plus a check in the local preview. Start the preview once with `npm start`; it prints a `decentraland://` link, and if the desktop client did not open, run `open "decentraland://realm=http%3A%2F%2F127.0.0.1%3A8001&position=0%2C0&dclenv=org&local-scene=true"` (the port may be 8000 if free). The preview recompiles on save; the log line `Found 0 errors` confirms a clean rebuild. Reload the world in the client to see changes.
- The preview talks to the production API and shows real player data. Do not create galaxies or spend real resources beyond what a verification step names.
- Desk models: `assets/models/nav_panel_high_1.glb` (tall) and `assets/models/nav_panel_low_1.glb` (low), both 6m wide, front is model **-z**. Desk entities use `Quaternion.fromEulerDegrees(180, yaw, 180)` exactly like the existing desks in `src/environment.ts`.
- Screen coordinates: x to the viewer's right, y up, **negative z toward the viewer**. `TextShape` with identity rotation reads correctly from -z. Children sit at z between -0.01 and -0.06 so they float just off the glass; things that must be in front of other things use the more negative z.
- Usable areas: top screen x ±2.8, y ±1.4; low screen x ±2.8, y ±1.2.
- Colors (from `draw.ts`): CYAN for lines, titles, bars, outline buttons, and for the selected state of category tiles and list rows (bright cyan border and fill, as in the flora concept); MAGENTA only for the selected upgrade card on the ship Systems view (as in the ship concept); WHITE for values; DIM for subtitles; MUTED for footers and empty states. Title text size 0.9, subtitle 0.32, body 0.42, small 0.32.
- Icons are optional everywhere in the helpers, but every icon the plan names now exists in `assets/icons/` (the eight new ones are transparent placeholders until real art replaces them; see `assets/icons/manifest.json`). Wire the paths as written; a placeholder simply renders nothing.
- The galaxy map, its control panel, the display-screen desk north of center, the discovery desk and panel, `src/ui.tsx` overlays and `src/api.ts` are not modified except where a task names an exact line.
- Never commit `scene.json`, `.dclignore`, or `bin/`. Commit only the files each task lists.

## Review Focus

1. Dashboard fetch fails (API down or 401 mid-session): the framework draws "Unable to load" and keeps the last good dashboard, never throws out of `refresh()`. Task 1 forces it with a stub view that throws and with a bad `API_BASE`.
2. Empty lists: no missions, no upgrades, no inventory rows, no specimens, no species. Every view draws its empty-state text. Tasks 2, 3, 4, 5 each name the empty state.
3. Rapid clicks on view tiles or action buttons while a fetch is in flight must not leave orphaned entities. Task 1's `refresh()`/`setView()` clear before drawing and coalesce overlapping calls; its preview step clicks fast.
4. Mission collect where `completeExpedition` throws but `collectExpedition` succeeds keeps today's nested try/catch flow (Task 2).
5. A species with no `image_url` must still list, select, and show details with an empty image frame (Task 5).

---

### Task 1: Station framework and drawing helpers

**Files:**
- Create: `src/stations.ts`
- Create: `src/stations/draw.ts`
- Modify: `src/environment.ts` (remove the four station desk entities: `catalogNavPanel`, `catalogNavLow`, `mirrorNavPanel`, `mirrorNavLow`)
- Modify: `src/index.ts` (temporary stub stations for verification; replaced in Task 6)

**Interfaces:**
- Produces (`src/stations.ts`):
  ```ts
  export interface StationContext { dashboard: any | null; notify(text: string, color: Color4): void; refresh(): Promise<void>; setView(id: string): Promise<void> }
  export interface Screens { top: Entity; low: Entity }
  export interface ViewDefinition { id: string; render(screens: Screens, ctx: StationContext): Promise<void>; clear(): void }
  export interface StationConfig { id: string; position: Vector3; yaw: number; views: ViewDefinition[]; notify: (text: string, color: Color4) => void }
  export interface Station { id: string; currentView(): string; setView(id: string): Promise<void>; refresh(): Promise<void>; destroy(): void }
  export function createStation(config: StationConfig): Station
  export function refreshStation(id: string): Promise<void>     // no-op for unknown id
  export const TOP = { halfW: 2.8, halfH: 1.4 }
  export const LOW = { halfW: 2.8, halfH: 1.2 }
  ```
- Produces (`src/stations/draw.ts`):
  ```ts
  export type Bag = Entity[]
  export const CYAN: Color4; CYAN3: Color3; MAGENTA: Color4; MAGENTA3: Color3; WHITE: Color4; DIM: Color4; MUTED: Color4; GREEN: Color4; RED: Color4
  export function text(into: Bag, root: Entity, x: number, y: number, str: string, size: number, color?: Color4, align?: TextAlignMode, z?: number): Entity
  export function frame(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts?: { border?: Color3; borderWidth?: number; fill?: Color4; z?: number }): Entity
  export function bar(into: Bag, root: Entity, x: number, y: number, w: number, pct: number, opts?: { h?: number; color?: Color3; z?: number }): void
  export function icon(into: Bag, root: Entity, x: number, y: number, size: number, src: string, opts?: { color?: Color3; z?: number }): Entity
  export function header(into: Bag, root: Entity, x: number, y: number, opts: { icon?: string; title: string; subtitle?: string; size?: number }): void
  export function button(into: Bag, root: Entity, x: number, y: number, w: number, h: number, label: string, hover: string, onClick: () => void, opts?: { variant?: 'outline' | 'primary' | 'magenta' | 'disabled'; size?: number; icon?: string; z?: number }): Entity
  export function tile(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { icon?: string; title: string; subtitle?: string; selected?: boolean; hover: string; onClick: () => void }): void
  export function listRow(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { label: string; sublabel?: string; selected?: boolean; hover: string; onClick: () => void; imageSrc?: string | null }): void
  export function image(into: Bag, root: Entity, x: number, y: number, w: number, h: number, src: string, opts?: { z?: number }): Entity
  export function hologram(into: Bag, root: Entity, x: number, y: number, src: string, scale: number, opts?: { z?: number; spin?: boolean }): Entity
  export function clearBag(bag: Bag): void
  export function clickable(e: Entity, hover: string, onClick: () => void): void
  export const GREEN3: Color3; RED3: Color3
  ```

- [ ] **Step 1: Create `src/stations/draw.ts`**

```ts
// Galaxy Gardeners — Station drawing helpers
// Implements the concept art's visual language once: dark glass frames with thin cyan borders,
// icon + title + subtitle headers, cyan bars, outline/primary buttons, category tiles, list rows.
// All helpers draw children of a screen root in screen coordinates (x right, y up, -z toward viewer).
import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem, ColliderLayer, GltfContainer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'

export type Bag = Entity[]

export const CYAN3 = Color3.create(0, 0.9, 1)
export const CYAN = Color4.create(0, 0.9, 1, 1)
export const MAGENTA3 = Color3.create(1, 0.25, 0.8)
export const MAGENTA = Color4.create(1, 0.25, 0.8, 1)
export const WHITE = Color4.create(0.92, 0.95, 1, 1)
export const DIM = Color4.create(0.45, 0.65, 0.75, 1)
export const MUTED = Color4.create(0.35, 0.45, 0.55, 1)
export const GREEN3 = Color3.create(0.2, 1, 0.6)
export const GREEN = Color4.create(0.2, 1, 0.6, 1)
export const RED3 = Color3.create(1, 0.35, 0.35)
export const RED = Color4.create(1, 0.35, 0.35, 1)
const GLASS_FILL = Color4.create(0.02, 0.05, 0.12, 0.55)
const TRACK_FILL = Color4.create(0.05, 0.12, 0.2, 0.9)

// Textured planes: the old ship display rotated its icons 180° to read from -z. If images render
// mirrored in the preview, change this to fromEulerDegrees(0, 0, 0).
const IMAGE_ROT = Quaternion.fromEulerDegrees(0, 180, 0)

export function clearBag(bag: Bag): void { for (const e of bag) engine.removeEntity(e); bag.length = 0 }

/** Makes any box-shaped entity (a frame's fill, a button) respond to pointer clicks. */
export function clickable(e: Entity, hover: string, onClick: () => void): void {
  MeshCollider.setBox(e)
  pointerEventsSystem.onPointerDown({ entity: e, opts: { button: InputAction.IA_POINTER, hoverText: hover, maxDistance: 10 } }, onClick)
}

export function text(into: Bag, root: Entity, x: number, y: number, str: string, size: number, color: Color4 = WHITE, align: TextAlignMode = TextAlignMode.TAM_MIDDLE_CENTER, z: number = -0.04): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), parent: root })
  TextShape.create(e, { text: str, fontSize: size, textColor: color, textAlign: align })
  into.push(e)
  return e
}

function box(into: Bag, root: Entity, x: number, y: number, z: number, w: number, h: number, fill: Color4, emissive?: Color3, emissiveIntensity: number = 0): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, z), scale: Vector3.create(w, h, 0.01), parent: root })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, { albedoColor: fill, emissiveColor: emissive ?? Color3.Black(), emissiveIntensity, metallic: 0.2, roughness: 0.8, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  into.push(e)
  return e
}

/** Glass panel with four thin emissive border strips. Returns the fill entity. */
export function frame(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { border?: Color3; borderWidth?: number; fill?: Color4; z?: number } = {}): Entity {
  const z = opts.z ?? -0.01
  const bw = opts.borderWidth ?? 0.02
  const border = opts.border ?? CYAN3
  const borderFill = Color4.create(border.r, border.g, border.b, 1)
  const fill = box(into, root, x, y, z, w, h, opts.fill ?? GLASS_FILL)
  box(into, root, x, y + h / 2, z - 0.005, w, bw, borderFill, border, 2)
  box(into, root, x, y - h / 2, z - 0.005, w, bw, borderFill, border, 2)
  box(into, root, x - w / 2, y, z - 0.005, bw, h, borderFill, border, 2)
  box(into, root, x + w / 2, y, z - 0.005, bw, h, borderFill, border, 2)
  return fill
}

/** Progress bar: dark track with a filled portion from the left. pct is clamped to 0..1. */
export function bar(into: Bag, root: Entity, x: number, y: number, w: number, pct: number, opts: { h?: number; color?: Color3; z?: number } = {}): void {
  const h = opts.h ?? 0.12
  const z = opts.z ?? -0.03
  const c = opts.color ?? CYAN3
  const p = Math.max(0, Math.min(1, isFinite(pct) ? pct : 0))
  box(into, root, x, y, z, w, h, TRACK_FILL)
  const fw = Math.max(0.01, p * w)
  box(into, root, x - (w - fw) / 2, y, z - 0.005, fw, h * 0.7, Color4.create(c.r, c.g, c.b, 1), c, 2.5)
}

/** Tinted glyph from a white-on-transparent PNG. */
export function icon(into: Bag, root: Entity, x: number, y: number, size: number, src: string, opts: { color?: Color3; z?: number } = {}): Entity {
  const c = opts.color ?? CYAN3
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.04), scale: Vector3.create(size, size, 1), rotation: IMAGE_ROT, parent: root })
  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, { texture: Material.Texture.Common({ src }), emissiveTexture: Material.Texture.Common({ src }), albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: c, emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  into.push(e)
  return e
}

/** Left-aligned section header: optional icon, cyan title, dim uppercase subtitle underneath. */
export function header(into: Bag, root: Entity, x: number, y: number, opts: { icon?: string; title: string; subtitle?: string; size?: number }): void {
  const size = opts.size ?? 0.9
  let tx = x
  if (opts.icon) { icon(into, root, x + size * 0.28, y, size * 0.5, opts.icon); tx = x + size * 0.65 }
  text(into, root, tx, y + (opts.subtitle ? 0.06 : 0), opts.title, size, CYAN, TextAlignMode.TAM_MIDDLE_LEFT)
  if (opts.subtitle) text(into, root, tx, y - size * 0.32, opts.subtitle.toUpperCase(), size * 0.36, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
}

/** Clickable button. 'outline' = dark fill + cyan border + cyan text; 'primary' = bright cyan fill + dark text;
 *  'magenta' = magenta border/text; 'disabled' = muted, not clickable. */
export function button(into: Bag, root: Entity, x: number, y: number, w: number, h: number, label: string, hover: string, onClick: () => void, opts: { variant?: 'outline' | 'primary' | 'magenta' | 'disabled'; size?: number; icon?: string; z?: number } = {}): Entity {
  const variant = opts.variant ?? 'outline'
  const z = opts.z ?? -0.03
  const size = opts.size ?? 0.42
  const accent = variant === 'magenta' ? MAGENTA3 : variant === 'disabled' ? Color3.create(0.3, 0.38, 0.45) : CYAN3
  const fill = variant === 'primary' ? Color4.create(accent.r, accent.g, accent.b, 1) : Color4.create(0.02, 0.06, 0.12, 0.95)
  const btn = frame(into, root, x, y, w, h, { border: accent, fill, z })
  const labelColor = variant === 'primary' ? Color4.create(0.02, 0.05, 0.1, 1) : variant === 'disabled' ? MUTED : Color4.create(accent.r, accent.g, accent.b, 1)
  let lx = x
  if (opts.icon) { icon(into, root, x - w / 2 + h * 0.6, y, h * 0.6, opts.icon, { color: variant === 'primary' ? Color3.create(0.02, 0.05, 0.1) : accent, z: z - 0.01 }); lx = x + h * 0.3 }
  text(into, root, lx, y, label, size, labelColor, TextAlignMode.TAM_MIDDLE_CENTER, z - 0.01)
  if (variant !== 'disabled') clickable(btn, hover, onClick)
  return btn
}

/** Category card: icon on top, title, subtitle. Selected cards get a bright border. */
export function tile(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { icon?: string; title: string; subtitle?: string; selected?: boolean; hover: string; onClick: () => void }): void {
  const border = opts.selected ? CYAN3 : Color3.create(0.1, 0.35, 0.45)
  const fill = opts.selected ? Color4.create(0.02, 0.12, 0.2, 0.8) : GLASS_FILL
  const f = frame(into, root, x, y, w, h, { border, borderWidth: opts.selected ? 0.035 : 0.02, fill })
  if (opts.icon) icon(into, root, x, y + h * 0.15, h * 0.42, opts.icon, { color: opts.selected ? CYAN3 : Color3.create(0.2, 0.55, 0.7) })
  text(into, root, x, y - h * 0.24, opts.title.toUpperCase(), 0.5, opts.selected ? CYAN : DIM)
  if (opts.subtitle) text(into, root, x, y - h * 0.38, opts.subtitle.toUpperCase(), 0.28, opts.selected ? DIM : MUTED)
  clickable(f, opts.hover, opts.onClick)
}

/** Selectable list row with optional thumbnail on the left. */
export function listRow(into: Bag, root: Entity, x: number, y: number, w: number, h: number, opts: { label: string; sublabel?: string; selected?: boolean; hover: string; onClick: () => void; imageSrc?: string | null }): void {
  const border = opts.selected ? CYAN3 : Color3.create(0.1, 0.3, 0.4)
  const fill = opts.selected ? Color4.create(0.02, 0.2, 0.3, 0.9) : Color4.create(0.02, 0.05, 0.12, 0.6)
  const f = frame(into, root, x, y, w, h, { border, fill })
  let lx = x - w / 2 + 0.12
  if (opts.imageSrc) { image(into, root, x - w / 2 + h * 0.55, y, h * 0.8, h * 0.8, opts.imageSrc, { z: -0.03 }); lx = x - w / 2 + h * 1.1 }
  text(into, root, lx, y + (opts.sublabel ? 0.05 : 0), opts.label, 0.36, opts.selected ? WHITE : DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  if (opts.sublabel) text(into, root, lx, y - 0.08, opts.sublabel, 0.26, MUTED, TextAlignMode.TAM_MIDDLE_LEFT)
  if (opts.selected) text(into, root, x + w / 2 - 0.12, y, '›', 0.5, CYAN, TextAlignMode.TAM_MIDDLE_RIGHT)
  clickable(f, opts.hover, opts.onClick)
}

/** Untinted textured plane (species images). */
export function image(into: Bag, root: Entity, x: number, y: number, w: number, h: number, src: string, opts: { z?: number } = {}): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.04), scale: Vector3.create(w, h, 1), rotation: IMAGE_ROT, parent: root })
  MeshRenderer.setPlane(e)
  Material.setBasicMaterial(e, { texture: Material.Texture.Common({ src }) })
  into.push(e)
  return e
}

// Slowly yawing GLB "hologram". One shared system drives every live hologram.
const spinning: Entity[] = []
let spinSystemAdded = false
function spinSystem(dt: number): void {
  for (let i = spinning.length - 1; i >= 0; i--) {
    const t = Transform.getMutableOrNull(spinning[i])
    if (!t) { spinning.splice(i, 1); continue }
    t.rotation = Quaternion.multiply(t.rotation, Quaternion.fromEulerDegrees(0, 12 * dt, 0))
  }
}
export function hologram(into: Bag, root: Entity, x: number, y: number, src: string, scale: number, opts: { z?: number; spin?: boolean } = {}): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: Vector3.create(x, y, opts.z ?? -0.15), scale: Vector3.create(scale, scale, scale), parent: root })
  GltfContainer.create(e, { src })
  into.push(e)
  if (opts.spin !== false) { spinning.push(e); if (!spinSystemAdded) { engine.addSystem(spinSystem); spinSystemAdded = true } }
  return e
}
```

- [ ] **Step 2: Create `src/stations.ts`**

```ts
// Galaxy Gardeners — Station framework
// A station is a tall desk (top screen) plus a low desk (low screen). Screen roots are children of
// the desk entities, so views draw in screen coordinates and move with the desks. A view renders
// both screens; the station owns view switching and the shared dashboard fetch.
import { engine, Entity, Transform, GltfContainer } from '@dcl/sdk/ecs'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { Bag, clearBag, text, RED } from './stations/draw'

export interface StationContext {
  dashboard: any | null
  notify(text: string, color: Color4): void
  refresh(): Promise<void>
  setView(id: string): Promise<void>
}
export interface Screens { top: Entity; low: Entity }
export interface ViewDefinition {
  id: string
  render(screens: Screens, ctx: StationContext): Promise<void>
  clear(): void
}
export interface StationConfig {
  id: string
  position: Vector3
  yaw: number
  views: ViewDefinition[]
  notify: (text: string, color: Color4) => void
}
export interface Station { id: string; currentView(): string; setView(id: string): Promise<void>; refresh(): Promise<void>; destroy(): void }

// Desk geometry in model space (front is -z), measured from the GLBs.
// Tall desk: vertical screen slab x ±3.0, y 2.22..5.27, front face at z 0.79.
const TOP_ROOT_OFFSET = Vector3.create(0, 3.75, 0.79)
const TOP_ROOT_ROT = Quaternion.fromEulerDegrees(0, 0, 0)
// Low desk: sloped face from (y 0.5, z -1.3) to (y 2.2, z 0.7); center (1.35, -0.3); ~50° from vertical.
const LOW_ROOT_OFFSET = Vector3.create(0, 1.35, -0.3)
const LOW_ROOT_ROT = Quaternion.fromEulerDegrees(50, 0, 0)
export const TOP = { halfW: 2.8, halfH: 1.4 }
export const LOW = { halfW: 2.8, halfH: 1.2 }

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
  const top = engine.addEntity()
  Transform.create(top, { position: TOP_ROOT_OFFSET, rotation: TOP_ROOT_ROT, parent: tallDesk })
  const low = engine.addEntity()
  Transform.create(low, { position: LOW_ROOT_OFFSET, rotation: LOW_ROOT_ROT, parent: lowDesk })
  const screens: Screens = { top, low }

  const fallback: Bag = []
  let active: ViewDefinition = config.views[0]
  let dashboard: any | null = null
  let busy = false
  let queued = false

  const ctx: StationContext = {
    get dashboard() { return dashboard },
    notify: config.notify,
    refresh: () => station.refresh(),
    setView: (id: string) => station.setView(id),
  }

  function clearAll(): void { clearBag(fallback); active.clear() }

  async function draw(): Promise<void> {
    clearAll()
    try {
      await active.render(screens, ctx)
    } catch (err) {
      console.log(`[station ${config.id}] view ${active.id} failed:`, err)
      active.clear()
      text(fallback, top, 0, 0, 'Unable to load', 0.8, RED)
    }
  }

  // Serialises draws: a call while one is running re-runs once at the end so the last request wins.
  async function run(job: () => Promise<void>): Promise<void> {
    if (busy) { queued = true; return }
    busy = true
    try {
      await job()
      while (queued) { queued = false; await draw() }
    } finally { busy = false }
  }

  const station: Station = {
    id: config.id,
    currentView: () => active.id,
    async setView(id: string) {
      const v = config.views.find(x => x.id === id)
      if (!v) return
      await run(async () => { clearAll(); active = v; await draw() })
    },
    async refresh() {
      await run(async () => {
        try { dashboard = await api.getShipDashboard() } catch { /* keep last dashboard */ }
        await draw()
      })
    },
    destroy() {
      clearAll()
      for (const e of [top, low, tallDesk, lowDesk]) engine.removeEntity(e)
      stations.delete(config.id)
    },
  }
  stations.set(config.id, station)
  return station
}
```

- [ ] **Step 3: Remove the four station desk entities from `src/environment.ts`**

Delete the blocks that create `catalogNavPanel`, `catalogNavLow`, `mirrorNavPanel`, and `mirrorNavLow`, each a `const X = engine.addEntity()` followed by `Transform.create` and `GltfContainer.create` plus its comment lines. Keep `navPanel` (discovery desk) and `testModel` (galaxy control desk) untouched. The file must still export `PLATFORM_Y` and `DECK_Y`.

- [ ] **Step 4: Add temporary stub stations to `src/index.ts`**

Add these imports at the top of `src/index.ts` (keep the existing ones):

```ts
import { Color4 } from '@dcl/sdk/math'
import { createStation, ViewDefinition } from './stations'
import { Bag, clearBag, text, frame, header, bar, button, tile, listRow, CYAN, DIM, MUTED } from './stations/draw'
import { DECK_Y } from './environment'
```

Directly after the `createCatalogPanel()` call, add:

```ts
    // TEMP (Task 1 verification): stub views exercising every helper; replaced in Task 6
    const stubView = (id: string, fail = false): ViewDefinition => {
      const bag: Bag = []
      return {
        id,
        async render({ top, low }, ctx) {
          frame(bag, top, 0, 0, 5.6, 2.8)
          header(bag, top, -2.6, 1.05, { icon: 'assets/icons/catalog-icon.png', title: `VIEW ${id.toUpperCase()}`, subtitle: 'explore // study // preserve' })
          text(bag, top, 2.6, 1.1, `fuel ${ctx.dashboard?.ship?.fuel_current ?? '?'}`, 0.4, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
          tile(bag, top, -1.85, -0.3, 1.6, 1.5, { icon: 'assets/icons/catalog-icon.png', title: 'Tile A', subtitle: 'selected', selected: true, hover: 'A', onClick: () => ctx.setView('a') })
          tile(bag, top, 0, -0.3, 1.6, 1.5, { icon: 'assets/icons/specimen-icon.png', title: 'Tile B', subtitle: 'goes to b', hover: 'B', onClick: () => ctx.setView('b') })
          tile(bag, top, 1.85, -0.3, 1.6, 1.5, { title: 'Fail', subtitle: 'throws', hover: 'fail', onClick: () => ctx.setView('fail') })
          text(bag, top, 0, -1.25, 'SELECT A CATEGORY', 0.3, MUTED)
          frame(bag, low, -1.4, 0, 2.6, 2.2)
          header(bag, low, -2.6, 0.85, { title: 'LIST', subtitle: 'rows' })
          listRow(bag, low, -1.4, 0.3, 2.3, 0.32, { label: 'Row one', sublabel: 'selected', selected: true, hover: 'one', onClick: () => ctx.notify('row one', Color4.create(0, 1, 0.5, 1)) })
          listRow(bag, low, -1.4, -0.1, 2.3, 0.32, { label: 'Row two', hover: 'two', onClick: () => ctx.notify('row two', Color4.create(0, 1, 0.5, 1)) })
          bar(bag, low, -1.4, -0.6, 2.2, 0.66)
          frame(bag, low, 1.4, 0, 2.6, 2.2)
          button(bag, low, 1.4, 0.5, 2.0, 0.4, 'PRIMARY', 'primary', () => ctx.notify('primary', CYAN), { variant: 'primary' })
          button(bag, low, 1.4, 0, 2.0, 0.4, 'OUTLINE', 'outline', () => ctx.refresh(), { icon: 'assets/icons/refinery-icon.png' })
          button(bag, low, 1.4, -0.5, 2.0, 0.4, 'DISABLED', 'disabled', () => {}, { variant: 'disabled' })
          if (fail) throw new Error('forced')
        },
        clear() { clearBag(bag) },
      }
    }
    const west = createStation({ id: 'flora', position: Vector3.create(117.2, DECK_Y, 121.3), yaw: -32 + 90, views: [stubView('a'), stubView('b'), stubView('fail', true)], notify: showNotification })
    const east = createStation({ id: 'ship', position: Vector3.create(128 + (128 - 117.2), DECK_Y, 121.3), yaw: -(-32 + 90), views: [stubView('a')], notify: showNotification })
    await Promise.all([west.refresh(), east.refresh()])
```

Add `TextAlignMode` to the `@dcl/sdk/ecs` import at the top of `src/index.ts`.

- [ ] **Step 5: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 6: Preview check**

At the west desk pair, compare with `references/flora-station-concept.png`:
- Desks have not moved. Top screen: a full-width frame with cyan borders, header with a tinted plant glyph, three tiles with Tile A highlighted, footer text. Text reads correctly (not mirrored). Icons are cyan glyphs, not black squares; if mirrored, flip `IMAGE_ROT` in `draw.ts`.
- Low screen: two frames sitting on the sloped face, list rows with the selected one highlighted and a `›`, a bar two-thirds full, three buttons with the primary one bright.
- Click Tile B: top header reads VIEW B; click Fail: "Unable to load" appears in red and the low screen is empty; click Tile A again: everything returns.
- Click OUTLINE (refresh) five times fast, then Tile B, Tile A, Tile B as fast as you can: exactly one set of content is visible at the end, no ghosts.
- Temporarily set `API_BASE` in `src/api.ts` to `https://invalid.galaxygardeners.app`, save, wait for `Found 0 errors`, reload, click OUTLINE: the screens redraw with the last fuel value, no error. Restore `API_BASE` to `https://galaxygardeners.app`.
If the low screen content sinks into or floats above the desk, adjust `LOW_ROOT_OFFSET.y` in 0.1 steps; if it leans the wrong way, negate the 50 in `LOW_ROOT_ROT`. Record final values in the commit message if changed.

- [ ] **Step 7: Commit**

```bash
git add src/stations.ts src/stations/draw.ts src/environment.ts src/index.ts
git commit -m "Add station framework and drawing helpers for desk-mounted screens"
```

---

### Task 2: Ship Overview view

**Files:**
- Create: `src/stations/shipOverview.ts`

**Interfaces:**
- Consumes: `ViewDefinition`, `StationContext`, `Screens`, `TOP`, `LOW`, `refreshStation` from `src/stations.ts`; all of `src/stations/draw.ts`; `api.getExpeditions`, `api.completeExpedition`, `api.collectExpedition`; `openRefineryDialog`, `openPurchaseDialog` from `src/ui.tsx`
- Produces:
  ```ts
  export const shipOverviewView: ViewDefinition   // id 'overview'
  export function setSolarRechargeRate(rate: number): void
  export const SHIP_HOLOGRAM = { src: 'assets/models/DaisyClass_Exterior.glb', scale: 0.012 }
  ```

- [ ] **Step 1: Create `src/stations/shipOverview.ts`**

```ts
// Ship station — Overview view (see references/ship-overview-concept.png).
// Top: fuel frame with refine/buy buttons, resources readout, ship hologram, Upgrades entry.
// Low: ship stats with bars, active missions with collect.
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { openRefineryDialog, openPurchaseDialog } from '../ui'
import { ViewDefinition, StationContext, Screens, TOP, refreshStation } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, hologram, WHITE, DIM, MUTED, GREEN } from './draw'

export const SHIP_HOLOGRAM = { src: 'assets/models/DaisyClass_Exterior.glb', scale: 0.012 }

let solarRechargeRate = 0
export function setSolarRechargeRate(rate: number): void { solarRechargeRate = rate }

// Cosmetic bar scaling for the stats panel (the concept shows bars; the API has no maxima).
const STAT_SCALE: Record<string, number> = { fuel_efficiency: 3, resource_storage: 500, specimen_vault: 50, expedition_speed: 3, hull_reinforcement: 1, pod_shielding: 1 }
const MISSIONS_PER_PAGE = 5

const topBag: Bag = []
const lowBag: Bag = []
const missionBag: Bag = []
let expeditions: any[] = []
let actionStatus: Record<string, string> = {}
let page = 0
let screens: Screens | null = null
let ctxRef: StationContext | null = null

function icons(name: string): string | undefined { return ICONS[name] }
// Glyph files (white on transparent, tinted in-scene). The first five are placeholders until real art lands.
const ICONS: Record<string, string | undefined> = {
  fuel: 'assets/icons/fuel-icon.png', upgrades: 'assets/icons/upgrades-icon.png', stats: 'assets/icons/stats-icon.png',
  missions: 'assets/icons/missions-icon.png', resources: 'assets/icons/resources-icon.png',
  refine: 'assets/icons/refinery-icon.png', buy: 'assets/icons/fuel-purchase-icon.png',
}

function cargoUsed(d: any): number { return (d?.inventory || []).reduce((s: number, r: any) => s + (r.quantity ?? 0), 0) }

function drawTop(top: Entity, ctx: StationContext): void {
  clearBag(topBag)
  const d = ctx.dashboard
  const ship = d?.ship
  frame(topBag, top, 0, 0, TOP.halfW * 2, TOP.halfH * 2)
  header(topBag, top, -2.6, 1.05, { title: 'SHIP OVERVIEW', subtitle: 'keep exploring' })
  // Resources readout, top right
  const used = cargoUsed(d), cap = ship?.resource_storage ?? 0
  text(topBag, top, 2.55, 1.15, 'RESOURCES', 0.3, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
  text(topBag, top, 2.55, 0.92, `${used} / ${cap}`, 0.5, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
  bar(topBag, top, 1.95, 0.72, 1.2, cap > 0 ? used / cap : 0, { h: 0.08 })

  // Fuel frame, left
  frame(topBag, top, -1.4, -0.35, 2.6, 1.85)
  header(topBag, top, -2.6, 0.3, { icon: icons('fuel'), title: 'FUEL', size: 0.7 })
  if (ship) {
    const pct = ship.fuel_capacity > 0 ? ship.fuel_current / ship.fuel_capacity : 0
    bar(topBag, top, -1.55, -0.15, 2.0, pct, { h: 0.2 })
    text(topBag, top, -0.15, -0.15, `${ship.fuel_current.toFixed(0)} / ${ship.fuel_capacity.toFixed(0)}`, 0.42, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
    if (solarRechargeRate > 0) text(topBag, top, -2.55, -0.45, `Solar Recharge: +${solarRechargeRate.toFixed(1)} fuel/hr`, 0.32, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  } else {
    text(topBag, top, -1.4, -0.15, 'Fuel data unavailable', 0.4, MUTED)
  }
  button(topBag, top, -2.0, -0.95, 1.15, 0.36, 'REFINE', 'Refine Fuel', () => openRefineryDialog(), { icon: icons('refine'), size: 0.34 })
  button(topBag, top, -0.75, -0.95, 1.15, 0.36, 'BUY FUEL', 'Purchase Fuel Cells', () => openPurchaseDialog(), { icon: icons('buy'), size: 0.34 })
  text(topBag, top, -2.55, -1.2, '"FURTHER SHORES AWAIT."  — THE UNFOUND', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_LEFT)

  // Ship frame, right: hologram + Upgrades entry
  frame(topBag, top, 1.4, -0.35, 2.6, 1.85)
  hologram(topBag, top, 0.9, -0.35, SHIP_HOLOGRAM.src, SHIP_HOLOGRAM.scale)
  button(topBag, top, 2.05, -0.35, 1.1, 0.42, 'UPGRADES »', 'Ship Systems', () => ctx.setView('systems'), { icon: icons('upgrades'), size: 0.34 })
  text(topBag, top, 2.6, -1.25, 'EXPLORE  //  UPGRADE  //  GO FURTHER', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
}

function drawStats(low: Entity, ctx: StationContext): void {
  const ship = ctx.dashboard?.ship
  frame(lowBag, low, -1.4, 0, 2.6, 2.3)
  header(lowBag, low, -2.6, 0.9, { icon: icons('stats'), title: 'SHIP STATS', size: 0.6 })
  if (!ship) { text(lowBag, low, -1.4, 0, 'Ship data unavailable', 0.4, MUTED); return }
  const rows: [string, string, number][] = [
    ['Fuel Efficiency', `${ship.fuel_efficiency.toFixed(1)}x`, ship.fuel_efficiency / STAT_SCALE.fuel_efficiency],
    ['Cargo Capacity', `${ship.resource_storage}`, ship.resource_storage / STAT_SCALE.resource_storage],
    ['Vault Capacity', `${ship.specimen_vault}`, ship.specimen_vault / STAT_SCALE.specimen_vault],
    ['Expedition Speed', `${ship.expedition_speed.toFixed(1)}x`, ship.expedition_speed / STAT_SCALE.expedition_speed],
    ['Blast Shielding', `${((ship.hull_reinforcement || 0) * 100).toFixed(0)}%`, (ship.hull_reinforcement || 0) / STAT_SCALE.hull_reinforcement],
    ['Env. Shielding', `${((ship.pod_shielding || 0) * 100).toFixed(0)}%`, (ship.pod_shielding || 0) / STAT_SCALE.pod_shielding],
  ]
  rows.forEach(([label, value, pct], i) => {
    const y = 0.5 - i * 0.28
    text(lowBag, low, -2.55, y, label, 0.34, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
    text(lowBag, low, -1.05, y, value, 0.34, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
    bar(lowBag, low, -0.5, y, 0.9, pct, { h: 0.1 })
  })
}

function drawMissions(): void {
  if (!screens || !ctxRef) return
  clearBag(missionBag)
  const low = screens.low
  frame(missionBag, low, 1.4, 0, 2.6, 2.3)
  const totalPages = Math.max(1, Math.ceil(expeditions.length / MISSIONS_PER_PAGE))
  if (page >= totalPages) page = totalPages - 1
  if (page < 0) page = 0
  header(missionBag, low, 0.2, 0.9, { icon: icons('missions'), title: totalPages > 1 ? `ACTIVE MISSIONS ${page + 1}/${totalPages}` : 'ACTIVE MISSIONS', size: 0.6 })
  if (expeditions.length === 0) {
    text(missionBag, low, 1.4, 0.05, 'No active missions', 0.42, WHITE)
    text(missionBag, low, 1.4, -0.25, 'CHART A COURSE. MAKE IT COUNT.', 0.26, MUTED)
    return
  }
  const start = page * MISSIONS_PER_PAGE
  expeditions.slice(start, start + MISSIONS_PER_PAGE).forEach((exp, i) => {
    const y = 0.5 - i * 0.3
    const isComplete = exp.status === 'completed' || (exp.completes_at && new Date(exp.completes_at).getTime() <= Date.now())
    const status = actionStatus[exp.id]
    let timeText: string
    if (status) timeText = status
    else if (isComplete) timeText = 'READY'
    else { const mins = Math.max(0, Math.ceil((new Date(exp.completes_at).getTime() - Date.now()) / 60000)); const hrs = Math.floor(mins / 60); timeText = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m` }
    const mining = exp.expedition_type === 'mining'
    text(missionBag, low, 0.25, y, mining ? 'Mining' : 'Exploration', 0.34, mining ? Color4.create(0.9, 0.7, 0.3, 1) : GREEN, TextAlignMode.TAM_MIDDLE_LEFT)
    text(missionBag, low, 1.75, y, timeText, 0.34, isComplete ? Color4.create(1, 1, 0.3, 1) : DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
    if (isComplete && !status) button(missionBag, low, 2.25, y, 0.75, 0.24, 'COLLECT', 'Complete Mission', () => collect(exp.id), { size: 0.26 })
  })
  if (page > 0) button(missionBag, low, 0.7, -1.0, 0.7, 0.22, '‹ PREV', 'Previous Page', () => { page--; drawMissions() }, { size: 0.24 })
  if (page < totalPages - 1) button(missionBag, low, 2.1, -1.0, 0.7, 0.22, 'NEXT ›', 'Next Page', () => { page++; drawMissions() }, { size: 0.24 })
}

async function collect(expeditionId: string): Promise<void> {
  const ctx = ctxRef
  if (!ctx) return
  actionStatus[expeditionId] = 'Processing...'
  drawMissions()
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
        } else if (result?.rewards) {
          const rt = Object.entries(result.rewards).filter(([k]) => k !== 'species_id').map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')
          ctx.notify(rt ? `Mining successful! ${rt}` : 'Mining complete!', Color4.create(0.9, 0.7, 0.3, 1))
        } else { ctx.notify('Collected!', Color4.create(0, 1, 0.5, 1)) }
        refreshStation('flora')
      } catch { ctx.notify('Already collected', Color4.create(0.7, 0.7, 0.7, 1)) }
    }
    delete actionStatus[expeditionId]
    await ctx.refresh()
  } catch (err: any) { actionStatus[expeditionId] = err.message || 'Failed'; drawMissions() }
}

export const shipOverviewView: ViewDefinition = {
  id: 'overview',
  async render(s: Screens, ctx: StationContext): Promise<void> {
    screens = s; ctxRef = ctx
    drawTop(s.top, ctx)
    drawStats(s.low, ctx)
    const exps = await api.getExpeditions()   // throws -> framework shows "Unable to load"
    expeditions = exps.filter((e: any) => e.status !== 'collected')
    drawMissions()
  },
  clear(): void { clearBag(topBag); clearBag(lowBag); clearBag(missionBag); screens = null },
}
```

- [ ] **Step 2: Put it on the east stub station in `src/index.ts`**

In the `east` config use `views: [shipOverviewView, stubView('systems')]` (the stub stands in for the Systems view until Task 3) and add:

```ts
import { shipOverviewView, setSolarRechargeRate } from './stations/shipOverview'
```

Drop `setSolarRechargeRate` from the `./shipDisplay` import on line 13 so the new one is used; the existing `if (currentSys) setSolarRechargeRate(...)` call on line 62 stays.

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check against `references/ship-overview-concept.png`**

East pair: top screen shows the header, the RESOURCES readout with bar, the FUEL frame with gauge, numbers, solar line, REFINE and BUY FUEL buttons, and the ship hologram slowly turning inside the right frame with an UPGRADES » button. Clicking REFINE opens the 2D refinery overlay; BUY FUEL opens the purchase overlay; UPGRADES switches to the stub. Low screen: six stats with bars on the left, missions on the right (or the empty state). If a mission is READY, COLLECT shows "Processing...", toasts, and the list and fuel redraw. If the hologram is too big or clips the frame, change `SHIP_HOLOGRAM.scale` (0.010 to 0.014) and note it in the commit.

- [ ] **Step 5: Commit**

```bash
git add src/stations/shipOverview.ts src/index.ts
git commit -m "Add ship Overview view: fuel, hologram, stats and missions"
```

---

### Task 3: Ship Systems view (upgrades)

**Files:**
- Create: `src/stations/shipSystems.ts`

**Interfaces:**
- Consumes: framework and draw exports as in Task 2; `SHIP_HOLOGRAM` from `./shipOverview`; `api.getAvailableUpgrades`, `api.applyUpgrade`; dashboard `inventory[]` rows `{ resource_type, quantity }`
- Produces: `export const shipSystemsView: ViewDefinition` (id `'systems'`)

- [ ] **Step 1: Create `src/stations/shipSystems.ts`**

```ts
// Ship station — Systems view (see references/ship-upgrades-concept.png).
// Top: upgrade cards in two columns around the ship hologram; click selects (magenta).
// Low: selected module, required resources with have/need and the UPGRADE button, system status bars.
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { ViewDefinition, StationContext, Screens, TOP, LOW } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, hologram, clickable, icon, CYAN, MAGENTA3, MAGENTA, WHITE, DIM, MUTED, GREEN, RED, GREEN3, RED3 } from './draw'
import { SHIP_HOLOGRAM } from './shipOverview'

const CATEGORY_LABELS: Record<string, string> = {
  fuel_tank: 'Fuel Tank', fuel_efficiency: 'Fuel Efficiency', cargo_hold: 'Cargo Hold', specimen_vault: 'Specimen Vault',
  mining_bay: 'Mining Bay', exploration_bay: 'Exploration Bay', expedition_speed: 'Expedition Speed',
  hull_reinforcement: 'Blast Shielding', pod_shielding: 'Env. Shielding', discovery_array: 'Discovery Array',
}
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  fuel_tank: 'Increases maximum fuel capacity.',
  fuel_efficiency: 'Reduces fuel burned per light-year.',
  cargo_hold: 'Expands resource storage.',
  specimen_vault: 'Adds specimen jar slots.',
  mining_bay: 'Adds a mining pod bay.',
  exploration_bay: 'Adds an exploration pod bay.',
  expedition_speed: 'Pods complete missions faster.',
  hull_reinforcement: 'Protects pods from blast damage.',
  pod_shielding: 'Protects pods from harsh environments.',
  discovery_array: 'Improves discovery range and odds.',
}
function labelFor(c: string): string { return CATEGORY_LABELS[c] || c.replace(/_/g, ' ').replace(/\b\w/g, (m: string) => m.toUpperCase()) }
function pretty(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }

const topBag: Bag = []
const lowBag: Bag = []
let upgrades: any[] = []
let selected: string | null = null
let installing = false
let screens: Screens | null = null
let ctxRef: StationContext | null = null

const CARD_W = 1.75, CARD_H = 0.5

function drawTop(): void {
  if (!screens || !ctxRef) return
  clearBag(topBag)
  const top = screens.top
  frame(topBag, top, 0, 0, TOP.halfW * 2, TOP.halfH * 2)
  header(topBag, top, -2.6, 1.05, { icon: 'assets/icons/systems-icon.png', title: 'SHIP SYSTEMS', subtitle: 'upgrade and maintain your vessel' })
  text(topBag, top, 2.6, 1.05, 'EXPLORATION  //  RESEARCH  //  DISCOVERY', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
  hologram(topBag, top, 0, -0.25, SHIP_HOLOGRAM.src, SHIP_HOLOGRAM.scale)
  text(topBag, top, 0, -1.25, '— A DEEPER UNIVERSE AWAITS —', 0.24, MUTED)
  if (upgrades.length === 0) { text(topBag, top, 0, -0.9, 'All upgrades maxed!', 0.45, DIM); return }
  upgrades.forEach((u, i) => {
    const col = i < 5 ? 0 : 1
    const row = i < 5 ? i : i - 5
    const x = col === 0 ? -1.85 : 1.85
    const y = 0.55 - row * (CARD_H + 0.08)
    const isSel = u.category === selected
    const f = frame(topBag, top, x, y, CARD_W, CARD_H, { border: isSel ? MAGENTA3 : undefined, borderWidth: isSel ? 0.03 : 0.02, fill: isSel ? Color4.create(0.15, 0.02, 0.12, 0.8) : undefined })
    text(topBag, top, x - CARD_W / 2 + 0.1, y + 0.08, `${labelFor(u.category)} T${u.tier}`, 0.34, isSel ? MAGENTA : WHITE, TextAlignMode.TAM_MIDDLE_LEFT)
    const costs = Object.entries(u.resourceCosts as Record<string, number>).map(([k, v]) => `${v} ${pretty(k)}`).join(', ')
    text(topBag, top, x - CARD_W / 2 + 0.1, y - 0.1, costs, 0.24, u.canAfford ? DIM : Color4.create(0.8, 0.4, 0.4, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    text(topBag, top, x + CARD_W / 2 - 0.1, y, '›', 0.5, isSel ? MAGENTA : CYAN, TextAlignMode.TAM_MIDDLE_RIGHT)
    clickable(f, `Select ${labelFor(u.category)}`, () => { selected = u.category; drawTop(); drawLow() })
  })
}

function drawLow(): void {
  if (!screens || !ctxRef) return
  clearBag(lowBag)
  const low = screens.low
  const ctx = ctxRef
  const u = upgrades.find(x => x.category === selected)

  // Selected module, left
  frame(lowBag, low, -1.85, 0.1, 1.75, 2.0)
  text(lowBag, low, -2.6, 1.0, 'SELECTED MODULE', 0.28, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  if (!u) {
    text(lowBag, low, -1.85, 0.1, upgrades.length ? 'Select a module above' : 'Nothing to upgrade', 0.38, MUTED)
  } else {
    text(lowBag, low, -2.6, 0.7, `${labelFor(u.category)} T${u.tier}`, 0.5, MAGENTA, TextAlignMode.TAM_MIDDLE_LEFT)
    text(lowBag, low, -2.6, 0.42, CATEGORY_DESCRIPTIONS[u.category] || '', 0.26, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
    const rows: [string, string][] = [['CURRENT LEVEL', u.tier > 1 ? `T${u.tier - 1}` : 'None'], ['NEXT LEVEL', `T${u.tier}`]]
    for (const [k, v] of Object.entries((u.statModifier || {}) as Record<string, any>)) rows.push([pretty(k).toUpperCase() + ' (NEXT)', `${v}`])
    rows.slice(0, 6).forEach(([k, v], i) => {
      const y = 0.1 - i * 0.22
      text(lowBag, low, -2.6, y, k, 0.24, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
      text(lowBag, low, -1.1, y, v, 0.26, i >= 2 ? GREEN : WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
    })
  }

  // Required resources + UPGRADE, middle
  frame(lowBag, low, 0, 0.1, 1.75, 2.0)
  text(lowBag, low, -0.75, 1.0, 'REQUIRED RESOURCES', 0.28, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  if (u) {
    const inv: any[] = ctx.dashboard?.inventory || []
    const have = (r: string) => inv.find(x => x.resource_type === r)?.quantity ?? 0
    Object.entries(u.resourceCosts as Record<string, number>).slice(0, 4).forEach(([r, need], i) => {
      const y = 0.65 - i * 0.3
      const ok = have(r) >= need
      frame(lowBag, low, 0, y, 1.55, 0.26, { border: ok ? undefined : RED3, fill: Color4.create(0.02, 0.05, 0.12, 0.8) })
      text(lowBag, low, -0.7, y, pretty(r), 0.28, WHITE, TextAlignMode.TAM_MIDDLE_LEFT)
      text(lowBag, low, 0.5, y, `${have(r)} / ${need}`, 0.28, ok ? GREEN : RED, TextAlignMode.TAM_MIDDLE_RIGHT)
      icon(lowBag, low, 0.62, y, 0.2, ok ? 'assets/icons/check-icon.png' : 'assets/icons/cross-icon.png', { color: ok ? GREEN3 : RED3 })
    })
    if (installing) button(lowBag, low, 0, -0.6, 1.55, 0.42, 'UPGRADING…', 'Upgrading', () => {}, { variant: 'disabled', size: 0.4 })
    else if (u.canAfford) button(lowBag, low, 0, -0.6, 1.55, 0.42, 'UPGRADE', `Upgrade ${labelFor(u.category)}`, () => install(u.category), { variant: 'primary', size: 0.44 })
    else button(lowBag, low, 0, -0.6, 1.55, 0.42, 'NEED RESOURCES', 'Insufficient resources', () => {}, { variant: 'disabled', size: 0.34 })
  }

  // System status, right
  frame(lowBag, low, 1.85, 0.1, 1.75, 2.0)
  text(lowBag, low, 1.1, 1.0, 'SYSTEM STATUS', 0.28, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  const ship = ctx.dashboard?.ship
  if (ship) {
    const cargoUsed = (ctx.dashboard?.inventory || []).reduce((s: number, r: any) => s + (r.quantity ?? 0), 0)
    const jars = (ctx.dashboard?.specimenSamples || []).length
    const rows: [string, number, string][] = [
      ['FUEL', ship.fuel_capacity ? ship.fuel_current / ship.fuel_capacity : 0, `${Math.round(ship.fuel_capacity ? ship.fuel_current / ship.fuel_capacity * 100 : 0)}%`],
      ['CARGO', ship.resource_storage ? cargoUsed / ship.resource_storage : 0, `${Math.round(ship.resource_storage ? cargoUsed / ship.resource_storage * 100 : 0)}%`],
      ['VAULT', ship.specimen_vault ? jars / ship.specimen_vault : 0, `${jars} / ${ship.specimen_vault}`],
      ['BLAST SHIELDING', ship.hull_reinforcement || 0, `${Math.round((ship.hull_reinforcement || 0) * 100)}%`],
      ['ENV. SHIELDING', ship.pod_shielding || 0, `${Math.round((ship.pod_shielding || 0) * 100)}%`],
    ]
    rows.forEach(([k, pct, v], i) => {
      const y = 0.65 - i * 0.3
      text(lowBag, low, 1.1, y + 0.08, k, 0.22, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
      text(lowBag, low, 2.6, y + 0.08, v, 0.24, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(lowBag, low, 1.85, y - 0.08, 1.5, pct, { h: 0.07 })
    })
  } else {
    text(lowBag, low, 1.85, 0.1, 'Ship data unavailable', 0.34, MUTED)
  }
  button(lowBag, low, -2.05, -1.05, 1.4, 0.24, '‹ BACK TO OVERVIEW', 'Back to Overview', () => ctx.setView('overview'), { size: 0.24 })
}

async function install(category: string): Promise<void> {
  const ctx = ctxRef
  if (!ctx || installing) return
  installing = true
  drawLow()
  try {
    await api.applyUpgrade(category)
    ctx.notify(`${labelFor(category)} upgraded!`, Color4.create(0, 1, 0.5, 1))
  } catch (err: any) {
    ctx.notify(err.message || 'Upgrade failed', Color4.create(1, 0.3, 0.3, 1))
  }
  installing = false
  await ctx.refresh()   // re-fetches dashboard and re-runs render(), which reloads upgrades
}

export const shipSystemsView: ViewDefinition = {
  id: 'systems',
  async render(s: Screens, ctx: StationContext): Promise<void> {
    screens = s; ctxRef = ctx
    upgrades = await api.getAvailableUpgrades()
    if (!upgrades.find(u => u.category === selected)) selected = upgrades[0]?.category ?? null
    drawTop()
    drawLow()
  },
  clear(): void { clearBag(topBag); clearBag(lowBag); screens = null },
}
```

Note: each upgrade card's fill entity is made clickable directly with `clickable()`; the card's own text sits at z -0.04, in front of the fill.

- [ ] **Step 2: Put it on the east stub station in `src/index.ts`**

`views: [shipOverviewView, shipSystemsView]` and import `shipSystemsView` from `./stations/shipSystems`. Remove the `stubView('systems')` entry.

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check against `references/ship-upgrades-concept.png`**

Click UPGRADES » on the Overview. Top: cards in two columns around the turning hologram, first card magenta. Click another card: it turns magenta, the low screen's SELECTED MODULE and REQUIRED RESOURCES follow. Rows show "have / need" with a green check or red cross glyph (blank until the real check/cross icons replace the placeholders). UPGRADE is bright only when affordable; do not click it unless you intend to spend the resources. SYSTEM STATUS shows five bars. ‹ BACK TO OVERVIEW returns and nothing from Systems remains. With no upgrades available the top shows "All upgrades maxed!".

- [ ] **Step 5: Commit**

```bash
git add src/stations/shipSystems.ts src/index.ts
git commit -m "Add ship Systems view: upgrade cards, module detail, required resources"
```

---

### Task 4: Flora collections top screen, Summary and Inventory views

**Files:**
- Create: `src/stations/floraCollections.ts` (shared top screen + Summary + Inventory views)

**Interfaces:**
- Consumes: framework and draw exports; dashboard `inventory[]`, `specimenSamples[]`, `ship.specimen_vault`, `ship.resource_storage`
- Produces:
  ```ts
  export function drawCollectionsTop(bag: Bag, top: Entity, ctx: StationContext, current: 'summary' | 'catalog' | 'vault' | 'inventory'): void
  export function setSpeciesCount(n: number): void
  export function getSpeciesCount(): number
  export const summaryView: ViewDefinition     // id 'summary'
  export const inventoryView: ViewDefinition   // id 'inventory'
  export const ICONS: { catalog: string; vault: string; resources?: string }
  ```

- [ ] **Step 1: Create `src/stations/floraCollections.ts`**

```ts
// Flora station — shared top screen (category tiles), Summary view and Inventory view
// (see references/flora-station-concept.png).
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { ViewDefinition, StationContext, Screens, TOP, LOW } from '../stations'
import { Bag, clearBag, text, frame, header, bar, tile, button, WHITE, DIM, MUTED, CYAN } from './draw'

export const ICONS: { catalog: string; vault: string; resources?: string } = {
  catalog: 'assets/icons/catalog-icon.png',
  vault: 'assets/icons/specimen-icon.png',
  resources: 'assets/icons/resources-icon.png',   // placeholder until real art lands
}

let speciesCount = 0
export function setSpeciesCount(n: number): void { speciesCount = n }
export function getSpeciesCount(): number { return speciesCount }

export type CollectionId = 'summary' | 'catalog' | 'vault' | 'inventory'

export function drawCollectionsTop(bag: Bag, top: Entity, ctx: StationContext, current: CollectionId): void {
  frame(bag, top, 0, 0, TOP.halfW * 2, TOP.halfH * 2)
  header(bag, top, -2.6, 1.05, { icon: ICONS.catalog, title: 'SHIP COLLECTIONS', subtitle: 'explore // study // preserve' })
  text(bag, top, 2.6, 1.12, '"ALL LIFE EXPANDS THE MAP."', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
  text(bag, top, 2.6, 0.92, '— THE UNFOUND', 0.22, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
  const tiles: [CollectionId, string, string, string | undefined][] = [
    ['catalog', 'Flora Catalog', 'discovered species', ICONS.catalog],
    ['vault', 'Specimen Vault', 'captured life forms', ICONS.vault],
    ['inventory', 'Resource Inventory', 'materials & resources', ICONS.resources],
  ]
  tiles.forEach(([id, title, subtitle, ic], i) => {
    tile(bag, top, -1.85 + i * 1.85, -0.25, 1.6, 1.5, { icon: ic, title, subtitle, selected: id === current, hover: title, onClick: () => ctx.setView(id) })
  })
  text(bag, top, 2.6, -1.25, 'SELECT A CATEGORY', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
}

function cargoUsed(d: any): number { return (d?.inventory || []).reduce((s: number, r: any) => s + (r.quantity ?? 0), 0) }
function pretty(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase()) }

// ---- Summary view: counters with bars ----
const summaryBag: Bag = []
export const summaryView: ViewDefinition = {
  id: 'summary',
  async render({ top, low }: Screens, ctx: StationContext): Promise<void> {
    drawCollectionsTop(summaryBag, top, ctx, 'summary')
    frame(summaryBag, low, 0, 0, LOW.halfW * 2, LOW.halfH * 2)
    header(summaryBag, low, -2.6, 0.9, { icon: ICONS.catalog, title: 'COLLECTIONS', subtitle: 'select a category above' })
    const d = ctx.dashboard
    if (!d) throw new Error('no dashboard')
    const jars = (d.specimenSamples || []).length
    const vault = d.ship?.specimen_vault ?? 0
    const used = cargoUsed(d), cap = d.ship?.resource_storage ?? 0
    const rows: [string, string, number][] = [
      ['SPECIES DISCOVERED', `${speciesCount}`, speciesCount > 0 ? 1 : 0],
      ['SPECIMEN JARS', `${jars} / ${vault}`, vault ? jars / vault : 0],
      ['CARGO HOLD', `${used} / ${cap}`, cap ? used / cap : 0],
    ]
    rows.forEach(([k, v, pct], i) => {
      const y = 0.3 - i * 0.5
      text(summaryBag, low, -2.5, y + 0.1, k, 0.3, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
      text(summaryBag, low, 2.5, y + 0.1, v, 0.4, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(summaryBag, low, 0, y - 0.15, 5.0, pct, { h: 0.1 })
    })
  },
  clear(): void { clearBag(summaryBag) },
}

// ---- Inventory view: resources with quantities and bars ----
const invBag: Bag = []
export const inventoryView: ViewDefinition = {
  id: 'inventory',
  async render({ top, low }: Screens, ctx: StationContext): Promise<void> {
    drawCollectionsTop(invBag, top, ctx, 'inventory')
    frame(invBag, low, 0, 0, LOW.halfW * 2, LOW.halfH * 2)
    header(invBag, low, -2.6, 0.9, { icon: ICONS.resources, title: 'RESOURCE INVENTORY', subtitle: 'materials & resources' })
    const d = ctx.dashboard
    if (!d) throw new Error('no dashboard')
    const used = cargoUsed(d), cap = d.ship?.resource_storage ?? 0
    text(invBag, low, 2.5, 0.98, `${used} / ${cap} UNITS`, 0.26, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
    bar(invBag, low, 1.9, 0.8, 1.2, cap ? used / cap : 0, { h: 0.06 })
    const rows: any[] = (d.inventory || []).filter((r: any) => (r.quantity ?? 0) > 0).sort((a: any, b: any) => (b.quantity ?? 0) - (a.quantity ?? 0))
    if (rows.length === 0) {
      text(invBag, low, 0, -0.1, 'Cargo hold is empty.', 0.42, WHITE)
      text(invBag, low, 0, -0.4, 'MINE ASTEROID BELTS TO GATHER RESOURCES.', 0.26, MUTED)
    }
    rows.slice(0, 12).forEach((r: any, i: number) => {
      const col = i < 6 ? 0 : 1
      const x = col === 0 ? -1.45 : 1.45
      const y = 0.45 - (i % 6) * 0.3
      text(invBag, low, x - 1.3, y + 0.06, pretty(r.resource_type), 0.3, WHITE, TextAlignMode.TAM_MIDDLE_LEFT)
      text(invBag, low, x + 1.3, y + 0.06, `${r.quantity}`, 0.3, CYAN, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(invBag, low, x, y - 0.1, 2.6, cap ? r.quantity / cap : 0, { h: 0.06 })
    })
    button(invBag, low, -1.85, -1.08, 1.5, 0.24, '‹ BACK TO COLLECTIONS', 'Back to Collections', () => ctx.setView('summary'), { size: 0.24 })
  },
  clear(): void { clearBag(invBag) },
}
```

- [ ] **Step 2: Wire into the west stub station in `src/index.ts`**

West config: `views: [summaryView, stubView('catalog'), stubView('vault'), inventoryView]` and import `summaryView, inventoryView` from `./stations/floraCollections`.

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check against `references/flora-station-concept.png`**

West top: SHIP COLLECTIONS header, quote, three tiles, none highlighted on Summary, footer. Low: three counters with bars. Click RESOURCE INVENTORY: the tile highlights and the low screen lists resources with bars (or the empty-cargo message); the quantities match the 2D refinery overlay's stock. ‹ BACK TO COLLECTIONS returns to Summary. Clicking FLORA CATALOG shows the stub for now.

- [ ] **Step 5: Commit**

```bash
git add src/stations/floraCollections.ts src/index.ts
git commit -m "Add flora collections top screen, Summary and Inventory views"
```

---

### Task 5: Catalog and Vault views

**Files:**
- Create: `src/stations/floraSpecies.ts` (shared list / image / details layout; both views)

**Interfaces:**
- Consumes: framework and draw exports; `drawCollectionsTop`, `setSpeciesCount`, `ICONS` from `./floraCollections`; `api.getCatalog`, `api.getCatalogDetail`; `selectBody` from `src/systemView.ts`
- Produces:
  ```ts
  export const catalogView: ViewDefinition   // id 'catalog'
  export const vaultView: ViewDefinition     // id 'vault'
  export function setFloraSelectCallback(cb: (flora: any) => void): void
  ```

- [ ] **Step 1: Create `src/stations/floraSpecies.ts`**

```ts
// Flora station — Catalog and Vault views: species list on the left, large image in the center,
// details on the right (see references/flora-station-concept.png).
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { selectBody } from '../systemView'
import { ViewDefinition, StationContext, Screens, LOW } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, listRow, image, WHITE, DIM, MUTED, CYAN, GREEN } from './draw'
import { drawCollectionsTop, setSpeciesCount, ICONS, CollectionId } from './floraCollections'

const RARITY_COLORS: Record<string, Color4> = {
  common: Color4.create(0.6, 0.6, 0.6, 1), uncommon: Color4.create(0.2, 0.8, 0.3, 1), rare: Color4.create(0.2, 0.5, 1, 1),
  epic: Color4.create(0.7, 0.3, 1, 1), legendary: Color4.create(1, 0.7, 0.1, 1), mythic: Color4.create(1, 0.3, 0.5, 1),
}
const PER_PAGE = 5

let onFloraSelect: ((flora: any) => void) | null = null
export function setFloraSelectCallback(cb: (flora: any) => void): void { onFloraSelect = cb }

let catalogData: any[] = []
const details: Record<string, any> = {}
function capitalize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

async function loadCatalog(): Promise<void> {
  const catalog = await api.getCatalog()
  catalogData = catalog.reverse()
  setSpeciesCount(catalogData.length)
}

// Keeps today's behaviour: the rest of the scene (2D detail panel, system view) hears the selection.
function announce(entry: any, detail: any, loading: boolean): void {
  selectBody(null)
  const d: Record<string, string> = {}
  d['Rarity'] = capitalize(entry.rarity || 'unknown')
  if (entry.count) d['Specimens'] = `${entry.count}`
  d['Location'] = entry.body_name || entry.planet_name || 'Unknown'
  d['System'] = entry.system_name || 'Unknown'
  if (loading) d['Traits'] = 'Loading...'
  else if (detail) {
    for (const k of ['atmosphere', 'temperature', 'gravity', 'moisture', 'radiation', 'soil']) if (detail[k]) d[capitalize(k)] = capitalize(detail[k])
    if (detail.discovered_by) d['Discovered By'] = detail.discovered_by
  }
  if (onFloraSelect) onFloraSelect({ type: 'flora', name: entry.name, id: entry.id, imageUrl: entry.image_url, details: d, canDeploy: false })
}

function makeSpeciesView(id: CollectionId, title: string, subtitle: string, icon: string | undefined, emptyText: string, getEntries: (ctx: StationContext) => Promise<any[]>, counter: (entries: any[], ctx: StationContext) => { label: string; pct: number }, showCount: boolean): ViewDefinition {
  const bag: Bag = []
  const paneBag: Bag = []
  let page = 0
  let selectedId: string | null = null
  let entries: any[] = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null

  function drawList(): void {
    if (!screens || !ctxRef) return
    clearBag(paneBag)
    const low = screens.low
    const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE))
    if (page >= totalPages) page = totalPages - 1
    if (page < 0) page = 0
    // Left: list
    frame(paneBag, low, -1.85, -0.15, 1.75, 1.75)
    if (entries.length === 0) {
      text(paneBag, low, -1.85, -0.15, emptyText, 0.3, MUTED)
    }
    entries.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).forEach((e, i) => {
      listRow(paneBag, low, -1.85, 0.5 - i * 0.34, 1.6, 0.3, { label: showCount ? `${e.name} (x${e.count})` : e.name, selected: e.id === selectedId, hover: e.name, onClick: () => select(e), imageSrc: e.image_url })
    })
    if (page > 0) button(paneBag, low, -2.3, -0.9, 0.7, 0.2, '‹ PREV', 'Previous Page', () => { page--; drawList() }, { size: 0.22 })
    if (page < totalPages - 1) button(paneBag, low, -1.4, -0.9, 0.7, 0.2, 'NEXT ›', 'Next Page', () => { page++; drawList() }, { size: 0.22 })
    // Center: image
    frame(paneBag, low, 0, -0.15, 1.6, 1.75)
    const sel = entries.find(e => e.id === selectedId)
    if (sel?.image_url) image(paneBag, low, 0, -0.1, 1.3, 1.3, sel.image_url)
    else text(paneBag, low, 0, -0.15, sel ? 'NO IMAGE' : '', 0.26, MUTED)
    // Right: details
    frame(paneBag, low, 1.85, -0.15, 1.75, 1.75)
    if (sel) {
      text(paneBag, low, 1.1, 0.55, sel.name.toUpperCase(), 0.4, CYAN, TextAlignMode.TAM_MIDDLE_LEFT)
      const det = details[sel.id]
      const rows: [string, string, Color4][] = [['Rarity', capitalize(sel.rarity || 'unknown'), RARITY_COLORS[sel.rarity] || WHITE]]
      if (sel.count) rows.push(['Specimens', `${sel.count}`, WHITE])
      rows.push(['Location', sel.body_name || sel.planet_name || 'Unknown', WHITE])
      rows.push(['System', sel.system_name || 'Unknown', WHITE])
      if (det === undefined) rows.push(['Traits', 'Loading...', DIM])
      else if (det) for (const k of ['atmosphere', 'temperature', 'gravity', 'moisture', 'radiation', 'soil']) if (det[k]) rows.push([capitalize(k), capitalize(det[k]), GREEN])
      rows.slice(0, 8).forEach(([k, v, c], i) => {
        const y = 0.25 - i * 0.2
        text(paneBag, low, 1.1, y, k, 0.24, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
        text(paneBag, low, 2.6, y, v, 0.24, c, TextAlignMode.TAM_MIDDLE_RIGHT)
      })
    } else {
      text(paneBag, low, 1.85, -0.15, entries.length ? 'Select a species' : '', 0.28, MUTED)
    }
  }

  async function select(entry: any): Promise<void> {
    selectedId = entry.id
    drawList()
    announce(entry, details[entry.id], details[entry.id] === undefined)
    if (details[entry.id] === undefined) {
      try { details[entry.id] = await api.getCatalogDetail(entry.id) } catch { details[entry.id] = null }
      if (selectedId === entry.id) { drawList(); announce(entry, details[entry.id], false) }
    }
  }

  return {
    id,
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s; ctxRef = ctx
      drawCollectionsTop(bag, s.top, ctx, id)
      frame(bag, s.low, 0, 0, LOW.halfW * 2, LOW.halfH * 2)
      header(bag, s.low, -2.6, 0.95, { icon, title, subtitle })
      entries = await getEntries(ctx)
      const c = counter(entries, ctx)
      text(bag, s.low, 2.5, 1.02, c.label.toUpperCase(), 0.24, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(bag, s.low, 1.9, 0.86, 1.2, c.pct, { h: 0.06 })
      button(bag, s.low, -1.85, -1.08, 1.5, 0.24, '‹ BACK TO COLLECTIONS', 'Back to Collections', () => ctx.setView('summary'), { size: 0.24 })
      text(bag, s.low, 2.6, -1.08, 'EXPLORE  //  STUDY  //  PRESERVE', 0.22, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
      if (!entries.find(e => e.id === selectedId)) selectedId = entries[0]?.id ?? null
      drawList()
    },
    clear(): void { clearBag(bag); clearBag(paneBag); screens = null },
  }
}

export const catalogView = makeSpeciesView('catalog', 'FLORA CATALOG', 'plants & botanical data', ICONS.catalog,
  'No species discovered yet.\nExplore life-bearing planets\nto discover alien flora!',
  async () => { await loadCatalog(); return catalogData },
  (entries) => ({ label: `${entries.length} species discovered`, pct: entries.length > 0 ? 1 : 0 }), false)

export const vaultView = makeSpeciesView('vault', 'SPECIMEN VAULT', 'captured life forms', ICONS.vault,
  'No specimens in vault.\nComplete exploration expeditions\nto collect samples!',
  async (ctx) => {
    if (catalogData.length === 0) await loadCatalog()
    if (!ctx.dashboard) throw new Error('no dashboard')
    const samples: any[] = ctx.dashboard.specimenSamples || []
    const counts: Record<string, number> = {}
    for (const s of samples) counts[s.species_id] = (counts[s.species_id] || 0) + 1
    return Object.entries(counts).map(([speciesId, count]) => {
      const c = catalogData.find(e => e.id === speciesId)
      return { id: speciesId, name: c?.name || 'Unknown Species', rarity: c?.rarity || 'common', image_url: c?.image_url || null, count, body_name: c?.body_name, system_name: c?.system_name }
    })
  },
  (_entries, ctx) => {
    const jars = (ctx.dashboard?.specimenSamples || []).length
    const cap = ctx.dashboard?.ship?.specimen_vault ?? 0
    return { label: `${jars} / ${cap} jars`, pct: cap ? jars / cap : 0 }
  }, true)
```

- [ ] **Step 2: Wire into the west stub station in `src/index.ts`**

West config: `views: [summaryView, catalogView, vaultView, inventoryView]`. Replace the `setFloraSelectCallback` import from `./catalogPanel` with one from `./stations/floraSpecies` and import `catalogView, vaultView` from the same module. Keep the existing `setFloraSelectCallback((flora) => { clearSelectedFlora(); setSelectedFlora(flora) })` call.

- [ ] **Step 3: Build**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2`
Expected: `Type checking completed without errors`

- [ ] **Step 4: Preview check against `references/flora-station-concept.png`**

Click FLORA CATALOG: the low screen shows the list with thumbnails on the left (first row selected), the large image in the center, and name plus details on the right, with traits filling in after a moment. The 2D flora detail panel still opens as it did before. Click another row: image and details follow. If a species has no image the row lists, the center says NO IMAGE, details still show. SPECIMEN VAULT shows grouped entries with (xN) and the jars counter. Species count on Summary now matches the catalog. Page through if more than five. Images must not be mirrored; if they are, flip `IMAGE_ROT` in `draw.ts` and re-check the icons.

- [ ] **Step 5: Commit**

```bash
git add src/stations/floraSpecies.ts src/index.ts
git commit -m "Add flora Catalog and Vault views"
```

---

### Task 6: Final wiring, remove the old panels, deploy

**Files:**
- Modify: `src/index.ts` (replace stub code; final station configs)
- Modify: `src/ui.tsx:13` and `src/ui.tsx:94`
- Delete: `src/shipDisplay.ts`, `src/upgradesPanel.ts`, `src/catalogPanel.ts`

- [ ] **Step 1: Replace the stub block and old panel wiring in `src/index.ts`**

Remove the imports of `./shipDisplay`, `./upgradesPanel`, `./catalogPanel`, and the draw-helper imports that only the stubs used (`Bag, clearBag, text, frame, header, bar, button, tile, listRow, CYAN, DIM, MUTED`, `ViewDefinition`, `TextAlignMode` if nothing else uses it). Remove the `setMissionNotifyCallback` / `setOpenRefineryCallback` / `setOpenPurchaseCallback` / `createShipDisplay()` lines, the `setUpgradeNotifyCallback` / `createUpgradesPanel()` lines, the `createCatalogPanel()` call, and the whole TEMP stub block. Keep `setCloseDetailCallback` and `setFloraSelectCallback` calls. Where the TEMP block was, add:

```ts
    const currentSys = systems.find(s => s.id === playerInfo!.current_system_id)
    if (currentSys) setSolarRechargeRate(currentSys.solar_recharge_rate)

    const floraStation = createStation({
      id: 'flora',
      position: Vector3.create(117.2, DECK_Y, 121.3),
      yaw: -32 + 90,
      views: [summaryView, catalogView, vaultView, inventoryView],
      notify: showNotification,
    })
    const shipStation = createStation({
      id: 'ship',
      position: Vector3.create(128 + (128 - 117.2), DECK_Y, 121.3),
      yaw: -(-32 + 90),
      views: [shipOverviewView, shipSystemsView],
      notify: showNotification,
    })
    await Promise.all([floraStation.refresh(), shipStation.refresh()])
```

Final station-related imports at the top of `src/index.ts`:

```ts
import { createStation } from './stations'
import { shipOverviewView, setSolarRechargeRate } from './stations/shipOverview'
import { shipSystemsView } from './stations/shipSystems'
import { summaryView, inventoryView } from './stations/floraCollections'
import { catalogView, vaultView, setFloraSelectCallback } from './stations/floraSpecies'
import { DECK_Y } from './environment'
```

`createEnvironment, respawnSystem, twinkleSystem` stay imported from `./environment` alongside `DECK_Y`. Remove the earlier duplicate `const currentSys = ...` / `setSolarRechargeRate(...)` lines from the old block so the call appears once.

- [ ] **Step 2: Update `src/ui.tsx`**

Line 13: replace `import { refreshMissions, createShipDisplay } from './shipDisplay'` with `import { refreshStation } from './stations'`.
Line 94: replace `refreshMissions()` with `refreshStation('ship')`.
Search the file for any remaining `createShipDisplay(` (the refinery/purchase overlays refresh the ship display after a successful action) and replace each with `refreshStation('ship')`.

- [ ] **Step 3: Delete the old modules**

```bash
git rm src/shipDisplay.ts src/upgradesPanel.ts src/catalogPanel.ts
```

- [ ] **Step 4: Build and grep for stragglers**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run build 2>&1 | tail -2 && grep -rn "shipDisplay\|upgradesPanel\|catalogPanel\|refreshMissions\|refreshCatalog\|stubView" src/ || echo "no stragglers"`
Expected: `Type checking completed without errors` and `no stragglers`

- [ ] **Step 5: Full preview walkthrough (spec verification list)**

1. The floating fuel/missions display behind the galaxy controls is gone; the galaxy control panel and its desk are unchanged and still work.
2. The east-wall upgrades panel and the floating catalog panel are gone.
3. Ship station against both ship concepts: Overview and Systems render; REFINE and BUY FUEL open their overlays; closing the refinery overlay after a refine updates the fuel readout; UPGRADES » and ‹ BACK TO OVERVIEW switch cleanly.
4. Flora station against its concept: Summary, Catalog, Vault, Inventory all render; selecting a species opens its detail and the galaxy view responds.
5. Deploy a pod from the galaxy view: the Overview's missions list picks it up.
6. Walk away 15m and back: nothing has moved.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/ui.tsx
git commit -m "Wire ship and flora stations; remove the old floating panels"
```

- [ ] **Step 7: Deploy to the world**

Run: `source ~/.nvm/nvm.sh && nvm use 20 >/dev/null && npm run deploy -- --target-content https://worlds-content-server.decentraland.org`
Sign in the browser with the `0x7e56…374c` wallet. Expected log line: `Content uploaded successfully`. Then load `https://play.decentraland.org/?realm=metapetal.dcl.eth&position=0,0` and repeat items 3 and 4 of Step 5.
