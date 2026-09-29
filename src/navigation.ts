import { StarSystem } from './types'
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { TravelStatus } from './types'
import { starEntities, getGalaxyRoot, addMapRenderHooks, hideCurrentLocationMarker } from './galaxyMap'

let routeLineEntities: Entity[] = []    // star-selection preview
let travelLineEntities: Entity[] = []   // the route of the trip in progress (kept apart from previews)
let destinationId: string | null = null
let travelMarkerEntity: Entity | null = null
let isTraveling = false
let travelStartTime = 0
let travelEndTime = 0
let originPosition: Vector3 | null = null
let destinationPosition: Vector3 | null = null
let travelMarkerRotation = 0
let currentProgress = 0
let totalTravelDistance = 0
let destinationSystem: StarSystem | null = null

/** The system being travelled to (null when not travelling or not yet known). */
export function getTravelDestination(): StarSystem | null { return isTraveling ? destinationSystem : null }
/** 0 at departure → 1 at arrival, from the server's start and end times (independent of the map marker). */
export function getTravelFraction(): number {
  if (!isTraveling || travelEndTime <= travelStartTime) return 0
  return Math.max(0, Math.min(1, (Date.now() - travelStartTime) / (travelEndTime - travelStartTime)))
}

/** Milliseconds until arrival from the server's end time (0 when not travelling or already due). */
export function getTravelRemainingMs(): number {
  return isTraveling ? Math.max(0, travelEndTime - Date.now()) : 0
}

// Fuel is charged in full at departure; the server also sends the fuel at departure and on arrival so the gauges
// can burn it down over the trip instead of dropping all at once.
let travelFuelStart: number | null = null
let travelFuelEnd: number | null = null

/** The fuel to show right now: the server's value (already charged for the whole trip) plus the part of the
 *  trip's burn still ahead. Anything added mid-trip (refining, purchases) stays on top. Never more than the tank
 *  holds: a desk still holding the pre-departure value would otherwise add the burn twice (299/150). */
export function displayedFuel(serverFuel: number, capacity: number = Infinity): number {
  if (!isTraveling || travelFuelStart === null || travelFuelEnd === null) return serverFuel
  return Math.min(capacity, serverFuel + Math.max(0, travelFuelStart - travelFuelEnd) * (1 - getTravelFraction()))
}

// The desks refresh on departure, so they read the fuel the server just charged
const departureListeners: (() => void)[] = []
export function onDeparture(fn: () => void): void { departureListeners.push(fn) }

export function isCurrentlyTraveling(): boolean {
  return isTraveling
}

export function getTravelProgress(): { progress: number; remainingDistance: number } {
  return {
    progress: currentProgress,
    remainingDistance: totalTravelDistance * (1 - currentProgress)
  }
}

/** Preview line from here to a selected star. Never touches the travel route. */
export function drawRouteLine(fromPos: Vector3, toPos: Vector3): void {
  clearRouteLines()
  routeLineEntities.push(makeLine(fromPos, toPos, Color4.create(0, 1, 1, 0.4), Color3.create(0, 0.8, 0.8)))
}

function drawTravelLine(fromPos: Vector3, toPos: Vector3): void {
  clearTravelLine()
  travelLineEntities.push(makeLine(fromPos, toPos, Color4.create(0, 1, 0.5, 0.55), Color3.create(0, 1, 0.5)))
}

function clearTravelLine(): void {
  for (const e of travelLineEntities) engine.removeEntity(e)
  travelLineEntities = []
}

