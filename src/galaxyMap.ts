import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, ColliderLayer, TextureWrapMode, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion, Vector2 } from '@dcl/sdk/math'
import { wormholeOpen } from './wormhole/blackHole'
import { StarSystem } from './types'
import { getSystemRoot, getSystemAutoScale, isViewingRemoteSystem } from './systemView'
import { DECK_Y } from './environment'
import { PROJECTOR_TOP_Y } from './environment'
import { getPref, setPref } from './prefs'
import { systemProgress, onSystemProgressChanged } from './systemProgress'

const FLOOR_Y = 40
const MAP_CENTER = Vector3.create(128, FLOOR_Y + 1, 128)
const MAP_RADIUS = 6.0
const PROJECTOR_RADIUS = 1.5

// Control state
let galaxyRoot: Entity | null = null
let currentScale = 1.0
let currentHeight = FLOOR_Y + 1.2
let currentRotationY = 0
let targetRotationY = 0
const ANIM_SPEED = 4.0
const ROTATE_STEP = 15
// Height and zoom are whole-number levels so every step is exact (no drift, no uneven end steps).
const MIN_HEIGHT = FLOOR_Y + 0.3
const HEIGHT_STEP = 0.3
const HEIGHT_LEVELS = 17            // levels 0..16 → 0.3m .. 5.1m above the floor
const MIN_SCALE = 0.4
const SCALE_STEP = 0.2
const SCALE_LEVELS = 9              // levels 0..8 → zoom 0.4 .. 2.0
const LOW_HEIGHT_LEVELS = 3         // the three lowest heights…
const LOW_SCALE_LEVELS = 3          // …may only use the three smallest zooms; above them, zoom freely
const DEFAULT_HEIGHT_LEVEL = LOW_HEIGHT_LEVELS   // the first unrestricted height (1.2m)
const DEFAULT_SCALE_LEVEL = 3                    // zoom 1.0
let heightLevel = DEFAULT_HEIGHT_LEVEL
let scaleLevel = DEFAULT_SCALE_LEVEL
const heightFor = (l: number) => MIN_HEIGHT + l * HEIGHT_STEP
const scaleFor = (l: number) => MIN_SCALE + l * SCALE_STEP
let targetScale = scaleFor(DEFAULT_SCALE_LEVEL)
let targetHeight = heightFor(DEFAULT_HEIGHT_LEVEL)

export const starEntities: Map<Entity, StarSystem> = new Map()
const zoneRingEntities: Entity[] = []
const nebulaEntities: Entity[] = []
let currentLocationMarker: Entity | null = null
let markerRotation = 0
let beamEntity: Entity | null = null
let beamOuterEntity: Entity | null = null   // second, slightly wider hologram layer
let beamTime = 0
let surveyBlend = 0   // 0 cyan (the ship's own system or the galaxy) → 1 green (a survey of a visited system)
const NEBULA_EXTENT = MAP_RADIUS * 1.5
// Hologram beam texture (a 1024 copy of assets/images/hologram.png; the original is kept as supplied).
const HOLO_TEXTURE = 'assets/images/hologram-1024.png'
// Two faint layers turning in opposite directions and rising at different speeds, so the streaks drift past each other.
const HOLO_OUTER_SCALE = 1.06
// The texture masks the glow down to its streaks; until it has loaded the whole cone would glow white. The
// explorer gives no texture-loaded signal, so the beam stays fully transparent (texture already requested, so it
// loads meanwhile) for a warm-up period, then fades in.
const HOLO_WARMUP_SECONDS = 8
const HOLO_FADE_IN_SECONDS = 3
// Spin is a real rotation of each cone (degrees per second): the explorer does not animate texture offsets.
const HOLO_LAYERS = [
  { tiling: Vector2.create(2, 1), spin: 1.5, alpha: 0.16, glow: 0.7 },     // inner: one turn every 4 minutes
  { tiling: Vector2.create(3, 1.4), spin: -2.2, alpha: 0.11, glow: 0.55 }, // outer: the other way, a little faster
]

// View mode
export type ViewMode = 'galaxy' | 'system'
let currentViewMode: ViewMode = 'galaxy'
let onViewModeChange: ((mode: ViewMode) => any) | null = null

// Transition animation
type TransitionPhase = 'idle' | 'shrinking' | 'swapping' | 'expanding'
let transitionPhase: TransitionPhase = 'idle'
let transitionScale = 1.0
let pendingMode: ViewMode | null = null
const TRANSITION_SPEED = 4.0

export function getViewMode(): ViewMode {
  return currentViewMode
}

export function setViewModeCallback(callback: (mode: ViewMode) => any): void {
  onViewModeChange = callback
}

let canSwitchToSystem: (() => boolean) | null = null

export function setCanSwitchCheck(check: () => boolean): void {
  canSwitchToSystem = check
}

let onViewModeChanged: (() => void) | null = null
/** Called after a view switch completes (the console redraws its tabs). */
export function setViewModeChangedListener(cb: () => void): void { onViewModeChanged = cb }
/** True when the Star System view may be entered right now (false while in transit). */
export function canSwitchToSystemView(): boolean { return canSwitchToSystem ? canSwitchToSystem() : true }

