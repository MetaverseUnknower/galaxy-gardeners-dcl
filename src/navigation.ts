import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { TravelStatus } from './types'
import { starEntities } from './galaxyMap'

let routeLineEntities: Entity[] = []
let travelMarkerEntity: Entity | null = null
let isTraveling = false
let travelStartTime = 0
let travelEndTime = 0
let originPosition: Vector3 | null = null
let destinationPosition: Vector3 | null = null

export function isCurrentlyTraveling(): boolean {
  return isTraveling
}

export function drawRouteLine(fromPos: Vector3, toPos: Vector3): void {
  clearRouteLines()

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

  // Orient cylinder along the line between two points
  const direction = Vector3.normalize(Vector3.create(dx, dy, dz))
  const rotation = Quaternion.fromLookAt(fromPos, toPos)

  Transform.create(entity, {
    position: midpoint,
    scale: Vector3.create(0.015, length / 2, 0.015),
    rotation: Quaternion.multiply(rotation, Quaternion.fromEulerDegrees(90, 0, 0))
  })
  MeshRenderer.setCylinder(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(0, 1, 1, 0.4),
    emissiveColor: Color3.create(0, 0.8, 0.8),
    emissiveIntensity: 2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })

  routeLineEntities.push(entity)
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
    position,
    scale: Vector3.create(0.18, 0.18, 0.18)
  })
  MeshRenderer.setSphere(travelMarkerEntity)
  Material.setPbrMaterial(travelMarkerEntity, {
    albedoColor: Color4.create(0, 1, 0.5, 1),
    emissiveColor: Color3.create(0, 1, 0.5),
    emissiveIntensity: 5
  })
}

export async function startTravel(destinationId: string): Promise<void> {
  await api.travel(destinationId)
  await updateTravelState()
}

export async function updateTravelState(): Promise<void> {
  const status = await api.getTravelStatus()

  if (!status.is_traveling) {
    isTraveling = false
    if (travelMarkerEntity) {
      engine.removeEntity(travelMarkerEntity)
      travelMarkerEntity = null
    }
    clearRouteLines()
    return
  }

  isTraveling = true
  travelStartTime = new Date(status.departure_time!).getTime()
  travelEndTime = new Date(status.arrival_time!).getTime()

  for (const [entity, system] of starEntities) {
    if (system.id === status.origin_system_id) {
      originPosition = Transform.get(entity).position
    }
    if (system.id === status.destination_system_id) {
      destinationPosition = Transform.get(entity).position
    }
  }

  if (originPosition && destinationPosition) {
    drawRouteLine(originPosition, destinationPosition)
    createTravelMarker(originPosition)
  }
}

export async function checkArrival(): Promise<boolean> {
  if (!isTraveling) return false

  const now = Date.now()
  if (now >= travelEndTime) {
    try {
      await api.arrive()
      isTraveling = false
      if (travelMarkerEntity) {
        engine.removeEntity(travelMarkerEntity)
        travelMarkerEntity = null
      }
      clearRouteLines()
      return true
    } catch {
      return false
    }
  }
  return false
}

export function travelUpdateSystem(dt: number): void {
  if (!isTraveling || !travelMarkerEntity || !originPosition || !destinationPosition) return

  const now = Date.now()
  const totalDuration = travelEndTime - travelStartTime
  const elapsed = now - travelStartTime
  const progress = Math.min(elapsed / totalDuration, 1.0)

  const pos = Vector3.create(
    originPosition.x + (destinationPosition.x - originPosition.x) * progress,
    originPosition.y + (destinationPosition.y - originPosition.y) * progress,
    originPosition.z + (destinationPosition.z - originPosition.z) * progress
  )

  Transform.createOrReplace(travelMarkerEntity, {
    position: pos,
    scale: Vector3.create(0.18, 0.18, 0.18)
  })
}
