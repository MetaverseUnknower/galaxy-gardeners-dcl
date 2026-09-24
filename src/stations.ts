// Galaxy Gardeners — Station framework
// A station is a tall desk (top screen) plus a low desk (low screen). Screen roots are children of
// the desk entities, so views draw in screen coordinates and move with the desks. A view renders
// both screens; the station owns view switching and the shared dashboard fetch.
import { engine, Entity, Transform, GltfContainer } from '@dcl/sdk/ecs'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { Bag, clearBag, text, spinner, RED } from './stations/draw'

export interface StationContext {
  dashboard: any | null
  notify(text: string, color: Color4): void
  refresh(): Promise<void>
  setView(id: string): Promise<void>
  /** Shows the station's loading indicator while `work` is pending; returns its result. */
  busy<T>(work: Promise<T>): Promise<T>
}
export interface Screens { top: Entity; low: Entity }
/** A view object holds its own drawing state and may be used by only one station. */
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
  const loadingBag: Bag = []
  let loadingDepth = 0
  // Spinner in the top screen's corner while anything is in flight. Nested callers share one ring.
  function setLoading(on: boolean): void {
    loadingDepth = Math.max(0, loadingDepth + (on ? 1 : -1))
    if (on && loadingDepth === 1) spinner(loadingBag, top, TOP.halfW - 0.25, TOP.halfH - 0.22, 0.22)
    if (!on && loadingDepth === 0) clearBag(loadingBag)
  }
  let active: ViewDefinition = config.views[0]
  let dashboard: any | null = null

  const ctx: StationContext = {
    get dashboard() { return dashboard },
    notify: config.notify,
    refresh: () => station.refresh(),
    setView: (id: string) => station.setView(id),
    busy: async <T>(work: Promise<T>): Promise<T> => { setLoading(true); try { return await work } finally { setLoading(false) } },
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

  let busy = false
  let queued = false
  let pendingView: ViewDefinition | null = null
  let needFetch = false

  // Serialises draws. A request that arrives mid-draw is folded into one more pass at the end,
  // so the last requested view and the latest data always win and nothing is drawn twice.
  async function pump(): Promise<void> {
    if (busy) { queued = true; return }
    busy = true
    setLoading(true)
    try {
      do {
        queued = false
        if (pendingView && pendingView !== active) { clearAll(); active = pendingView }
        pendingView = null
        if (needFetch) { needFetch = false; try { dashboard = await api.getShipDashboard() } catch { /* keep last dashboard */ } }
        await draw()
      } while (queued)
    } finally { busy = false; setLoading(false) }
  }

  const station: Station = {
    id: config.id,
    currentView: () => active.id,
    async setView(id: string) {
      const v = config.views.find(x => x.id === id)
      if (!v) return
      pendingView = v
      needFetch = true
      await pump()
    },
    async refresh() {
      needFetch = true
      await pump()
    },
    destroy() {
      clearAll(); clearBag(loadingBag)
      for (const e of [top, low, tallDesk, lowDesk]) engine.removeEntity(e)
      stations.delete(config.id)
    },
  }
  stations.set(config.id, station)
  return station
}