// Map controls (used by the navigation console)
// At the three lowest heights the map may only use the three smallest zoom levels, so lowering it toward the
// console shrinks it to fit rather than swallowing the desk. Above that, height and zoom are independent.
function maxScaleLevelFor(h: number): number { return h < LOW_HEIGHT_LEVELS ? LOW_SCALE_LEVELS - 1 : SCALE_LEVELS - 1 }
function applyLevels(): void {
  heightLevel = Math.max(0, Math.min(HEIGHT_LEVELS - 1, heightLevel))
  scaleLevel = Math.max(0, Math.min(maxScaleLevelFor(heightLevel), scaleLevel))
  targetHeight = heightFor(heightLevel)
  targetScale = scaleFor(scaleLevel)
}

export function rotateMap(dir: 1 | -1): void { targetRotationY += dir * ROTATE_STEP; mapViewChanged() }
export function tiltMap(dir: 1 | -1): void { heightLevel += dir; applyLevels(); mapViewChanged() }
export function zoomMap(dir: 1 | -1): void { scaleLevel += dir; applyLevels(); mapViewChanged() }
export function resetMapView(): void { targetRotationY = 0; heightLevel = DEFAULT_HEIGHT_LEVEL; scaleLevel = DEFAULT_SCALE_LEVEL; applyLevels(); mapViewChanged() }

// The player's map view (height, zoom, rotation) is remembered in their preferences. Presses come in bursts,
// so it is saved once the view has been still for a moment rather than on every press.
const MAP_VIEW_SAVE_DELAY = 1.5
let mapViewSaveIn = -1
function mapViewChanged(): void { mapViewSaveIn = MAP_VIEW_SAVE_DELAY }
function saveMapView(): void {
  setPref('mapHeightLevel', heightLevel)
  setPref('mapScaleLevel', scaleLevel)
  setPref('mapRotation', ((targetRotationY % 360) + 360) % 360)
}
engine.addSystem((dt: number) => {
  if (mapViewSaveIn < 0) return
  mapViewSaveIn -= dt
  if (mapViewSaveIn < 0) saveMapView()
})

/** Restores the saved view after preferences load; snaps straight to it instead of animating. */
export function restoreMapView(): void {
  heightLevel = getPref<number>('mapHeightLevel', DEFAULT_HEIGHT_LEVEL)
  scaleLevel = getPref<number>('mapScaleLevel', DEFAULT_SCALE_LEVEL)
  targetRotationY = getPref<number>('mapRotation', 0)
  applyLevels()
  currentHeight = targetHeight
  currentScale = targetScale
  currentRotationY = targetRotationY
  applyGalaxyTransform()
}
export function getMapView(): { height: number; scale: number } { return { height: targetHeight, scale: targetScale } }
export function setMapView(view: { height?: number; scale?: number }): void {
  if (view.height !== undefined) heightLevel = Math.round((view.height - MIN_HEIGHT) / HEIGHT_STEP)
  if (view.scale !== undefined) scaleLevel = Math.round((view.scale - MIN_SCALE) / SCALE_STEP)
  applyLevels()
}
export const MAP_LOWEST_HEIGHT = MIN_HEIGHT

export function switchViewMode(mode: ViewMode): void {
  if (mode === currentViewMode || transitionPhase !== 'idle') return
  if (mode === 'system' && canSwitchToSystem && !canSwitchToSystem()) return
  pendingMode = mode
  transitionPhase = 'shrinking'
}

// Simple seeded random
let seed = 42
function seededRandom(): number {
  seed = (seed * 16807 + 0) % 2147483647
  return (seed - 1) / 2147483646
}

export function getGalaxyRoot(): Entity {
  return createGalaxyRoot()
}

function createGalaxyRoot(): Entity {
  if (galaxyRoot) return galaxyRoot
  galaxyRoot = engine.addEntity()
  const s = currentScale * transitionScale
  Transform.create(galaxyRoot, {
    position: Vector3.create(MAP_CENTER.x, currentHeight, MAP_CENTER.z),
    scale: Vector3.create(s, s, s),
    rotation: Quaternion.fromEulerDegrees(0, currentRotationY, 0)
  })
  return galaxyRoot
}

function applyGalaxyTransform(): void {
  const activeRoot = currentViewMode === 'system' ? getSystemRoot() : galaxyRoot
  const autoScale = currentViewMode === 'system' ? getSystemAutoScale() : 1.0
  const s = currentScale * transitionScale * autoScale
  if (activeRoot) {
    const transform = Transform.getMutable(activeRoot)
    transform.position = Vector3.create(MAP_CENTER.x, currentHeight, MAP_CENTER.z)
    transform.scale = Vector3.create(s, s, s)
    transform.rotation = Quaternion.fromEulerDegrees(0, currentRotationY, 0)
  }
  updateBeamShape()
}

