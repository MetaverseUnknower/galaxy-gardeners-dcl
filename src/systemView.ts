import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, InputAction, pointerEventsSystem, ColliderLayer, Billboard, BillboardMode, MainCamera } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { getPlayer } from '@dcl/sdk/players'
import { movePlayerTo } from '~system/RestrictedActions'
import { setStareTime, playHawkingDrift, cancelHawkingDrift } from './hawkingDrift'

const SYSTEM_CENTER = Vector3.create(128, 41, 128)

let systemRoot: Entity | null = null
let systemAutoScale = 1.0

export function getSystemRoot(): Entity | null {
  return systemRoot
}

export function getSystemAutoScale(): number {
  return systemAutoScale
}

const staticEntities: Entity[] = []

interface OrbitingBody {
  entity: Entity
  centerX: number
  centerZ: number
  radius: number
  period: number
  phase: number
  tiltY: number
}

const orbitingPlanets: OrbitingBody[] = []
const orbitingMoons: OrbitingBody[] = []
const moonParentIndex: number[] = []
const orbitingRocks: OrbitingBody[] = []

let starEntity: Entity | null = null
let starGlowEntity: Entity | null = null
let systemTime = 0
let starBaseEmissive: Color3 = Color3.create(1, 0.9, 0.7)
let currentStationInfo: { name: string; origin: string; founded_by: string | null } | null = null

export function getStationInfo(): { name: string; origin: string; founded_by: string | null } | null {
  return currentStationInfo
}

// Selected body
export interface BodyInfo {
  type: 'planet' | 'moon' | 'belt'
  name: string
  id: string
  imageUrl?: string
  details: Record<string, string>
  beltRadius?: number
  canDeploy?: boolean
}

let selectedBody: BodyInfo | null = null
let selectedEntity: Entity | null = null
let selectionRingEntities: Entity[] = []
let onBodySelect: ((body: BodyInfo | null) => void) | null = null

// Pause state
let orbitsPaused = false
let pauseBlend = 0
const PAUSE_BLEND_SPEED = 3.0
const ALIGNED_ANGLE = Math.PI / 2
const MOON_ALIGNED_ANGLE = Math.PI

export function getSelectedBody(): BodyInfo | null { return selectedBody }
export function setBodySelectCallback(callback: (body: BodyInfo | null) => void): void { onBodySelect = callback }
export function toggleOrbits(): void { orbitsPaused = !orbitsPaused }
export function areOrbitsPaused(): boolean { return orbitsPaused }

export function selectBody(body: BodyInfo | null, entity?: Entity): void {
  selectedBody = body
  selectedEntity = entity || null
  clearSelectionRing()
  if (body && body.type === 'belt' && body.beltRadius) {
    createBeltSelectionRing(body.beltRadius)
    selectedEntity = null
  } else if (entity) {
    createSelectionRing(entity)
  }
  if (onBodySelect) onBodySelect(body)
}

function createSelectionRing(targetEntity: Entity): void {
  if (!systemRoot) return
  const targetTransform = Transform.get(targetEntity)
  const bodySize = Math.max(targetTransform.scale.x, targetTransform.scale.z)
  const ringRadius = bodySize + 0.08
  const dotSize = Math.max(0.02, bodySize * 0.15)
  const segments = 20
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const dot = engine.addEntity()
    Transform.create(dot, {
      position: Vector3.create(
        targetTransform.position.x + Math.cos(angle) * ringRadius,
        targetTransform.position.y,
        targetTransform.position.z + Math.sin(angle) * ringRadius
      ),
      scale: Vector3.create(dotSize, dotSize, dotSize), parent: systemRoot
    })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, { albedoColor: Color4.create(1, 1, 0, 1), emissiveColor: Color3.create(1, 1, 0), emissiveIntensity: 5 })
    selectionRingEntities.push(dot)
  }
  selectedEntity = targetEntity
}

function clearSelectionRing(): void {
  for (const entity of selectionRingEntities) engine.removeEntity(entity)
  selectionRingEntities = []
}

function createBeltSelectionRing(radius: number): void {
  if (!systemRoot) return
  const segments = 64
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const dot = engine.addEntity()
    Transform.create(dot, {
      position: Vector3.create(Math.cos(angle) * radius, 0, Math.sin(angle) * radius),
      scale: Vector3.create(0.03, 0.03, 0.03), parent: systemRoot
    })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, { albedoColor: Color4.create(1, 1, 0, 1), emissiveColor: Color3.create(1, 1, 0), emissiveIntensity: 5 })
    selectionRingEntities.push(dot)
  }
}

