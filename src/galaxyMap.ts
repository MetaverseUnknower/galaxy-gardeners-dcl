import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, ColliderLayer, TextureWrapMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion, Vector2 } from '@dcl/sdk/math'
import { StarSystem } from './types'
import { getSystemRoot, getSystemAutoScale } from './systemView'
import { DECK_Y } from './environment'
import { PROJECTOR_TOP_Y } from './environment'

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
const HEIGHT_LEVELS = 13            // levels 0..12 → 0.3m .. 3.9m above the floor
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
let beamTime = 0
const NEBULA_EXTENT = MAP_RADIUS * 1.5
// Hologram beam texture (a 1024 copy of assets/images/hologram.png; the original is kept as supplied).
const HOLO_TEXTURE = 'assets/images/hologram-1024.png'
const HOLO_TILING = Vector2.create(2, 1)
const HOLO_SCROLL_SPEED = 0.06   // texture heights per second, upward

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

export function rotateMap(dir: 1 | -1): void { targetRotationY += dir * ROTATE_STEP }
export function tiltMap(dir: 1 | -1): void { heightLevel += dir; applyLevels() }
export function zoomMap(dir: 1 | -1): void { scaleLevel += dir; applyLevels() }
export function resetMapView(): void { targetRotationY = 0; heightLevel = DEFAULT_HEIGHT_LEVEL; scaleLevel = DEFAULT_SCALE_LEVEL; applyLevels() }
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
  const transform = Transform.getMutable(beamEntity)
  transform.position = Vector3.create(MAP_CENTER.x, PROJECTOR_TOP_Y + beamHeight / 2, MAP_CENTER.z)
  transform.scale = Vector3.create(transitionScale, beamHeight, transitionScale)
  MeshRenderer.setCylinder(beamEntity, PROJECTOR_RADIUS * transitionScale, topRadius)
}

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
    albedoColor: Color4.create(0, 0.5, 1, 0.06),
    emissiveColor: Color3.create(0, 0.3, 0.8),
    emissiveIntensity: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })

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
  if (system.has_wormhole) return { color: Color4.create(0.6, 0.2, 1, 1), emissive: Color3.create(0.6, 0.2, 1), size: 0.07, intensity: 4.5 }
  return { color: Color4.create(1, 1, 1, 1), emissive: Color3.create(1, 1, 1), size: 0.05, intensity: 3 }
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

  // Pulse beam: the hologram texture drives both colour and glow, so only its streaks light up (transparent
  // parts stay transparent). The texture scrolls slowly upward, wrapped twice around the cone.
  if (beamEntity) {
    beamTime += dt
    const pulse = 0.5 + 0.5 * Math.sin(beamTime * 1.5)
    const scroll = Vector2.create(0, -(beamTime * HOLO_SCROLL_SPEED) % 1)
    const tex = { src: HOLO_TEXTURE, wrapMode: TextureWrapMode.TWM_REPEAT, tiling: HOLO_TILING, offset: scroll }
    Material.setPbrMaterial(beamEntity, {
      texture: Material.Texture.Common(tex),
      emissiveTexture: Material.Texture.Common(tex),
      albedoColor: Color4.create(0.6, 0.85, 1, 0.55 + pulse * 0.3),
      emissiveColor: Color3.create(0.35, 0.75, 1),
      emissiveIntensity: 1.6 + pulse * 1.6,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
      castShadows: false,
    })
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
  }
  for (const h of mapHooks) h.rendered?.()
}

export function clearMap(): void {
  for (const h of mapHooks) h.cleared?.()
  for (const [entity] of starEntities) engine.removeEntity(entity)
  starEntities.clear()
  for (const entity of zoneRingEntities) engine.removeEntity(entity)
  zoneRingEntities.length = 0
  for (const entity of nebulaEntities) engine.removeEntity(entity)
  nebulaEntities.length = 0
  if (currentLocationMarker) { engine.removeEntity(currentLocationMarker); currentLocationMarker = null }
  if (galaxyRoot) {
    engine.removeEntity(galaxyRoot)
    galaxyRoot = null
  }
}
