import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, InputAction, pointerEventsSystem, ColliderLayer, TextShape, TextAlignMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { StarSystem } from './types'
import { getSystemRoot, getSystemAutoScale } from './systemView'
import { DECK_Y } from './environment'

const FLOOR_Y = 40
const MAP_CENTER = Vector3.create(128, FLOOR_Y + 1, 128)
const MAP_RADIUS = 6.0
const PROJECTOR_RADIUS = 1.5
const PROJECTOR_HEIGHT = 0.3

// Control state
let galaxyRoot: Entity | null = null
let currentScale = 1.0
let currentHeight = FLOOR_Y + 1.0
let currentRotationY = 0
let targetScale = 1.0
let targetHeight = FLOOR_Y + 1.0
let targetRotationY = 0
const ANIM_SPEED = 4.0
const MIN_SCALE = 0.4
const MAX_SCALE = 2.0
const SCALE_STEP = 0.2
const HEIGHT_STEP = 0.3
const MIN_HEIGHT = FLOOR_Y + 0.3
const MAX_HEIGHT = FLOOR_Y + 4.0
const ROTATE_STEP = 15

export const starEntities: Map<Entity, StarSystem> = new Map()
const zoneRingEntities: Entity[] = []
const nebulaEntities: Entity[] = []
let currentLocationMarker: Entity | null = null
let markerRotation = 0
let beamEntity: Entity | null = null
let beamTime = 0
let systemViewBtnEntity: Entity | null = null
let systemViewBtnDisabled = false
const NEBULA_EXTENT = MAP_RADIUS * 1.5

// Exported for station panel alignment
export const PANEL_Z = () => MAP_CENTER.z + NEBULA_EXTENT + 0.5
export const PANEL_Y = () => DECK_Y + 0.625
export const PANEL_TILT = () => Quaternion.fromEulerDegrees(-82.5, 0, 0)
export const PANEL_CENTER_X = () => MAP_CENTER.x
const VIEW_ROW_OFFSET_Z = -0.35 * Math.sin(82.5 * Math.PI / 180)
const VIEW_ROW_OFFSET_Y = 0.35 * Math.cos(82.5 * Math.PI / 180)
export const GLASS_PANEL_Z = () => MAP_CENTER.z + NEBULA_EXTENT + 0.5 + VIEW_ROW_OFFSET_Z / 2
export const GLASS_PANEL_Y = () => DECK_Y + 0.625 + VIEW_ROW_OFFSET_Y / 2

const PANEL_ANGLE = 82.5 // degrees

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
  const beamHeight = Math.max(0.01, (currentHeight - FLOOR_Y - PROJECTOR_HEIGHT) * transitionScale)
  const transform = Transform.getMutable(beamEntity)
  transform.position = Vector3.create(MAP_CENTER.x, FLOOR_Y + PROJECTOR_HEIGHT + beamHeight / 2, MAP_CENTER.z)
  transform.scale = Vector3.create(transitionScale, beamHeight, transitionScale)
  MeshRenderer.setCylinder(beamEntity, PROJECTOR_RADIUS * transitionScale, topRadius)
}