function getPlanetColor(type: string, supportsLife: boolean): { color: Color4; emissive: Color3 } {
  if (supportsLife) return { color: Color4.create(0.2, 0.8, 0.3, 1), emissive: Color3.create(0.2, 0.8, 0.3) }
  switch (type) {
    case 'gas_giant': return { color: Color4.create(0.8, 0.6, 0.3, 1), emissive: Color3.create(0.6, 0.4, 0.2) }
    case 'volcanic': return { color: Color4.create(1, 0.3, 0.1, 1), emissive: Color3.create(1, 0.3, 0.1) }
    case 'oceanic': return { color: Color4.create(0.1, 0.4, 0.9, 1), emissive: Color3.create(0.1, 0.4, 0.9) }
    case 'desert': return { color: Color4.create(0.9, 0.7, 0.3, 1), emissive: Color3.create(0.7, 0.5, 0.2) }
    case 'ice': return { color: Color4.create(0.7, 0.85, 1, 1), emissive: Color3.create(0.5, 0.7, 0.9) }
    case 'barren': return { color: Color4.create(0.5, 0.5, 0.5, 1), emissive: Color3.create(0.3, 0.3, 0.3) }
    case 'terrestrial': return { color: Color4.create(0.4, 0.6, 0.3, 1), emissive: Color3.create(0.3, 0.5, 0.2) }
    default: return { color: Color4.create(0.6, 0.6, 0.6, 1), emissive: Color3.create(0.4, 0.4, 0.4) }
  }
}

function getPlanetSize(type: string): number {
  switch (type) {
    case 'gas_giant': return 0.35; case 'oceanic': return 0.2; case 'terrestrial': return 0.18
    case 'volcanic': return 0.18; case 'desert': return 0.17; case 'ice': return 0.17; case 'barren': return 0.14
    default: return 0.18
  }
}

function getStarTypeColor(starType: string | null): { color: Color4; emissive: Color3 } {
  switch (starType) {
    case 'red_dwarf': return { color: Color4.create(1, 0.3, 0.2, 1), emissive: Color3.create(1, 0.3, 0.2) }
    case 'yellow_star': return { color: Color4.create(1, 0.95, 0.6, 1), emissive: Color3.create(1, 0.9, 0.5) }
    case 'blue_giant': return { color: Color4.create(0.5, 0.7, 1, 1), emissive: Color3.create(0.4, 0.6, 1) }
    case 'red_giant': return { color: Color4.create(1, 0.4, 0.2, 1), emissive: Color3.create(1, 0.4, 0.2) }
    case 'neutron_star': return { color: Color4.create(0.8, 0.8, 1, 1), emissive: Color3.create(0.8, 0.8, 1) }
    case 'black_hole': return { color: Color4.create(0.2, 0, 0.3, 1), emissive: Color3.create(0.3, 0, 0.5) }
    default: return { color: Color4.create(1, 0.95, 0.8, 1), emissive: Color3.create(1, 0.9, 0.7) }
  }
}