function updateBeamShape(): void {
  if (!beamEntity) return
  const topRadius = NEBULA_EXTENT * currentScale * transitionScale
  const beamHeight = Math.max(0.01, (currentHeight - PROJECTOR_TOP_Y) * transitionScale)
  // The cone's shape (bottom vs top radius) only changes with zoom, so the mesh is rebuilt only when the top radius
  // moves visibly; the transition's shrink and grow is a scale (ts on the mesh radii x ts on the transform = ts²,
  // as before), so it no longer rebuilds two meshes every frame.
  const ts = transitionScale
  const unscaledTop = ts > 0.001 ? topRadius / ts : beamTopRadius
  const transform = Transform.getMutable(beamEntity)
  transform.position = Vector3.create(MAP_CENTER.x, PROJECTOR_TOP_Y + beamHeight / 2, MAP_CENTER.z)
  transform.scale = Vector3.create(ts * ts, beamHeight, ts * ts)
  const remesh = Math.abs(unscaledTop - beamTopRadius) > 0.02
  if (remesh) {
    beamTopRadius = unscaledTop
    MeshRenderer.setCylinder(beamEntity, PROJECTOR_RADIUS, beamTopRadius)
  }
  if (beamOuterEntity) {
    const outer = Transform.getMutable(beamOuterEntity)
    outer.position = transform.position
    outer.scale = transform.scale
    if (remesh) MeshRenderer.setCylinder(beamOuterEntity, PROJECTOR_RADIUS * HOLO_OUTER_SCALE, beamTopRadius * HOLO_OUTER_SCALE)
  }
}
let beamTopRadius = -1   // the top radius the beam meshes were last built with (before the transition scale)
let beamMaterialKey = ''  // the stepped look the beam materials were last written with

export function createProjectorBase(): void {
  // The projector itself is the interior model's dais plus galaxy_projector_base.glb; only the beam is drawn here.
  // Cone beam
  beamEntity = engine.addEntity()
  const beamHeight = MAP_CENTER.y - PROJECTOR_TOP_Y
  Transform.create(beamEntity, {
    position: Vector3.create(MAP_CENTER.x, PROJECTOR_TOP_Y + beamHeight / 2, MAP_CENTER.z),
    scale: Vector3.create(1, beamHeight, 1)
  })
  MeshRenderer.setCylinder(beamEntity, PROJECTOR_RADIUS, NEBULA_EXTENT * currentScale)
  Material.setPbrMaterial(beamEntity, {
    albedoColor: Color4.create(0, 0, 0, 0),
    emissiveColor: Color3.Black(),
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  beamOuterEntity = engine.addEntity()
  Transform.create(beamOuterEntity, {
    position: Vector3.create(MAP_CENTER.x, PROJECTOR_TOP_Y + beamHeight / 2, MAP_CENTER.z),
    scale: Vector3.create(1, beamHeight, 1)
  })
  MeshRenderer.setCylinder(beamOuterEntity, PROJECTOR_RADIUS * HOLO_OUTER_SCALE, NEBULA_EXTENT * currentScale * HOLO_OUTER_SCALE)
  // Invisible until the animation fades it in (a mesh with no material would render plain white meanwhile).
  Material.setPbrMaterial(beamOuterEntity, { albedoColor: Color4.create(0, 0, 0, 0), emissiveColor: Color3.Black(), transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
}

function createNebula(): void {
  seed = 42
  const root = createGalaxyRoot()
  const armCount = 5
  const particleCount = 800
  const maxR = MAP_RADIUS * 1.5

  const bands = [
    { color: Color4.create(1, 0.85, 0.45, 0.5), emissive: Color3.create(1, 0.85, 0.45), intensity: 2.7, size: 0.04 },
    { color: Color4.create(0.7, 0.45, 0.2, 0.45), emissive: Color3.create(0.7, 0.45, 0.2), intensity: 1.8, size: 0.03 },
    { color: Color4.create(0.3, 0.65, 0.8, 0.5), emissive: Color3.create(0.3, 0.65, 0.8), intensity: 2.2, size: 0.035 },
    { color: Color4.create(0.55, 0.3, 0.75, 0.45), emissive: Color3.create(0.55, 0.3, 0.75), intensity: 1.8, size: 0.03 },
    { color: Color4.create(0.95, 0.25, 0.7, 0.5), emissive: Color3.create(0.85, 0.2, 0.65), intensity: 2.7, size: 0.03 },
  ]

  for (let i = 0; i < particleCount; i++) {
    const rNorm = Math.pow(seededRandom(), 0.3)
    const r = rNorm * maxR
    const armIndex = i % armCount
    const armOffset = armIndex * (2.0 * Math.PI / armCount)
    const windAngle = rNorm * 2.8
    const petalEnvelope = Math.sin(rNorm * Math.PI)
    const roundedTip = 1.0 - Math.pow(Math.max(0, rNorm - 0.85) / 0.15, 2)
    const petalWidth = 0.6 * Math.pow(Math.max(petalEnvelope, 0.2), 0.5) * roundedTip
    const spread = (seededRandom() * 2.0 - 1.0) * petalWidth
    const theta = armOffset + windAngle + spread
    const x = r * Math.cos(theta)
    const z = r * Math.sin(theta)
    const heightScale = Math.max(0.03, 0.6 * Math.pow(1.0 - rNorm, 1.5))
    const y = heightScale * (seededRandom() * 2 - 1)

    let band: number
    if (rNorm < 0.2) band = 0
    else if (rNorm < 0.45) band = Math.abs(spread) < petalWidth * 0.3 ? 1 : 2
    else if (rNorm < 0.75) band = seededRandom() < 0.15 ? 4 : 2
    else band = seededRandom() < 0.15 ? 4 : 3

    const style = bands[band]
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(x, y, z),
      scale: Vector3.create(style.size, style.size, style.size), parent: root
    })
    MeshRenderer.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: style.color, emissiveColor: style.emissive, emissiveIntensity: style.intensity,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    nebulaEntities.push(entity)
  }

  // Core cluster
  for (let i = 0; i < 150; i++) {
    const rx = (seededRandom() + seededRandom() + seededRandom()) / 3.0 * 2.0 - 1.0
    const ry = (seededRandom() + seededRandom() + seededRandom()) / 3.0 * 2.0 - 1.0
    const rz = (seededRandom() + seededRandom() + seededRandom()) / 3.0 * 2.0 - 1.0
    const coreRadius = MAP_RADIUS * 0.18
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(rx * coreRadius, ry * coreRadius * 0.5, rz * coreRadius),
      scale: Vector3.create(0.02, 0.02, 0.02), parent: root
    })
    MeshRenderer.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(1, 0.9, 0.55, 0.45), emissiveColor: Color3.create(1, 0.85, 0.4),
      emissiveIntensity: 2.7, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    nebulaEntities.push(entity)
  }

  // Halo
  for (let i = 0; i < 60; i++) {
    const rx = (seededRandom() + seededRandom() + seededRandom()) / 3.0 * 2.0 - 1.0
    const ry = (seededRandom() + seededRandom() + seededRandom()) / 3.0 * 2.0 - 1.0
    const rz = (seededRandom() + seededRandom() + seededRandom()) / 3.0 * 2.0 - 1.0
    const haloRadius = MAP_RADIUS * 0.35
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(rx * haloRadius, ry * haloRadius * 0.1, rz * haloRadius),
      scale: Vector3.create(0.015, 0.015, 0.015), parent: root
    })
    MeshRenderer.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(1, 0.85, 0.5, 0.32), emissiveColor: Color3.create(1, 0.8, 0.4),
      emissiveIntensity: 1.8, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    nebulaEntities.push(entity)
  }

  // Central glow
  const glowEntity = engine.addEntity()
  Transform.create(glowEntity, {
    position: Vector3.create(0, 0, 0), scale: Vector3.create(1.2, 0.8, 1.2), parent: root
  })
  MeshRenderer.setSphere(glowEntity)
  Material.setPbrMaterial(glowEntity, {
    albedoColor: Color4.create(1, 0.8, 0.4, 0.1), emissiveColor: Color3.create(1, 0.8, 0.4),
    emissiveIntensity: 3.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  nebulaEntities.push(glowEntity)

  // Inter-arm haze
  for (let i = 0; i < 100; i++) {
    const r = MAP_RADIUS * 1.3 * seededRandom()
    const theta = seededRandom() * 2.0 * Math.PI
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(r * Math.cos(theta), 0.08 * (seededRandom() * 2 - 1), r * Math.sin(theta)),
      scale: Vector3.create(0.02, 0.02, 0.02), parent: root
    })
    MeshRenderer.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(0.4, 0.5, 0.6, 0.25), emissiveColor: Color3.create(0.3, 0.4, 0.5),
      emissiveIntensity: 1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    nebulaEntities.push(entity)
  }
}

