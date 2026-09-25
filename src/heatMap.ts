// Social heat map: a glowing halo and head-count over every system with players active in the last 24 hours.
// Toggled from the Stellar Navigation console in galaxy view; the choice is remembered per player.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextShape, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import * as api from './api'
import { getPref, setPref } from './prefs'
import { starEntities, getGalaxyRoot, getViewMode, setMapRenderHooks } from './galaxyMap'

const PREF_KEY = 'heatMap'
const REFRESH_SECONDS = 60

let galaxyId: string | null = null
let counts = new Map<string, number>()
let total = 0
let entities: Entity[] = []
let sinceFetch = 0
let listener: (() => void) | null = null

export function isHeatMapOn(): boolean { return getPref<boolean>(PREF_KEY, false) }
export function heatMapTotal(): number { return total }
export function setHeatMapChangedListener(fn: (() => void) | null): void { listener = fn }

export function setupHeatMap(id: string): void {
  galaxyId = id
  setMapRenderHooks({ rendered: renderHeatMap, cleared: clearHeatMap })
  engine.addSystem(heatMapSystem)
  if (isHeatMapOn()) void fetchPopulation()
}

export async function toggleHeatMap(): Promise<void> {
  const on = !isHeatMapOn()
  setPref(PREF_KEY, on)
  if (on) await fetchPopulation()
  else clearHeatMap()
  listener?.()
}

async function fetchPopulation(): Promise<void> {
  if (!galaxyId) return
  sinceFetch = 0
  try {
    const res = await api.getSystemPopulation(galaxyId)
    counts = new Map(res.systems.map(s => [s.systemId, s.players]))
    total = res.systems.reduce((sum, s) => sum + s.players, 0)
  } catch { /* keep the last counts */ }
  renderHeatMap()
  listener?.()
}

/** Cyan for a lone explorer, through magenta, to orange for a crowd of ten or more. */
function heatColor(n: number): Color3 {
  const t = Math.min(1, (n - 1) / 9)
  const lerp = (a: number, b: number, u: number) => a + (b - a) * u
  if (t < 0.5) { const u = t / 0.5; return Color3.create(lerp(0, 1, u), lerp(0.9, 0.2, u), lerp(1, 0.8, u)) }
  const u = (t - 0.5) / 0.5
  return Color3.create(1, lerp(0.2, 0.55, u), lerp(0.8, 0.1, u))
}

export function clearHeatMap(): void {
  for (const e of entities) engine.removeEntity(e)
  entities = []
}

export function renderHeatMap(): void {
  clearHeatMap()
  if (!isHeatMapOn() || getViewMode() !== 'galaxy' || counts.size === 0) return
  const root = getGalaxyRoot()
  for (const [star, system] of starEntities) {
    const n = counts.get(system.id)
    if (!n) continue
    const pos = Transform.get(star).position
    const c = heatColor(n)
    const size = Math.min(1.3, 0.35 + 0.18 * Math.sqrt(n))

    const halo = engine.addEntity()
    Transform.create(halo, { position: pos, scale: Vector3.create(size, size, size), parent: root })
    MeshRenderer.setSphere(halo)
    Material.setPbrMaterial(halo, { albedoColor: Color4.create(c.r, c.g, c.b, 0.22), emissiveColor: c, emissiveIntensity: 2.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
    entities.push(halo)

    const label = engine.addEntity()
    Transform.create(label, { position: Vector3.create(pos.x, pos.y + size * 0.5 + 0.18, pos.z), parent: root })
    TextShape.create(label, { text: `${n}`, fontSize: 2.2, textColor: Color4.create(c.r, c.g, c.b, 1), outlineWidth: 0.15, outlineColor: Color3.Black() })
    Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
    entities.push(label)
  }
}

function heatMapSystem(dt: number): void {
  if (!isHeatMapOn()) return
  sinceFetch += dt
  if (sinceFetch >= REFRESH_SECONDS) void fetchPopulation()
}
