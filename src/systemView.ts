import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, InputAction, pointerEventsSystem, TextShape, Font, TextAlignMode, ColliderLayer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { PANEL_Z, PANEL_Y, PANEL_TILT, PANEL_CENTER_X, GLASS_PANEL_Z, GLASS_PANEL_Y } from './galaxyMap'

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
const ALIGNED_ANGLE = Math.PI
const MOON_ALIGNED_ANGLE = Math.PI / 2

export function getSelectedBody(): BodyInfo | null { return selectedBody }
export function setBodySelectCallback(callback: (body: BodyInfo | null) => void): void { onBodySelect = callback }
export function toggleOrbits(): void { orbitsPaused = !orbitsPaused }
export function areOrbitsPaused(): boolean { return orbitsPaused }

function selectBody(body: BodyInfo | null, entity?: Entity): void {
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

function orbitPeriod(slot: number): number { return 60 * Math.pow(slot, 1.3) }
function orbitalRadius(slot: number, starType: string | null): number {
  const baseRadius = starType === 'black_hole' ? 3.5 : 1.5
  return baseRadius + (slot - 1) * 1.8
}

export async function renderSystemView(systemId: string): Promise<void> {
  clearSystemView()
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
  Material.setPbrMaterial(starEntity, { albedoColor: starColor.color, emissiveColor: starColor.emissive, emissiveIntensity: 5 })

  starGlowEntity = engine.addEntity()
  Transform.create(starGlowEntity, { position: Vector3.create(0, 0, 0), scale: Vector3.create(starSize * 2.5, starSize * 2.5, starSize * 2.5), parent: systemRoot })
  MeshRenderer.setSphere(starGlowEntity)
  Material.setPbrMaterial(starGlowEntity, {
    albedoColor: Color4.create(starColor.emissive.r, starColor.emissive.g, starColor.emissive.b, 0.06),
    emissiveColor: starColor.emissive, emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })

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
      if ((planet.moons || []).length > 0) planetDetails['Moons'] = `${(planet.moons || []).length}`

      const planetInfo: BodyInfo = { type: 'planet', name: planet.name, id: planet.id, imageUrl: planet.image_url || undefined, details: planetDetails, canDeploy: planet.supports_life && !isBarren }
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
        const moonInfo: BodyInfo = { type: 'moon', name: moon.name, id: moon.id, imageUrl: moon.image_url || undefined, details: moonDetails, canDeploy: true }
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
      type: 'belt', name: belt.name, id: belt.id, beltRadius: beltOrbitR, canDeploy: true,
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
  try { createStationPanel() } catch (err) { console.error('[systemView] station panel error:', err) }
}

export function systemViewAnimationSystem(dt: number): void {
  if (orbitingPlanets.length === 0 && !starEntity) return
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

  if (stationPanelEntity) {
    stationPanelScale = Math.min(1, stationPanelScale + dt * 3)
    const s = stationPanelScale
    Transform.getMutable(stationPanelEntity).scale = Vector3.create(1.5 * s, 0.6 * s, 0.03)
  }

  if (pauseTextEntity) {
    const ts = TextShape.getMutable(pauseTextEntity)
    ts.text = orbitsPaused ? 'RESUME' : 'PAUSE'
  }
}

// Station panel
let stationPanelEntity: Entity | null = null
let stationPanelScale = 0
const stationPanelEntities: Entity[] = []
let pauseButtonEntity: Entity | null = null
let pauseTextEntity: Entity | null = null

function createStationPanel(): void {
  clearStationPanel()
  stationPanelScale = 0

  const panelX = PANEL_CENTER_X() - 1.8
  const panelY = PANEL_Y()
  const btnZ = PANEL_Z()
  const glassZ = GLASS_PANEL_Z()
  const glassY = GLASS_PANEL_Y()
  const panelTilt = PANEL_TILT()
  const textRotation = Quaternion.fromEulerDegrees(30, 180, 0)
  const upY = 0.3 * Math.cos(30 * Math.PI / 180)
  const upZ = -0.3 * Math.sin(30 * Math.PI / 180)

  stationPanelEntity = engine.addEntity()
  Transform.create(stationPanelEntity, { position: Vector3.create(panelX, glassY, glassZ), scale: Vector3.create(0, 0, 0.03), rotation: panelTilt })
  MeshRenderer.setBox(stationPanelEntity)
  Material.setPbrMaterial(stationPanelEntity, {
    albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4),
    emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  stationPanelEntities.push(stationPanelEntity)

  if (currentStationInfo) {
    const nameLabel = engine.addEntity()
    Transform.create(nameLabel, { position: Vector3.create(panelX, panelY + upY, btnZ + upZ), rotation: textRotation })
    TextShape.create(nameLabel, { text: currentStationInfo.name, fontSize: 1, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    stationPanelEntities.push(nameLabel)

    const dockBtn = engine.addEntity()
    Transform.create(dockBtn, { position: Vector3.create(panelX, panelY, btnZ), scale: Vector3.create(0.6, 0.25, 0.06), rotation: panelTilt })
    MeshRenderer.setBox(dockBtn); MeshCollider.setBox(dockBtn)
    Material.setPbrMaterial(dockBtn, { albedoColor: Color4.create(0, 0.3, 0.4, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
    pointerEventsSystem.onPointerDown({ entity: dockBtn, opts: { button: InputAction.IA_POINTER, hoverText: `Dock at ${currentStationInfo.name}`, maxDistance: 15 } }, () => { console.log('Dock') })
    stationPanelEntities.push(dockBtn)

    const dockLabel = engine.addEntity()
    Transform.create(dockLabel, { position: Vector3.create(panelX, panelY, btnZ + 0.04), rotation: textRotation })
    TextShape.create(dockLabel, { text: 'DOCK', fontSize: 1, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    stationPanelEntities.push(dockLabel)
  } else {
    const titleLabel = engine.addEntity()
    Transform.create(titleLabel, { position: Vector3.create(panelX, panelY + upY, btnZ + upZ), rotation: textRotation })
    TextShape.create(titleLabel, { text: 'SPACE STATION', fontSize: 1, textColor: Color4.create(0.6, 0.6, 0.6, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    stationPanelEntities.push(titleLabel)

    const buildBtn = engine.addEntity()
    Transform.create(buildBtn, { position: Vector3.create(panelX, panelY, btnZ), scale: Vector3.create(0.6, 0.25, 0.06), rotation: panelTilt })
    MeshRenderer.setBox(buildBtn); MeshCollider.setBox(buildBtn)
    Material.setPbrMaterial(buildBtn, { albedoColor: Color4.create(0, 0.3, 0.4, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
    pointerEventsSystem.onPointerDown({ entity: buildBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Build Station', maxDistance: 15 } }, () => { console.log('Build') })
    stationPanelEntities.push(buildBtn)

    const buildLabel = engine.addEntity()
    Transform.create(buildLabel, { position: Vector3.create(panelX, panelY, btnZ + 0.04), rotation: textRotation })
    TextShape.create(buildLabel, { text: 'BUILD', fontSize: 1, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    stationPanelEntities.push(buildLabel)
  }

  // Pause button
  const pauseBtnX = PANEL_CENTER_X() + 1.8
  pauseButtonEntity = engine.addEntity()
  Transform.create(pauseButtonEntity, { position: Vector3.create(pauseBtnX, PANEL_Y(), PANEL_Z()), scale: Vector3.create(0.6, 0.25, 0.06), rotation: PANEL_TILT() })
  MeshRenderer.setBox(pauseButtonEntity); MeshCollider.setBox(pauseButtonEntity)
  Material.setPbrMaterial(pauseButtonEntity, { albedoColor: Color4.create(0, 0.3, 0.4, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
  pointerEventsSystem.onPointerDown({ entity: pauseButtonEntity, opts: { button: InputAction.IA_POINTER, hoverText: 'Pause/Resume Orbits', maxDistance: 15 } }, () => toggleOrbits())
  stationPanelEntities.push(pauseButtonEntity)

  pauseTextEntity = engine.addEntity()
  Transform.create(pauseTextEntity, { position: Vector3.create(pauseBtnX, PANEL_Y(), PANEL_Z() + 0.04), rotation: textRotation })
  TextShape.create(pauseTextEntity, { text: 'PAUSE', fontSize: 1, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  stationPanelEntities.push(pauseTextEntity)
}

function clearStationPanel(): void {
  for (const entity of stationPanelEntities) engine.removeEntity(entity)
  stationPanelEntities.length = 0
  stationPanelEntity = null; stationPanelScale = 0; pauseButtonEntity = null; pauseTextEntity = null
}

export function clearSystemView(): void {
  selectBody(null); clearSelectionRing(); clearStationPanel()
  orbitsPaused = false; pauseBlend = 0
  for (const entity of staticEntities) engine.removeEntity(entity); staticEntities.length = 0
  for (const body of orbitingPlanets) engine.removeEntity(body.entity); orbitingPlanets.length = 0
  for (const moon of orbitingMoons) engine.removeEntity(moon.entity); orbitingMoons.length = 0; moonParentIndex.length = 0
  for (const rock of orbitingRocks) engine.removeEntity(rock.entity); orbitingRocks.length = 0
  if (starEntity) { engine.removeEntity(starEntity); starEntity = null }
  if (starGlowEntity) { engine.removeEntity(starGlowEntity); starGlowEntity = null }
  currentStationInfo = null
  if (systemRoot) { engine.removeEntity(systemRoot); systemRoot = null }
  systemTime = 0
}

export function isSystemViewActive(): boolean { return starEntity !== null }