function createStarGlow(root: Entity, starSize: number, emissive: Color3): void {
  starGlowEntity = engine.addEntity()
  Transform.create(starGlowEntity, { position: Vector3.create(0, 0, 0), scale: Vector3.create(starSize * 2.5, starSize * 2.5, starSize * 2.5), parent: root })
  MeshRenderer.setSphere(starGlowEntity)
  Material.setPbrMaterial(starGlowEntity, {
    albedoColor: Color4.create(emissive.r, emissive.g, emissive.b, 0.06),
    emissiveColor: emissive, emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
}

// Black hole, drawn like the window sprite: on a pivot that always faces the viewer, a flat white accretion disk seen
// nearly edge-on (a thin band straight across, its near side passing in front of the horizon), plus the thin photon
// ring around the horizon. Both are bands of short segments, brightest nearest the hole.
const DISK_TILT_DEG = 10   // from edge-on: how much of the disk's top face shows
const DISK_BANDS: { r: number; width: number; intensity: number; alpha: number }[] = [
  { r: 1.45, width: 0.35, intensity: 8, alpha: 1 },
  { r: 1.9, width: 0.55, intensity: 4, alpha: 0.85 },
  { r: 2.5, width: 0.7, intensity: 2, alpha: 0.55 },
  { r: 3.2, width: 0.75, intensity: 1, alpha: 0.3 },
  { r: 3.9, width: 0.65, intensity: 0.5, alpha: 0.15 },
]
const HALO_BANDS: { r: number; width: number; intensity: number; alpha: number }[] = [
  { r: 1.12, width: 0.1, intensity: 8, alpha: 1 },
  { r: 1.3, width: 0.18, intensity: 2, alpha: 0.35 },
]
const RING_SEGMENTS = 64

// Staring into the black hole: STEM objects after STARE_WARNING_AT seconds on the horizon, and a player who keeps
// staring for STARE_SECONDS "loses" a few seconds and metres: they come to somewhere else on the deck, at about the
// same distance from the ship's centre, facing the hologram, and STEM explains (the veil and blackout: hawkingDrift.tsx).
let lastStareWarning = -1e9   // ms
let stareLine = 0
let staring = false
let stareTime = 0
const STARE_WARNING_MS = 20_000
const STARE_WARNING_AT = 5   // seconds of staring before STEM objects (the veil and drone start at 10: hawkingDrift.tsx)
const STARE_SECONDS = 15
const SHIP_CENTER = { x: 128, z: 128 }
const DECK_RADIUS = { min: 4, max: 10.5 }   // clear of the projector base and the desks at ~12.5m
const STARE_LINES = [
  "Captain, please don't stare directly into the black hole simulation. Prolonged viewing is linked to Hawking drift: crews start hearing their own thoughts a few seconds late.",
  "Eyes off the singularity, Captain. The hologram renders time dilation faithfully and the human visual cortex doesn't. Three freighter crews tried to count its frames. They're still counting.",
  "I'd look away, Captain. Staring into a simulated event horizon causes horizon fixation: the brain decides it's falling, and never quite agrees to stop.",
  "Regulation 7-G, Captain: no crew member may gaze into a black hole hologram for more than two seconds. The last navigator who did still insists we've already arrived.",
]
const HAWKING_DRIFT = "That was Hawking drift, Captain. Stare into an event horizon long enough and your sense of place " +
  "leaks out of it, the way radiation leaks from a real one. You just lost a few seconds and several metres. " +
  "The hologram is accurate enough to do it, so please don't look straight at it."
let blackHoleNotify: ((text: string) => void) | null = null
/** Where STEM's warnings about staring into the black hole go. */
export function setBlackHoleNotify(fn: (text: string) => void): void { blackHoleNotify = fn }

let hovering = false   // the engine's hover state (its leave can be missing, see stillLookingAtHorizon)
function startStare(): void {
  hovering = true
  staring = true
  stareTime = 0
}

function warnAboutStaring(): void {
  const now = Date.now()
  if (now - lastStareWarning < STARE_WARNING_MS) return
  lastStareWarning = now
  blackHoleNotify?.(STARE_LINES[stareLine++ % STARE_LINES.length])
}

// The engine drops hover-leaves when the view turns away without the pointer moving (the free camera: the pointer is
// the centre of the view), so there the stare also ends when the view no longer points at the horizon. In the
// console and top views the camera is fixed and the mouse moves, which does send hover-leaves.
let horizonRadius = 0.25   // in the system root's units
const LOOK_MARGIN = 1.5    // the horizon's apparent radius counts this much bigger, plus LOOK_SLACK_DEG
const LOOK_SLACK_DEG = 1.5
function stillLookingAtHorizon(): boolean {
  if (!systemRoot || MainCamera.getOrNull(engine.CameraEntity)?.virtualCameraEntity) return true   // fixed views: hover-leave decides
  const cam = Transform.getOrNull(engine.CameraEntity)
  const root = Transform.getOrNull(systemRoot)
  if (!cam || !root) return true
  const to = Vector3.subtract(root.position, cam.position)
  const dist = Vector3.length(to)
  if (dist < 0.01) return true
  const forward = Vector3.rotate(Vector3.Forward(), cam.rotation)
  const off = Math.acos(Math.max(-1, Math.min(1, Vector3.dot(forward, to) / dist))) * 180 / Math.PI
  const allowed = Math.atan((horizonRadius * root.scale.x * LOOK_MARGIN) / dist) * 180 / Math.PI + LOOK_SLACK_DEG
  return off <= allowed
}

let drifting = false
function stareSystem(dt: number): void {
  // Until the screen is fully black, looking away still calls the drift off
  if (drifting && (!hovering || !stillLookingAtHorizon()) && cancelHawkingDrift()) drifting = false
  if (!drifting && hovering) {
    const looking = stillLookingAtHorizon()
    if (staring && !looking) staring = false                       // looked away: the stare is off
    else if (!staring && looking) { staring = true; stareTime = 0 } // looked back (no fresh hover-enter comes): from zero
  }
  if (!staring || drifting) { setStareTime(null); return }
  const before = stareTime
  stareTime += dt
  setStareTime(stareTime)
  if (before < STARE_WARNING_AT && stareTime >= STARE_WARNING_AT) warnAboutStaring()
  if (stareTime < STARE_SECONDS) return
  staring = false
  drifting = true
  setStareTime(null)
  let recorded: Promise<api.HawkingDrift | null> = Promise.resolve(null)
  playHawkingDrift(() => {
    recorded = api.recordHawkingDrift().catch(() => null)   // the drift level wears off over days (server)
    const p = getPlayer()?.position
    if (!p) return
    const r = Math.max(DECK_RADIUS.min, Math.min(DECK_RADIUS.max, Math.hypot(p.x - SHIP_CENTER.x, p.z - SHIP_CENTER.z)))
    const a = Math.random() * Math.PI * 2
    void movePlayerTo({
      newRelativePosition: Vector3.create(SHIP_CENTER.x + Math.cos(a) * r, p.y, SHIP_CENTER.z + Math.sin(a) * r),
      cameraTarget: Vector3.create(SYSTEM_CENTER.x, SYSTEM_CENTER.y + 1.5, SYSTEM_CENTER.z),   // the hologram, not the hole
    })
  }, async () => {
    drifting = false
    hovering = false   // moved and facing away: only a fresh hover-enter starts another stare
    lastStareWarning = Date.now()   // the explanation stands in for the next warning
    const d = await recorded
    const tally = d && d.recent >= 2 ? ` That's ${d.recent} drifts in the last three days. They add up, Captain.` : ''
    blackHoleNotify?.(HAWKING_DRIFT + tally)
  })
}

function segmentMaterial(seg: Entity, intensity: number, alpha: number): void {
  Material.setPbrMaterial(seg, {
    albedoColor: Color4.create(1, 1, 1, alpha),
    emissiveColor: Color3.create(1, 1, 1),
    emissiveIntensity: intensity,
    transparencyMode: alpha < 1 ? MaterialTransparencyMode.MTM_ALPHA_BLEND : MaterialTransparencyMode.MTM_OPAQUE,
    castShadows: false,
  })
}

function createAccretionRing(root: Entity, horizon: Entity, radius: number): void {
  horizonRadius = radius
  const pivot = engine.addEntity()
  Transform.create(pivot, { position: Vector3.create(0, 0, 0), parent: root })
  Billboard.create(pivot, { billboardMode: BillboardMode.BM_ALL })
  staticEntities.push(pivot)
  MeshCollider.setSphere(horizon, ColliderLayer.CL_POINTER)
  // No hover outline or feedback: nothing should invite a closer look
  const quiet = { showFeedback: false, showHighlight: false }
  pointerEventsSystem.onPointerHoverEnter({ entity: horizon, opts: quiet }, () => startStare())
  pointerEventsSystem.onPointerHoverLeave({ entity: horizon, opts: quiet }, () => { hovering = false; staring = false })

  // Photon ring: face-on circles around the horizon (the pivot's XY plane faces the viewer)
  for (const band of HALO_BANDS) {
    const r = band.r * horizonRadius
    const arc = (2 * Math.PI * r / RING_SEGMENTS) * 1.08   // slight overlap: no gaps between segments
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2
      const seg = engine.addEntity()
      Transform.create(seg, {
        position: Vector3.create(Math.cos(a) * r, Math.sin(a) * r, 0),
        rotation: Quaternion.fromEulerDegrees(0, 0, a * 180 / Math.PI + 90),
        scale: Vector3.create(arc, band.width * horizonRadius, 0.005),
        parent: pivot,
      })
      MeshRenderer.setBox(seg)
      segmentMaterial(seg, band.intensity, band.alpha)
      staticEntities.push(seg)
    }
  }

  // Accretion disk: flat annuli in a plane tipped DISK_TILT_DEG toward the viewer from edge-on
  const disk = engine.addEntity()
  Transform.create(disk, { position: Vector3.create(0, 0, 0), rotation: Quaternion.fromEulerDegrees(-DISK_TILT_DEG, 0, 0), parent: pivot })
  staticEntities.push(disk)
  for (const band of DISK_BANDS) {
    const r = band.r * horizonRadius
    const arc = (2 * Math.PI * r / RING_SEGMENTS) * 1.08
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const a = (i / RING_SEGMENTS) * Math.PI * 2
      const seg = engine.addEntity()
      Transform.create(seg, {
        position: Vector3.create(Math.cos(a) * r, 0, Math.sin(a) * r),
        rotation: Quaternion.fromEulerDegrees(0, -(a * 180 / Math.PI + 90), 0),   // long side along the circle
        scale: Vector3.create(arc, 0.004, band.width * horizonRadius),
        parent: disk,
      })
      MeshRenderer.setBox(seg)
      segmentMaterial(seg, band.intensity, band.alpha)
      staticEntities.push(seg)
    }
  }
}