function createZoneRings(maxCoordRadius: number): void {
  const root = createGalaxyRoot()
  const zoneDistances = [100, 300, 600, 900]
  const scale = MAP_RADIUS / maxCoordRadius

  for (const dist of zoneDistances) {
    const ringRadius = dist * scale
    if (ringRadius > MAP_RADIUS) continue
    const segments = 24
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      const entity = engine.addEntity()
      Transform.create(entity, {
        position: Vector3.create(Math.cos(angle) * ringRadius, 0, Math.sin(angle) * ringRadius),
        scale: Vector3.create(0.03, 0.03, 0.03), parent: root
      })
      MeshRenderer.setSphere(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(0, 1, 1, 0.2), emissiveColor: Color3.create(0, 0.5, 0.5),
        emissiveIntensity: 1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
      })
      zoneRingEntities.push(entity)
    }
  }
}

// Emissive levels are set to hold up against the brightly lit interior model.
function getStarColor(system: StarSystem, homeSystemId: string | null, currentSystemId: string | null): { color: Color4; emissive: Color3; size: number; intensity: number } {
  if (system.id === homeSystemId) return { color: Color4.create(1, 0.3, 1, 1), emissive: Color3.create(1, 0.3, 1), size: 0.12, intensity: 7 }
  if (system.id === currentSystemId) return { color: Color4.create(0, 1, 0.5, 1), emissive: Color3.create(0, 1, 0.5), size: 0.15, intensity: 7 }
  if (system.has_station) return { color: Color4.create(0, 0.8, 0.8, 1), emissive: Color3.create(0, 0.8, 0.8), size: 0.08, intensity: 3 }
  if (wormholeOpen(system)) return { color: Color4.create(0.6, 0.2, 1, 1), emissive: Color3.create(0.6, 0.2, 1), size: 0.07, intensity: 4.5 }
  if (system.has_wormhole) return { color: Color4.create(0.3, 0.12, 0.45, 1), emissive: Color3.create(0.3, 0.12, 0.45), size: 0.06, intensity: 2 }   // a black hole whose wormhole leads nowhere yet
  return { color: Color4.create(1, 1, 1, 1), emissive: Color3.create(1, 1, 1), size: 0.05, intensity: 3 }
}