export function createProjectorBase(): void {
  // Translucent cyan top
  const top = engine.addEntity()
  Transform.create(top, {
    position: Vector3.create(MAP_CENTER.x, FLOOR_Y + PROJECTOR_HEIGHT * 0.85, MAP_CENTER.z),
    scale: Vector3.create(PROJECTOR_RADIUS * 1.85, PROJECTOR_HEIGHT * 0.3, PROJECTOR_RADIUS * 1.85)
  })
  MeshRenderer.setCylinder(top)
  Material.setPbrMaterial(top, {
    albedoColor: Color4.create(0, 0.8, 1, 0.3),
    emissiveColor: Color3.create(0, 0.6, 0.8),
    emissiveIntensity: 4,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })

  // Cone beam
  beamEntity = engine.addEntity()
  const beamHeight = MAP_CENTER.y - FLOOR_Y - PROJECTOR_HEIGHT
  Transform.create(beamEntity, {
    position: Vector3.create(MAP_CENTER.x, FLOOR_Y + PROJECTOR_HEIGHT + beamHeight / 2, MAP_CENTER.z),
    scale: Vector3.create(1, beamHeight, 1)
  })
  MeshRenderer.setCylinder(beamEntity, PROJECTOR_RADIUS, NEBULA_EXTENT * currentScale)
  Material.setPbrMaterial(beamEntity, {
    albedoColor: Color4.create(0, 0.5, 1, 0.03),
    emissiveColor: Color3.create(0, 0.3, 0.8),
    emissiveIntensity: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })

  // Control panel
  const panelZ = MAP_CENTER.z + NEBULA_EXTENT + 0.71
  const panelY = DECK_Y + 0.625
  const panelTilt = Quaternion.fromEulerDegrees(-PANEL_ANGLE, 0, 0)
  const btnSize = Vector3.create(0.22, 0.22, 0.08)
  const spacing = 0.3
  const startX = MAP_CENTER.x - (spacing * 2.5)

  const viewRowOffsetY = 0.35 * Math.cos(PANEL_ANGLE * Math.PI / 180)
  const viewRowOffsetZ = -0.35 * Math.sin(PANEL_ANGLE * Math.PI / 180)
  const viewBtnWidth = Vector3.create(0.5, 0.22, 0.08)
  const viewSpacing = 0.55

  // Galaxy View button
  const galaxyViewBtn = engine.addEntity()
  Transform.create(galaxyViewBtn, {
    position: Vector3.create(MAP_CENTER.x + viewSpacing / 2, panelY + viewRowOffsetY, panelZ + viewRowOffsetZ),
    scale: viewBtnWidth, rotation: panelTilt
  })
  MeshRenderer.setBox(galaxyViewBtn)
  MeshCollider.setBox(galaxyViewBtn)
  Material.setPbrMaterial(galaxyViewBtn, {
    albedoColor: Color4.create(0, 0.2, 0.3, 1), emissiveColor: Color3.create(0, 0.8, 1), emissiveIntensity: 1.5
  })
  pointerEventsSystem.onPointerDown(
    { entity: galaxyViewBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Galaxy View', maxDistance: 8 } },
    () => switchViewMode('galaxy')
  )

  // Galaxy icon
  const iconRotation = Quaternion.fromEulerDegrees(PANEL_ANGLE, 180, 0)
  const iconOffY = 0.12 * Math.cos(PANEL_ANGLE * Math.PI / 180)
  const iconOffZ = -0.12 * Math.sin(PANEL_ANGLE * Math.PI / 180)
  const iconStyle = {
    albedoColor: Color4.create(0, 0.08, 0.25, 0.9),
    emissiveColor: Color3.create(0, 0.08, 0.25),
    emissiveIntensity: 2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  }

  const galaxyIcon = engine.addEntity()
  Transform.create(galaxyIcon, {
    position: Vector3.create(MAP_CENTER.x + viewSpacing / 2, panelY + viewRowOffsetY + 0.045, panelZ + viewRowOffsetZ - 0.01),
    scale: Vector3.create(0.18, 0.18, 1), rotation: iconRotation
  })
  MeshRenderer.setPlane(galaxyIcon)
  Material.setPbrMaterial(galaxyIcon, { ...iconStyle, texture: Material.Texture.Common({ src: 'assets/icons/galaxy-icon.png' }), emissiveTexture: Material.Texture.Common({ src: 'assets/icons/galaxy-icon.png' }) })

  // System View button
  const systemViewBtn = engine.addEntity()
  systemViewBtnEntity = systemViewBtn
  Transform.create(systemViewBtn, {
    position: Vector3.create(MAP_CENTER.x - viewSpacing / 2, panelY + viewRowOffsetY, panelZ + viewRowOffsetZ),
    scale: viewBtnWidth, rotation: panelTilt
  })
  MeshRenderer.setBox(systemViewBtn)
  MeshCollider.setBox(systemViewBtn)
  Material.setPbrMaterial(systemViewBtn, {
    albedoColor: Color4.create(0, 0.2, 0.3, 1), emissiveColor: Color3.create(0, 0.8, 1), emissiveIntensity: 1.5
  })
  pointerEventsSystem.onPointerDown(
    { entity: systemViewBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'System View', maxDistance: 8 } },
    () => switchViewMode('system')
  )

  const systemIcon = engine.addEntity()
  Transform.create(systemIcon, {
    position: Vector3.create(MAP_CENTER.x - viewSpacing / 2, panelY + viewRowOffsetY + 0.045, panelZ + viewRowOffsetZ - 0.01),
    scale: Vector3.create(0.18, 0.18, 1), rotation: iconRotation
  })
  MeshRenderer.setPlane(systemIcon)
  Material.setPbrMaterial(systemIcon, { ...iconStyle, texture: Material.Texture.Common({ src: 'assets/icons/system-icon.png' }), emissiveTexture: Material.Texture.Common({ src: 'assets/icons/system-icon.png' }) })



  // Control buttons (reversed for player perspective)
  const buttons: { hoverText: string; icon: string; flipX?: boolean; flipY?: boolean; callback: () => void }[] = [
    { hoverText: 'Rotate Right', icon: 'assets/icons/rotate-icon.png', flipX: true, callback: () => { targetRotationY -= ROTATE_STEP } },
    { hoverText: 'Raise', icon: 'assets/icons/height-adjust-icon.png', callback: () => { targetHeight = Math.min(MAX_HEIGHT, targetHeight + HEIGHT_STEP) } },
    { hoverText: 'Zoom In', icon: 'assets/icons/zoom-in-icon.png', callback: () => { targetScale = Math.min(MAX_SCALE, targetScale + SCALE_STEP) } },
    { hoverText: 'Zoom Out', icon: 'assets/icons/zoom-out-icon.png', callback: () => { targetScale = Math.max(MIN_SCALE, targetScale - SCALE_STEP) } },
    { hoverText: 'Lower', icon: 'assets/icons/height-adjust-icon.png', flipY: true, callback: () => { targetHeight = Math.max(MIN_HEIGHT, targetHeight - HEIGHT_STEP) } },
    { hoverText: 'Rotate Left', icon: 'assets/icons/rotate-icon.png', callback: () => { targetRotationY += ROTATE_STEP } },
  ]

  for (let i = 0; i < buttons.length; i++) {
    const btn = engine.addEntity()
    Transform.create(btn, {
      position: Vector3.create(startX + i * spacing, panelY + 0.01, panelZ - 0.08),
      scale: btnSize, rotation: panelTilt
    })
    MeshRenderer.setBox(btn)
    MeshCollider.setBox(btn)
    Material.setPbrMaterial(btn, {
      albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5
    })
    pointerEventsSystem.onPointerDown(
      { entity: btn, opts: { button: InputAction.IA_POINTER, hoverText: buttons[i].hoverText, maxDistance: 8 } },
      buttons[i].callback
    )

    const icon = engine.addEntity()
    const flipScaleX = buttons[i].flipX ? -1 : 1
    const flipScaleY = buttons[i].flipY ? -1 : 1
    Transform.create(icon, {
      position: Vector3.create(startX + i * spacing, panelY + 0.01 + 0.045, panelZ - 0.08 - 0.01),
      scale: Vector3.create(0.18 * flipScaleX, 0.18 * flipScaleY, 1), rotation: iconRotation
    })
    MeshRenderer.setPlane(icon)
    Material.setPbrMaterial(icon, {
      ...iconStyle,
      texture: Material.Texture.Common({ src: buttons[i].icon }),
      emissiveTexture: Material.Texture.Common({ src: buttons[i].icon })
    })
  }
}