function orbitPeriod(slot: number): number { return 60 * Math.pow(slot, 1.3) }
export function orbitalRadius(slot: number, starType: string | null): number {
  const baseRadius = starType === 'black_hole' ? 3.5 : 1.5
  return baseRadius + (slot - 1) * 1.8
}

// A survey of a visited system other than the ship's: the same hologram, but nothing can be deployed from afar.
let readOnlyView = false
// Which system is on show (the 2D survey bar names it) and how to get back to the ship's own system.
let viewTitle = ''
let returnToOwnSystem: (() => void) | null = null
let ownSystemName = ''
/** What surveys return to: `fn` shows the ship's own system again; `name` is that system's name. */
export function setSurveyReturn(fn: () => void, name: string): void { returnToOwnSystem = fn; ownSystemName = name }
export function viewedSystemName(): string { return viewTitle }
export function ownSystemTitle(): string { return ownSystemName }
export function returnFromSurvey(): void { returnToOwnSystem?.() }
/** True while the hologram shows a system the ship isn't in (read-only survey). */
export function isViewingRemoteSystem(): boolean { return readOnlyView && starEntity !== null }

export async function renderSystemView(systemId: string, opts: { readOnly?: boolean; title?: string } = {}): Promise<void> {
  clearSystemView()
  readOnlyView = !!opts.readOnly
  viewTitle = opts.title ?? ''
  systemTime = 0

  let detail: any
  try { detail = await api.getSystemDetail(systemId) } catch { return }

  const sysData = detail.system || detail
  const starType = sysData.star_type || null
  const planets = detail.planets || []
  const belts = detail.asteroidBelts || []
  const maxSlot = planets.length > 0 ? Math.max(...planets.map((p: any) => p.orbital_slot)) : 1

  // Calculate max extent of the system to auto-scale it to fit
  let maxExtent = 2 // minimum for star
  for (const p of planets) {
    const r = orbitalRadius(p.orbital_slot, starType)
    if (r > maxExtent) maxExtent = r
  }
  // Belt radii
  const habitableSlot = Math.max(2, Math.min(Math.floor(maxSlot / 2) + 1, 4))
  for (let i = 0; i < belts.length; i++) {
    let beltR: number
    if (i === 0) beltR = orbitalRadius(habitableSlot, starType) + 0.9
    else if (i === 1) beltR = orbitalRadius(maxSlot, starType) + 2.5
    else beltR = orbitalRadius(Math.max(1, habitableSlot - (belts.length - i)), starType) + 0.9
    if (beltR > maxExtent) maxExtent = beltR
  }
  // Add padding
  maxExtent += 0.5

  // Scale to fit within target radius (MAP_RADIUS = 6)
  const targetRadius = 8.0
  const autoScale = maxExtent > targetRadius ? targetRadius / maxExtent : 1.0

  systemAutoScale = autoScale
  systemRoot = engine.addEntity()
  Transform.create(systemRoot, { position: SYSTEM_CENTER, scale: Vector3.create(0, 0, 0) })
  const starColor = getStarTypeColor(starType)
  starBaseEmissive = starColor.emissive

  const starSize = starType === 'red_giant' ? 0.7 : starType === 'blue_giant' ? 0.6 : 0.5
  starEntity = engine.addEntity()
  Transform.create(starEntity, { position: Vector3.create(0, 0, 0), scale: Vector3.create(starSize, starSize, starSize), parent: systemRoot })
  MeshRenderer.setSphere(starEntity)
  if (starType === 'black_hole') {
    // A black event horizon inside a white accretion ring that always faces the viewer
    Material.setPbrMaterial(starEntity, { albedoColor: Color4.create(0, 0, 0, 1), emissiveColor: Color3.create(0, 0, 0), emissiveIntensity: 0, metallic: 0, roughness: 1 })
    createAccretionRing(systemRoot, starEntity, starSize / 2)
  } else {
    Material.setPbrMaterial(starEntity, { albedoColor: starColor.color, emissiveColor: starColor.emissive, emissiveIntensity: 5 })
    createStarGlow(systemRoot, starSize, starColor.emissive)
  }

  for (let pIdx = 0; pIdx < planets.length; pIdx++) {
    const planet = planets[pIdx]
    try {
      const orbitR = orbitalRadius(planet.orbital_slot, starType)
      const { color, emissive } = getPlanetColor(planet.planet_type, planet.supports_life)
      const size = getPlanetSize(planet.planet_type)
      const period = orbitPeriod(planet.orbital_slot)
      const phase = Math.random() * Math.PI * 2

      // Orbit ring
      const segments = 48
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2
        const dot = engine.addEntity()
        Transform.create(dot, {
          position: Vector3.create(Math.cos(angle) * orbitR, 0, Math.sin(angle) * orbitR),
          scale: Vector3.create(0.012, 0.012, 0.012), parent: systemRoot
        })
        MeshRenderer.setSphere(dot)
        Material.setPbrMaterial(dot, {
          albedoColor: Color4.create(0.3, 0.5, 0.6, 0.5), emissiveColor: Color3.create(0.2, 0.4, 0.5),
          emissiveIntensity: 1.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
        })
        staticEntities.push(dot)
      }

      const planetEntity = engine.addEntity()
      Transform.create(planetEntity, {
        position: Vector3.create(Math.cos(phase) * orbitR, 0, Math.sin(phase) * orbitR),
        scale: Vector3.create(size, size, size), parent: systemRoot
      })
      MeshRenderer.setSphere(planetEntity)
      MeshCollider.setSphere(planetEntity, ColliderLayer.CL_POINTER)
      Material.setPbrMaterial(planetEntity, { albedoColor: color, emissiveColor: emissive, emissiveIntensity: 2 })

      const isBarren = planet.planet_type === 'barren'
      const planetDetails: Record<string, string> = { 'Type': (planet.planet_type || 'unknown').replace(/_/g, ' '), 'Zone': (planet.orbital_zone || 'unknown').replace(/_/g, ' ') }
      if (!isBarren) {
        planetDetails['Life'] = planet.supports_life ? 'Supported' : 'None detected'
        planetDetails['Risk'] = (planet.risk_tier || 'unknown').replace(/_/g, ' ')
        if (planet.base_expedition_minutes) {
          const hrs = Math.floor(planet.base_expedition_minutes / 60); const mins = planet.base_expedition_minutes % 60
          planetDetails['Expedition'] = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
        }
      } else { planetDetails['Status'] = 'Unexplorable' }
      planetDetails['Moons'] = `${(planet.moons || []).length}`

      const planetInfo: BodyInfo = { type: 'planet', name: planet.name, id: planet.id, imageUrl: planet.image_url || undefined, details: planetDetails, canDeploy: planet.supports_life && !isBarren && !readOnlyView }
      pointerEventsSystem.onPointerDown(
        { entity: planetEntity, opts: { button: InputAction.IA_POINTER, hoverText: planet.name, maxDistance: 20 } },
        () => selectBody(planetInfo, planetEntity)
      )

      const parentPlanetIndex = orbitingPlanets.length
      orbitingPlanets.push({ entity: planetEntity, centerX: 0, centerZ: 0, radius: orbitR, period, phase, tiltY: 0 })

      // Moons
      const moons = planet.moons || []
      for (const moon of moons) {
        const moonOrbitR = size + 0.15 + moon.ordinal * 0.12
        const moonPeriod = 15 + moon.ordinal * 5
        const moonPhase = Math.random() * Math.PI * 2

        const moonEntity = engine.addEntity()
        Transform.create(moonEntity, {
          position: Vector3.create(Math.cos(phase) * orbitR + Math.cos(moonPhase) * moonOrbitR, 0, Math.sin(phase) * orbitR + Math.sin(moonPhase) * moonOrbitR),
          scale: Vector3.create(0.06, 0.06, 0.06), parent: systemRoot
        })
        MeshRenderer.setSphere(moonEntity)
        MeshCollider.setSphere(moonEntity, ColliderLayer.CL_POINTER)
        Material.setPbrMaterial(moonEntity, { albedoColor: Color4.create(0.65, 0.65, 0.6, 1), emissiveColor: Color3.create(0.4, 0.4, 0.35), emissiveIntensity: 1.5 })

        const moonDetails: Record<string, string> = {
          'Type': (moon.moon_type || 'rocky moon').replace(/_/g, ' '),
          'Atmosphere': (moon.atmosphere || 'none').replace(/_/g, ' '),
          'Temperature': (moon.temperature || 'unknown').replace(/_/g, ' '),
        }
        if (moon.supports_life) moonDetails['Life'] = 'Supported'
        moonDetails['Risk'] = (moon.risk_tier || 'unknown').replace(/_/g, ' ')
        if (moon.base_expedition_minutes) {
          const hrs = Math.floor(moon.base_expedition_minutes / 60); const mins = moon.base_expedition_minutes % 60
          moonDetails['Expedition'] = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`
        }
        const moonInfo: BodyInfo = { type: 'moon', name: moon.name, id: moon.id, imageUrl: moon.image_url || undefined, details: moonDetails, canDeploy: !readOnlyView }
        pointerEventsSystem.onPointerDown(
          { entity: moonEntity, opts: { button: InputAction.IA_POINTER, hoverText: moon.name, maxDistance: 20 } },
          () => selectBody(moonInfo, moonEntity)
        )

        orbitingMoons.push({ entity: moonEntity, centerX: 0, centerZ: 0, radius: moonOrbitR, period: moonPeriod, phase: moonPhase, tiltY: (moon.ordinal * 5) * Math.PI / 180 })
        moonParentIndex.push(parentPlanetIndex)
      }
    } catch (err) { console.error(`[systemView] planet ${pIdx} error:`, err) }
  }

  // Asteroid belts
  for (let beltIdx = 0; beltIdx < belts.length; beltIdx++) {
    const belt = belts[beltIdx]
    const riskLevel: string = belt.risk_level || 'low'
    let rockCount: number; let beltWidth: number
    switch (riskLevel) {
      case 'low': rockCount = 25; beltWidth = 0.3; break; case 'medium': rockCount = 50; beltWidth = 0.4; break
      case 'high': rockCount = 80; beltWidth = 0.5; break; case 'extreme': rockCount = 120; beltWidth = 0.6; break
      default: rockCount = 35; beltWidth = 0.35; break
    }
    const habitableSlot = Math.max(2, Math.min(Math.floor(maxSlot / 2) + 1, 4))
    let beltOrbitR: number
    if (beltIdx === 0) beltOrbitR = orbitalRadius(habitableSlot, starType) + 0.9
    else if (beltIdx === 1) beltOrbitR = orbitalRadius(maxSlot, starType) + 2.5
    else beltOrbitR = orbitalRadius(Math.max(1, habitableSlot - (belts.length - beltIdx)), starType) + 0.9

    const beltPeriod = 800 + beltIdx * 400
    const riskColors: Record<string, { color: Color4; emissive: Color3 }> = {
      low: { color: Color4.create(0.5, 0.45, 0.4, 1), emissive: Color3.create(0.25, 0.22, 0.18) },
      medium: { color: Color4.create(0.5, 0.4, 0.3, 1), emissive: Color3.create(0.3, 0.25, 0.15) },
      high: { color: Color4.create(0.55, 0.35, 0.25, 1), emissive: Color3.create(0.4, 0.2, 0.1) },
      extreme: { color: Color4.create(0.6, 0.3, 0.2, 1), emissive: Color3.create(0.5, 0.15, 0.1) },
    }
    const rockStyle = riskColors[riskLevel] || riskColors['low']
    const beltExpMins = belt.base_expedition_minutes || 0
    const beltHrs = Math.floor(beltExpMins / 60); const beltMins = beltExpMins % 60
    const beltInfo: BodyInfo = {
      type: 'belt', name: belt.name, id: belt.id, beltRadius: beltOrbitR, canDeploy: !readOnlyView,
      details: { 'Risk': riskLevel.replace(/_/g, ' '), 'Expedition': beltExpMins > 0 ? (beltHrs > 0 ? `${beltHrs}h ${beltMins}m` : `${beltMins}m`) : 'N/A' }
    }

    for (let i = 0; i < rockCount; i++) {
      const angle = (i / rockCount) * Math.PI * 2 + Math.random() * (Math.PI * 2 / rockCount)
      const radiusJitter = beltOrbitR + (Math.random() - 0.5) * beltWidth
      const rockSize = 0.04 + Math.random() * 0.06
      const rock = engine.addEntity()
      Transform.create(rock, {
        position: Vector3.create(Math.cos(angle) * radiusJitter, (Math.random() - 0.5) * 0.1, Math.sin(angle) * radiusJitter),
        scale: Vector3.create(rockSize, rockSize * 0.6, rockSize),
        rotation: Quaternion.fromEulerDegrees(Math.random() * 360, Math.random() * 360, Math.random() * 360), parent: systemRoot
      })
      MeshRenderer.setBox(rock)
      MeshCollider.setBox(rock, ColliderLayer.CL_POINTER)
      Material.setPbrMaterial(rock, { albedoColor: rockStyle.color, emissiveColor: rockStyle.emissive, emissiveIntensity: 1.5 })
      pointerEventsSystem.onPointerDown(
        { entity: rock, opts: { button: InputAction.IA_POINTER, hoverText: belt.name, maxDistance: 20 } },
        () => selectBody(beltInfo, rock)
      )
      orbitingRocks.push({ entity: rock, centerX: 0, centerZ: 0, radius: radiusJitter, period: beltPeriod, phase: angle, tiltY: (Math.random() - 0.5) * 0.04 })
    }
  }

  currentStationInfo = detail.station || null
  if (onStationChanged) onStationChanged()
}

export function systemViewAnimationSystem(dt: number): void {
  if (orbitingPlanets.length === 0 && !starEntity) return
  stareSystem(dt)
  const pauseTarget = orbitsPaused ? 1 : 0
  if (Math.abs(pauseBlend - pauseTarget) > 0.001) pauseBlend += (pauseTarget - pauseBlend) * (1 - Math.exp(-PAUSE_BLEND_SPEED * dt))
  else pauseBlend = pauseTarget
  if (pauseBlend < 0.999) systemTime += dt * (1 - pauseBlend)

  if (starGlowEntity && systemRoot) {
    const pulse = 0.5 + 0.5 * Math.sin(systemTime * 2)
    const s = 1.2 + pulse * 0.3
    Transform.createOrReplace(starGlowEntity, { position: Vector3.create(0, 0, 0), scale: Vector3.create(s, s, s), parent: systemRoot })
    Material.setPbrMaterial(starGlowEntity, {
      albedoColor: Color4.create(starBaseEmissive.r, starBaseEmissive.g, starBaseEmissive.b, 0.04 + pulse * 0.04),
      emissiveColor: starBaseEmissive, emissiveIntensity: 1.5 + pulse, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
  }

  for (const body of orbitingPlanets) {
    const orbitAngle = body.phase + (systemTime / body.period) * Math.PI * 2
    const angle = orbitAngle * (1 - pauseBlend) + ALIGNED_ANGLE * pauseBlend
    const transform = Transform.getMutable(body.entity)
    transform.position = Vector3.create(body.centerX + Math.cos(angle) * body.radius, 0, body.centerZ + Math.sin(angle) * body.radius)
  }

  for (let mIdx = 0; mIdx < orbitingMoons.length; mIdx++) {
    const moon = orbitingMoons[mIdx]
    const parentIdx = moonParentIndex[mIdx]
    if (parentIdx === undefined || parentIdx >= orbitingPlanets.length) continue
    const parentTransform = Transform.get(orbitingPlanets[parentIdx].entity)
    const orbitMoonAngle = moon.phase + (systemTime / moon.period) * Math.PI * 2
    const moonAngle = orbitMoonAngle * (1 - pauseBlend) + MOON_ALIGNED_ANGLE * pauseBlend
    const transform = Transform.getMutable(moon.entity)
    transform.position = Vector3.create(
      parentTransform.position.x + Math.cos(moonAngle) * moon.radius,
      parentTransform.position.y + Math.sin(moon.tiltY) * Math.sin(moonAngle) * 0.05,
      parentTransform.position.z + Math.sin(moonAngle) * moon.radius
    )
  }

  for (const rock of orbitingRocks) {
    const angle = rock.phase + (systemTime / rock.period) * Math.PI * 2
    const transform = Transform.getMutable(rock.entity)
    transform.position = Vector3.create(rock.centerX + Math.cos(angle) * rock.radius, rock.tiltY + Math.sin(systemTime * 0.3 + rock.phase) * 0.02, rock.centerZ + Math.sin(angle) * rock.radius)
  }

  // Update selection ring
  if (selectedEntity && selectionRingEntities.length > 0 && systemRoot) {
    const targetPos = Transform.get(selectedEntity).position
    const targetScale = Transform.get(selectedEntity).scale
    const bodySize = Math.max(targetScale.x, targetScale.z)
    const ringRadius = bodySize + 0.08
    for (let i = 0; i < selectionRingEntities.length; i++) {
      const angle = (i / selectionRingEntities.length) * Math.PI * 2
      const transform = Transform.getMutable(selectionRingEntities[i])
      transform.position = Vector3.create(targetPos.x + Math.cos(angle) * ringRadius, targetPos.y, targetPos.z + Math.sin(angle) * ringRadius)
    }
  }

}

// The navigation console draws the station card; it is told when the station changes.
let onStationChanged: (() => void) | null = null
export function setStationChangedListener(cb: () => void): void { onStationChanged = cb }

export function clearSystemView(): void {
  selectBody(null); clearSelectionRing()
  orbitsPaused = false; pauseBlend = 0
  for (const entity of staticEntities) engine.removeEntity(entity); staticEntities.length = 0
  for (const body of orbitingPlanets) engine.removeEntity(body.entity); orbitingPlanets.length = 0
  for (const moon of orbitingMoons) engine.removeEntity(moon.entity); orbitingMoons.length = 0; moonParentIndex.length = 0
  for (const rock of orbitingRocks) engine.removeEntity(rock.entity); orbitingRocks.length = 0
  if (starEntity) {
    pointerEventsSystem.removeOnPointerHoverEnter(starEntity); pointerEventsSystem.removeOnPointerHoverLeave(starEntity)
    engine.removeEntity(starEntity); starEntity = null
  }
  staring = false
  hovering = false
  if (starGlowEntity) { engine.removeEntity(starGlowEntity); starGlowEntity = null }
  currentStationInfo = null
  if (onStationChanged) onStationChanged()
  if (systemRoot) { engine.removeEntity(systemRoot); systemRoot = null }
  systemTime = 0
}

export function isSystemViewActive(): boolean { return starEntity !== null }