const HOME_COLOR = Color3.create(1, 0.3, 1)
const STATION_COLOR = Color3.create(0, 0.8, 0.8)

/** Downward-pointing cone hovering over the home system, like a map pin. */
function addHomePin(root: Entity, pos: Vector3, starSize: number): Entity {
  const pin = engine.addEntity()
  Transform.create(pin, { position: Vector3.create(pos.x, pos.y + starSize / 2 + 0.1, pos.z), scale: Vector3.create(0.07, 0.11, 0.07), parent: root })
  MeshRenderer.setCylinder(pin, 0, 1)   // point at the bottom, toward the star
  Material.setPbrMaterial(pin, { albedoColor: Color4.create(HOME_COLOR.r, HOME_COLOR.g, HOME_COLOR.b, 1), emissiveColor: HOME_COLOR, emissiveIntensity: 4 })
  nebulaEntities.push(pin)   // cleared with the map
  return pin
}

/** A faint flat halo disc around a station system: one soft circle, quiet even when most systems have one. */
// Visited / fully explored rings: segments laid in a circle just outside the station halo. Visited is a faint
// dashed ring, explored a bright solid one: both green, told apart by shape and brightness.
const VISITED_COLOR = Color3.create(0.3, 0.8, 0.45)
const EXPLORED_COLOR = Color3.create(0.35, 1, 0.55)
const progressRingEntities: Entity[] = []