function createNebula(): void {
  seed = 42
  const root = createGalaxyRoot()
  const armCount = 5
  const particleCount = 800
  const maxR = MAP_RADIUS * 1.5

  const bands = [
    { color: Color4.create(1, 0.85, 0.45, 0.35), emissive: Color3.create(1, 0.85, 0.45), intensity: 1.5, size: 0.04 },
    { color: Color4.create(0.7, 0.45, 0.2, 0.3), emissive: Color3.create(0.7, 0.45, 0.2), intensity: 1, size: 0.03 },
    { color: Color4.create(0.3, 0.65, 0.8, 0.35), emissive: Color3.create(0.3, 0.65, 0.8), intensity: 1.2, size: 0.035 },
    { color: Color4.create(0.55, 0.3, 0.75, 0.3), emissive: Color3.create(0.55, 0.3, 0.75), intensity: 1, size: 0.03 },
    { color: Color4.create(0.95, 0.25, 0.7, 0.35), emissive: Color3.create(0.85, 0.2, 0.65), intensity: 1.5, size: 0.03 },
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
      albedoColor: Color4.create(1, 0.9, 0.55, 0.3), emissiveColor: Color3.create(1, 0.85, 0.4),
      emissiveIntensity: 1.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
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
      albedoColor: Color4.create(1, 0.85, 0.5, 0.2), emissiveColor: Color3.create(1, 0.8, 0.4),
      emissiveIntensity: 1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
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
    albedoColor: Color4.create(1, 0.8, 0.4, 0.06), emissiveColor: Color3.create(1, 0.8, 0.4),
    emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
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
      albedoColor: Color4.create(0.4, 0.5, 0.6, 0.15), emissiveColor: Color3.create(0.3, 0.4, 0.5),
      emissiveIntensity: 0.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
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

function getStarColor(system: StarSystem, homeSystemId: string | null, currentSystemId: string | null): { color: Color4; emissive: Color3; size: number; intensity: number } {
  if (system.id === homeSystemId) return { color: Color4.create(1, 0.3, 1, 1), emissive: Color3.create(1, 0.3, 1), size: 0.12, intensity: 5 }
  if (system.id === currentSystemId) return { color: Color4.create(0, 1, 0.5, 1), emissive: Color3.create(0, 1, 0.5), size: 0.15, intensity: 5 }
  if (system.has_station) return { color: Color4.create(0, 0.8, 0.8, 1), emissive: Color3.create(0, 0.6, 0.6), size: 0.08, intensity: 1.5 }
  if (system.has_wormhole) return { color: Color4.create(0.6, 0.2, 1, 1), emissive: Color3.create(0.6, 0.2, 1), size: 0.07, intensity: 3 }
  return { color: Color4.create(1, 1, 1, 1), emissive: Color3.create(0.6, 0.6, 0.6), size: 0.05, intensity: 1.5 }
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

  // Pulse beam
  if (beamEntity) {
    beamTime += dt
    const pulse = 0.5 + 0.5 * Math.sin(beamTime * 1.5)
    const intensity = 0.5 + pulse * 1.5
    Material.setPbrMaterial(beamEntity, {
      albedoColor: Color4.create(0, 0.3 + pulse * 0.2, 1, 0.02 + pulse * 0.02),
      emissiveColor: Color3.create(0, 0.2 + pulse * 0.3, 0.6 + pulse * 0.4),
      emissiveIntensity: intensity, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
  }

  // Update System View button based on travel state
  if (systemViewBtnEntity) {
    const disabled = canSwitchToSystem ? !canSwitchToSystem() : false
    if (disabled !== systemViewBtnDisabled) {
      systemViewBtnDisabled = disabled
      if (disabled) {
        Material.setPbrMaterial(systemViewBtnEntity, {
          albedoColor: Color4.create(0.1, 0.1, 0.1, 1), emissiveColor: Color3.create(0.2, 0.2, 0.2), emissiveIntensity: 0.3
        })
        pointerEventsSystem.onPointerDown(
          { entity: systemViewBtnEntity, opts: { button: InputAction.IA_POINTER, hoverText: 'System View (Disabled - In Transit)', maxDistance: 8 } },
          () => {}
        )
      } else {
        Material.setPbrMaterial(systemViewBtnEntity, {
          albedoColor: Color4.create(0, 0.2, 0.3, 1), emissiveColor: Color3.create(0, 0.8, 1), emissiveIntensity: 1.5
        })
        pointerEventsSystem.onPointerDown(
          { entity: systemViewBtnEntity, opts: { button: InputAction.IA_POINTER, hoverText: 'System View', maxDistance: 8 } },
          () => switchViewMode('system')
        )
      }
    }
  }
}

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
}

export function clearMap(): void {
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
    currentScale = targetScale = 1.0
    currentHeight = targetHeight = FLOOR_Y + 1.0
    currentRotationY = targetRotationY = 0
  }
}