function makeLine(fromPos: Vector3, toPos: Vector3, albedo: Color4, emissive: Color3): Entity {

  const midpoint = Vector3.create(
    (fromPos.x + toPos.x) / 2,
    (fromPos.y + toPos.y) / 2,
    (fromPos.z + toPos.z) / 2
  )

  const dx = toPos.x - fromPos.x
  const dy = toPos.y - fromPos.y
  const dz = toPos.z - fromPos.z
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  const entity = engine.addEntity()

  const direction = Vector3.normalize(Vector3.create(dx, dy, dz))
  const yAxis = Vector3.create(0, 1, 0)
  const dot = Vector3.dot(yAxis, direction)
  let rotation: { x: number; y: number; z: number; w: number }

  if (dot > 0.9999) {
    rotation = Quaternion.Identity()
  } else if (dot < -0.9999) {
    rotation = Quaternion.fromEulerDegrees(180, 0, 0)
  } else {
    const axis = Vector3.normalize(Vector3.cross(yAxis, direction))
    const angle = Math.acos(dot)
    const halfAngle = angle / 2
    const sinHalf = Math.sin(halfAngle)
    rotation = { x: axis.x * sinHalf, y: axis.y * sinHalf, z: axis.z * sinHalf, w: Math.cos(halfAngle) }
  }

  Transform.create(entity, {
    position: midpoint,
    scale: Vector3.create(0.015, length, 0.015),
    rotation,
    parent: getGalaxyRoot()
  })
  MeshRenderer.setCylinder(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: albedo,
    emissiveColor: emissive,
    emissiveIntensity: 2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  return entity
}

export function clearRouteLines(): void {
  for (const entity of routeLineEntities) {
    engine.removeEntity(entity)
  }
  routeLineEntities = []
}

function createTravelMarker(position: Vector3): void {
  if (travelMarkerEntity) {
    engine.removeEntity(travelMarkerEntity)
  }

  travelMarkerEntity = engine.addEntity()
  Transform.create(travelMarkerEntity, {
    position: Vector3.create(position.x, position.y + 0.25, position.z),
    scale: Vector3.create(0.12, 0.12, 0.12),
    rotation: Quaternion.fromEulerDegrees(45, 0, 45),
    parent: getGalaxyRoot()
  })
  MeshRenderer.setBox(travelMarkerEntity)
  Material.setPbrMaterial(travelMarkerEntity, {
    albedoColor: Color4.create(0, 1, 0.5, 1),
    emissiveColor: Color3.create(0, 1, 0.5),
    emissiveIntensity: 6
  })
  travelMarkerRotation = 0
}

let currentSystemId: string | null = null

export function setCurrentSystemForTravel(systemId: string | null): void {
  currentSystemId = systemId
}

export async function startTravel(destinationId: string): Promise<void> {
  // Store origin before travel starts
  if (currentSystemId) {
    for (const [entity, system] of starEntities) {
      if (system.id === currentSystemId) {
        originPosition = Transform.get(entity).position
        break
      }
    }
  }
  await api.travel(destinationId)
  await updateTravelState()
  for (const fn of departureListeners) fn()
}

export async function updateTravelState(): Promise<void> {
  const status = await api.getTravelStatus()

  const traveling = (status as any).isTraveling ?? status.is_traveling
  if (!traveling) {
    isTraveling = false
    travelFuelStart = null
    travelFuelEnd = null
    if (travelMarkerEntity) {
      engine.removeEntity(travelMarkerEntity)
      travelMarkerEntity = null
    }
    clearTravelLine()
    destinationId = null
    return
  }

  isTraveling = true
  const raw = status as any
  const fuelStart = raw.fuelStart ?? raw.fuel_start ?? raw.travel_fuel_start
  const fuelEnd = raw.fuelEnd ?? raw.fuel_end ?? raw.travel_fuel_end
  travelFuelStart = typeof fuelStart === 'number' ? fuelStart : null
  travelFuelEnd = typeof fuelEnd === 'number' ? fuelEnd : null
  const startedAt = raw.startedAt || raw.started_at || status.departure_time
  const completesAt = raw.completesAt || raw.completes_at || status.arrival_time
  const destId = raw.destinationSystemId || raw.destination_system_id || status.destination_system_id
  destinationId = destId

  travelStartTime = new Date(startedAt).getTime()
  travelEndTime = new Date(completesAt).getTime()

  for (const [entity, system] of starEntities) {
    if (system.id === destId) {
      destinationPosition = Transform.get(entity).position
      destinationSystem = system
    }
    if (currentSystemId && system.id === currentSystemId) {
      originPosition = Transform.get(entity).position
    }
  }

  if (originPosition && destinationPosition) {
    const dx = destinationPosition.x - originPosition.x
    const dy = destinationPosition.y - originPosition.y
    const dz = destinationPosition.z - originPosition.z
    totalTravelDistance = Math.sqrt(dx * dx + dy * dy + dz * dz)
    clearRouteLines()
    drawTravelLine(originPosition, destinationPosition)
    createTravelMarker(originPosition)
    hideCurrentLocationMarker()
  }
}

/** The map was rebuilt mid-trip: find both stars again in the new map and redraw the route and the marker. */
function restoreTravelVisuals(): void {
  if (!isTraveling || !destinationId) return
  for (const [entity, system] of starEntities) {
    if (system.id === destinationId) { destinationPosition = Transform.get(entity).position; destinationSystem = system }
    if (currentSystemId && system.id === currentSystemId) originPosition = Transform.get(entity).position
  }
  if (!originPosition || !destinationPosition) return
  drawTravelLine(originPosition, destinationPosition)
  createTravelMarker(originPosition)
  hideCurrentLocationMarker()
}

/** The map (and the root these hang from) is going away. */
function dropTravelVisuals(): void {
  clearTravelLine()
  if (travelMarkerEntity) { engine.removeEntity(travelMarkerEntity); travelMarkerEntity = null }
}

addMapRenderHooks({ rendered: restoreTravelVisuals, cleared: dropTravelVisuals })

let arriving = false   // one arrival request at a time: a slow server doesn't stack them up every 5 s
export async function checkArrival(): Promise<boolean> {
  if (!isTraveling || arriving) return false

  const now = Date.now()
  if (now >= travelEndTime) {
    arriving = true
    try {
      await api.arrive()
      isTraveling = false
      if (travelMarkerEntity) {
        engine.removeEntity(travelMarkerEntity)
        travelMarkerEntity = null
      }
      clearTravelLine()
      clearRouteLines()
      destinationId = null
      return true
    } catch {
      return false
    } finally {
      arriving = false
    }
  }
  return false
}

export function travelUpdateSystem(dt: number): void {
  if (!isTraveling || !travelMarkerEntity || !originPosition || !destinationPosition) return

  const now = Date.now()
  const totalDuration = travelEndTime - travelStartTime
  const elapsed = now - travelStartTime
  currentProgress = Math.min(elapsed / totalDuration, 1.0)

  const pos = Vector3.create(
    originPosition.x + (destinationPosition.x - originPosition.x) * currentProgress,
    originPosition.y + (destinationPosition.y - originPosition.y) * currentProgress + 0.25,
    originPosition.z + (destinationPosition.z - originPosition.z) * currentProgress
  )

  travelMarkerRotation += dt * 60
  Transform.createOrReplace(travelMarkerEntity, {
    position: pos,
    scale: Vector3.create(0.12, 0.12, 0.12),
    rotation: Quaternion.fromEulerDegrees(45, travelMarkerRotation, 45),
    parent: getGalaxyRoot()
  })
}