function addProgressRing(root: Entity, pos: Vector3, starSize: number, explored: boolean): void {
  const r = starSize / 2 + 0.1
  const n = explored ? 24 : 16
  const arc = (2 * Math.PI * r) / n
  for (let i = 0; i < n; i++) {
    if (!explored && i % 2 === 1) continue   // dashes
    const a = (i / n) * Math.PI * 2
    const seg = engine.addEntity()
    Transform.create(seg, {
      position: Vector3.create(pos.x + Math.cos(a) * r, pos.y, pos.z + Math.sin(a) * r),
      scale: Vector3.create(arc * (explored ? 1.05 : 0.8), 0.006, explored ? 0.016 : 0.01),
      rotation: Quaternion.fromEulerDegrees(0, 90 - (a * 180) / Math.PI, 0),
      parent: root,
    })
    MeshRenderer.setBox(seg)
    const c = explored ? EXPLORED_COLOR : VISITED_COLOR
    Material.setPbrMaterial(seg, { albedoColor: Color4.create(c.r, c.g, c.b, explored ? 1 : 0.55), emissiveColor: c, emissiveIntensity: explored ? 1.6 : 0.6, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
    progressRingEntities.push(seg)
  }
}

// --- Legend filters: each legend item switches its kind of star on or off; a star shows if any of its kinds is on.
export type MapFilter = 'here' | 'home' | 'star' | 'station' | 'visited' | 'explored'
const FILTER_PREF = 'mapFiltersOff'
let renderedHomeId: string | null = null
let renderedCurrentId: string | null = null
const starDecor = new Map<Entity, { pin?: Entity; halo?: Entity }>()

// Stored as comma-separated text (preferences hold plain values), e.g. 'star,station'
function filtersOff(): MapFilter[] { const v = getPref<string>(FILTER_PREF, ''); return typeof v === 'string' && v ? v.split(',') as MapFilter[] : [] }
export function isMapFilterOn(f: MapFilter): boolean { return !filtersOff().includes(f) }
export function toggleMapFilter(f: MapFilter): void {
  const off = filtersOff()
  setPref(FILTER_PREF, (isMapFilterOn(f) ? [...off, f] : off.filter(x => x !== f)).join(',') || null)
  applyMapFilters()
}

function starKinds(system: StarSystem): MapFilter[] {
  const kinds: MapFilter[] = []
  if (system.id === renderedCurrentId) kinds.push('here')
  if (system.id === renderedHomeId) kinds.push('home')
  if (system.has_station) kinds.push('station')
  const p = systemProgress(system.id)
  if (p?.visited) kinds.push('visited')
  if (p?.explored) kinds.push('explored')
  if (kinds.length === 0) kinds.push('star')   // a plain star: nothing else to say about it
  return kinds
}
function starShown(system: StarSystem): boolean { return starKinds(system).some(isMapFilterOn) }

function setShown(e: Entity, shown: boolean): void { VisibilityComponent.createOrReplace(e, { visible: shown }) }

/** Shows or hides stars and their markers for the current legend filters. */
export function applyMapFilters(): void {
  for (const [entity, system] of starEntities) {
    const shown = starShown(system)
    setShown(entity, shown)
    // A hidden star can't be clicked either
    if (shown) MeshCollider.setSphere(entity, ColliderLayer.CL_POINTER)
    else MeshCollider.deleteFrom(entity)
    const decor = starDecor.get(entity)
    if (decor?.pin) setShown(decor.pin, shown && isMapFilterOn('home'))
    if (decor?.halo) setShown(decor.halo, shown && isMapFilterOn('station'))
  }
  if (currentLocationMarker) setShown(currentLocationMarker, isMapFilterOn('here'))
  drawProgressRings()
  drawWormholeMarker()   // hidden with its star
  drawDistressMarkers()
}

// --- Wormhole event marker: a violet ring of segments turning around the wormhole's target star ---
const WORMHOLE_COLOR = Color3.create(0.75, 0.45, 1)
let wormholeTargetId: string | null = null
let wormholePivot: Entity | null = null
const wormholeSegments: Entity[] = []
let wormholeSpin = 0

/** Marks (or, with null, unmarks) the wormhole event's target star on the map. */
export function setWormholeTarget(systemId: string | null): void {
  wormholeTargetId = systemId
  drawWormholeMarker()
}

function clearWormholeMarker(): void {
  for (const e of wormholeSegments) engine.removeEntity(e)
  wormholeSegments.length = 0
  if (wormholePivot) { engine.removeEntity(wormholePivot); wormholePivot = null }
}

function drawWormholeMarker(): void {
  clearWormholeMarker()
  if (!wormholeTargetId || !galaxyRoot) return
  for (const [entity, system] of starEntities) {
    if (system.id !== wormholeTargetId || !starShown(system)) continue
    const t = Transform.get(entity)
    wormholePivot = engine.addEntity()
    Transform.create(wormholePivot, { position: t.position, parent: galaxyRoot })
    const r = t.scale.x / 2 + 0.2
    const n = 12
    for (let i = 0; i < n; i++) {
      if (i % 2 === 1) continue   // dashes, so the turning is visible
      const a = (i / n) * Math.PI * 2
      const seg = engine.addEntity()
      Transform.create(seg, {
        position: Vector3.create(Math.cos(a) * r, 0, Math.sin(a) * r),
        scale: Vector3.create((2 * Math.PI * r / n) * 0.9, 0.008, 0.02),
        rotation: Quaternion.fromEulerDegrees(0, 90 - (a * 180) / Math.PI, 0),
        parent: wormholePivot,
      })
      MeshRenderer.setBox(seg)
      Material.setPbrMaterial(seg, { albedoColor: Color4.create(WORMHOLE_COLOR.r, WORMHOLE_COLOR.g, WORMHOLE_COLOR.b, 1), emissiveColor: WORMHOLE_COLOR, emissiveIntensity: 2, castShadows: false })
      wormholeSegments.push(seg)
    }
  }
}

// --- Distress markers: a red ring of segments, pulsing, around each star with a stranded ship calling for help ---
const DISTRESS_COLOR = Color3.create(1, 0.2, 0.25)
let distressSystemIds: string[] = []
const distressPivots: Entity[] = []
const distressSegments: Entity[] = []
let distressPulse = 0

/** Rings the stars with active distress calls (other captains'; distress.ts). */
export function setDistressTargets(systemIds: string[]): void {
  if (systemIds.join() === distressSystemIds.join()) return
  distressSystemIds = systemIds
  drawDistressMarkers()
}

function clearDistressMarkers(): void {
  for (const e of distressSegments) engine.removeEntity(e)
  distressSegments.length = 0
  for (const e of distressPivots) engine.removeEntity(e)
  distressPivots.length = 0
}

function drawDistressMarkers(): void {
  clearDistressMarkers()
  if (!galaxyRoot || distressSystemIds.length === 0) return
  for (const [entity, system] of starEntities) {
    if (!distressSystemIds.includes(system.id) || !starShown(system)) continue
    const t = Transform.get(entity)
    const pivot = engine.addEntity()
    Transform.create(pivot, { position: t.position, parent: galaxyRoot })
    distressPivots.push(pivot)
    const r = t.scale.x / 2 + 0.28
    const n = 16
    for (let i = 0; i < n; i++) {
      if (i % 4 === 3) continue
      const a = (i / n) * Math.PI * 2
      const seg = engine.addEntity()
      Transform.create(seg, {
        position: Vector3.create(Math.cos(a) * r, 0, Math.sin(a) * r),
        scale: Vector3.create((2 * Math.PI * r / n) * 0.85, 0.01, 0.025),
        rotation: Quaternion.fromEulerDegrees(0, 90 - (a * 180) / Math.PI, 0),
        parent: pivot,
      })
      MeshRenderer.setBox(seg)
      Material.setPbrMaterial(seg, { albedoColor: Color4.create(DISTRESS_COLOR.r, DISTRESS_COLOR.g, DISTRESS_COLOR.b, 1), emissiveColor: DISTRESS_COLOR, emissiveIntensity: 3, castShadows: false })
      distressSegments.push(seg)
    }
  }
}

/** Draws a ring around every visited or fully explored star (redrawn when the progress data changes). */
export function drawProgressRings(): void {
  for (const e of progressRingEntities) engine.removeEntity(e)
  progressRingEntities.length = 0
  if (!galaxyRoot) return
  for (const [entity, system] of starEntities) {
    const p = systemProgress(system.id)
    if (!p || !starShown(system)) continue
    const explored = p.explored && isMapFilterOn('explored')
    if (!explored && !(p.visited && isMapFilterOn('visited'))) continue
    const t = Transform.get(entity)
    addProgressRing(galaxyRoot, t.position, t.scale.x, explored)
  }
}
onSystemProgressChanged(() => applyMapFilters())   // visited / explored change which stars match which filters

function addStationRing(root: Entity, pos: Vector3, starSize: number): Entity {
  const d = (starSize / 2 + 0.06) * 2
  const halo = engine.addEntity()
  Transform.create(halo, { position: pos, scale: Vector3.create(d, 0.004, d), parent: root })
  MeshRenderer.setCylinder(halo)
  Material.setPbrMaterial(halo, { albedoColor: Color4.create(STATION_COLOR.r, STATION_COLOR.g, STATION_COLOR.b, 0.22), emissiveColor: STATION_COLOR, emissiveIntensity: 0.8, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false })
  nebulaEntities.push(halo)   // cleared with the map
  return halo
}

export function hideCurrentLocationMarker(): void {
  if (currentLocationMarker) { engine.removeEntity(currentLocationMarker); currentLocationMarker = null }
}

function createCurrentLocationMarker(position: Vector3): void {
  const root = createGalaxyRoot()
  if (currentLocationMarker) engine.removeEntity(currentLocationMarker)
  currentLocationMarker = engine.addEntity()
  Transform.create(currentLocationMarker, {
    position: Vector3.create(position.x, position.y + 0.25, position.z),
    scale: Vector3.create(0.12, 0.12, 0.12),
    rotation: Quaternion.fromEulerDegrees(45, 0, 45), parent: root
  })
  MeshRenderer.setBox(currentLocationMarker)
  Material.setPbrMaterial(currentLocationMarker, {
    albedoColor: Color4.create(0, 1, 0.5, 1), emissiveColor: Color3.create(0, 1, 0.5), emissiveIntensity: 6
  })
}

function lerp(current: number, target: number, t: number): number {
  const diff = target - current
  if (Math.abs(diff) < 0.001) return target
  return current + diff * t
}

export function galaxyAnimationSystem(dt: number): void {
  if (distressPivots.length) {
    distressPulse += dt
    const s = 1 + 0.18 * Math.sin(distressPulse * 4)   // a beacon's throb, by size only
    for (const p of distressPivots) Transform.getMutable(p).scale = Vector3.create(s, 1, s)
  }
  if (wormholePivot) {
    wormholeSpin = (wormholeSpin + dt * 40) % 360
    Transform.getMutable(wormholePivot).rotation = Quaternion.fromEulerDegrees(0, wormholeSpin, 0)
  }
  // Transition animation
  if (transitionPhase === 'shrinking') {
    transitionScale = lerp(transitionScale, 0, 1 - Math.exp(-TRANSITION_SPEED * dt))
    applyGalaxyTransform()
    if (transitionScale < 0.01) {
      transitionScale = 0
      applyGalaxyTransform()
      transitionPhase = 'swapping'
      if (pendingMode && onViewModeChange) {
        currentViewMode = pendingMode
        if (onViewModeChanged) onViewModeChanged()
        const result = onViewModeChange(pendingMode)
        pendingMode = null
        if (result && typeof (result as any).then === 'function') {
          (result as Promise<void>).then(() => { transitionPhase = 'expanding' }).catch(() => { transitionPhase = 'expanding' })
        } else {
          transitionPhase = 'expanding'
        }
      } else {
        transitionPhase = 'expanding'
      }
    }
  } else if (transitionPhase === 'swapping') {
    transitionScale = 0
    applyGalaxyTransform()
  } else if (transitionPhase === 'expanding') {
    transitionScale = lerp(transitionScale, 1, 1 - Math.exp(-TRANSITION_SPEED * dt))
    applyGalaxyTransform()
    if (transitionScale > 0.99) {
      transitionScale = 1
      transitionPhase = 'idle'
      applyGalaxyTransform()
    }
  }

  // Zoom/height/rotate
  if (transitionPhase === 'idle') {
    const t = 1 - Math.exp(-ANIM_SPEED * dt)
    let needsUpdate = false
    if (Math.abs(currentScale - targetScale) > 0.001) { currentScale = lerp(currentScale, targetScale, t); needsUpdate = true }
    if (Math.abs(currentHeight - targetHeight) > 0.001) { currentHeight = lerp(currentHeight, targetHeight, t); needsUpdate = true }
    if (Math.abs(currentRotationY - targetRotationY) > 0.01) { currentRotationY = lerp(currentRotationY, targetRotationY, t); needsUpdate = true }
    if (needsUpdate) applyGalaxyTransform()
  }

  // Spin location marker
  if (currentLocationMarker) {
    markerRotation += dt * 60
    const transform = Transform.getMutable(currentLocationMarker)
    transform.rotation = Quaternion.fromEulerDegrees(45, markerRotation, 45)
  }

  // Hologram beam: each layer's texture drives both colour and glow, so only its streaks light up. The two cones
  // turn in opposite directions at different speeds; a gentle shared pulse on top.
  if (beamEntity && beamOuterEntity) {
    beamTime += dt
    // The pulse, fade-in and survey tint move in visible steps, and the materials are written only when a step
    // changes: a few writes a second from a small set of looks, instead of two brand-new materials every frame.
    const step = (v: number, n: number) => Math.round(v * n) / n
    const pulse = step(0.5 + 0.5 * Math.sin(beamTime * 1.5), 10)
    const k = Math.max(0, Math.min(1, (beamTime - HOLO_WARMUP_SECONDS) / HOLO_FADE_IN_SECONDS))
    const fadeIn = step(k * k * (3 - 2 * k), 20)
    // Surveys tint the beam green (matching the survey bar and tab), easing over about a second
    const surveyTarget = isViewingRemoteSystem() ? 1 : 0
    surveyBlend += (surveyTarget - surveyBlend) * Math.min(1, dt * 3)
    const blend = step(surveyBlend, 10)
    const mix = (cyan: number, green: number) => cyan + (green - cyan) * blend
    const key = `${pulse}|${fadeIn}|${blend}`
    const repaint = key !== beamMaterialKey
    beamMaterialKey = key
    const layers: [Entity, typeof HOLO_LAYERS[number]][] = [[beamEntity, HOLO_LAYERS[0]], [beamOuterEntity, HOLO_LAYERS[1]]]
    for (const [entity, L] of layers) {
      Transform.getMutable(entity).rotation = Quaternion.fromEulerDegrees(0, (beamTime * L.spin) % 360, 0)
      if (!repaint) continue
      const tex = { src: HOLO_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT, tiling: L.tiling }
      Material.setPbrMaterial(entity, {
        texture: Material.Texture.Common(tex),
        emissiveTexture: Material.Texture.Common(tex),
        albedoColor: Color4.create(mix(0.6, 0.45), mix(0.85, 1), mix(1, 0.6), L.alpha * (0.8 + pulse * 0.4) * fadeIn),
        emissiveColor: Color3.create(mix(0.35, 0.25) * fadeIn, mix(0.75, 1) * fadeIn, mix(1, 0.45) * fadeIn),
        emissiveIntensity: L.glow * (0.8 + pulse * 0.5),
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
        castShadows: false,
      })
    }
  }

}

const mapHooks: { rendered?: () => void; cleared?: () => void }[] = []
/** Overlays (the heat map, the travel route) redraw after the stars render and clear with the map. */
export function addMapRenderHooks(hooks: { rendered?: () => void; cleared?: () => void }): void { mapHooks.push(hooks) }

export function renderStarSystems(systems: StarSystem[], homeSystemId: string | null, currentSystemId: string | null): void {
  const root = createGalaxyRoot()
  let maxRadius = 1
  for (const sys of systems) {
    const dist = Math.sqrt(sys.coord_x ** 2 + sys.coord_y ** 2 + sys.coord_z ** 2)
    if (dist > maxRadius) maxRadius = dist
  }
  const scale = MAP_RADIUS / maxRadius

  createZoneRings(maxRadius)
  createNebula()

  renderedHomeId = homeSystemId
  renderedCurrentId = currentSystemId
  starDecor.clear()
  for (const system of systems) {
    const { color, emissive, size, intensity } = getStarColor(system, homeSystemId, currentSystemId)
    const entity = engine.addEntity()
    const position = Vector3.create(system.coord_x * scale, system.coord_z * scale, system.coord_y * scale)
    Transform.create(entity, { position, scale: Vector3.create(size, size, size), parent: root })
    MeshRenderer.setSphere(entity)
    MeshCollider.setSphere(entity, ColliderLayer.CL_POINTER)
    Material.setPbrMaterial(entity, { albedoColor: color, emissiveColor: emissive, emissiveIntensity: intensity })
    starEntities.set(entity, system)
    if (system.id === currentSystemId) createCurrentLocationMarker(position)
    // Shape cues so no marker relies on colour alone: a pin over home, a flat halo disc around stations.
    starDecor.set(entity, {
      pin: system.id === homeSystemId ? addHomePin(root, position, size) : undefined,
      halo: system.has_station ? addStationRing(root, position, size) : undefined,
    })
  }
  applyMapFilters()   // hides filtered-out stars and draws the visited / explored rings
  for (const h of mapHooks) h.rendered?.()
}

export function clearMap(): void {
  for (const h of mapHooks) h.cleared?.()
  for (const [entity] of starEntities) engine.removeEntity(entity)
  starEntities.clear()
  starDecor.clear()
  for (const entity of zoneRingEntities) engine.removeEntity(entity)
  zoneRingEntities.length = 0
  for (const entity of nebulaEntities) engine.removeEntity(entity)
  nebulaEntities.length = 0
  for (const entity of progressRingEntities) engine.removeEntity(entity)
  progressRingEntities.length = 0
  clearWormholeMarker()
  clearDistressMarkers()
  if (currentLocationMarker) { engine.removeEntity(currentLocationMarker); currentLocationMarker = null }
  if (galaxyRoot) {
    engine.removeEntity(galaxyRoot)
    galaxyRoot = null
  }
}
