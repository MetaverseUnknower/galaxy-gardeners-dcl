import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { StarSystem } from './types'

const MAP_CENTER = Vector3.create(8, 4, 8)
const MAP_RADIUS = 6.0
const PROJECTOR_RADIUS = 1.5
const PROJECTOR_HEIGHT = 0.3

export const starEntities: Map<Entity, StarSystem> = new Map()
const zoneRingEntities: Entity[] = []

export function createProjectorBase(): void {
  // Main projector cylinder
  const projector = engine.addEntity()
  Transform.create(projector, {
    position: Vector3.create(MAP_CENTER.x, PROJECTOR_HEIGHT / 2, MAP_CENTER.z),
    scale: Vector3.create(PROJECTOR_RADIUS * 2, PROJECTOR_HEIGHT, PROJECTOR_RADIUS * 2)
  })
  MeshRenderer.setCylinder(projector)
  Material.setPbrMaterial(projector, {
    albedoColor: Color4.create(0.05, 0.05, 0.1, 1),
    emissiveColor: Color3.create(0, 0.3, 0.4),
    emissiveIntensity: 2,
    metallic: 0.8,
    roughness: 0.3
  })

  // Upward beam effect
  const beam = engine.addEntity()
  Transform.create(beam, {
    position: Vector3.create(MAP_CENTER.x, MAP_CENTER.y / 2, MAP_CENTER.z),
    scale: Vector3.create(0.3, MAP_CENTER.y, 0.3)
  })
  MeshRenderer.setCylinder(beam)
  Material.setPbrMaterial(beam, {
    albedoColor: Color4.create(0, 1, 1, 0.05),
    emissiveColor: Color3.create(0, 0.5, 0.5),
    emissiveIntensity: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
}

function createZoneRings(maxCoordRadius: number): void {
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
        position: Vector3.create(
          MAP_CENTER.x + Math.cos(angle) * ringRadius,
          MAP_CENTER.y,
          MAP_CENTER.z + Math.sin(angle) * ringRadius
        ),
        scale: Vector3.create(0.03, 0.03, 0.03)
      })
      MeshRenderer.setSphere(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(0, 1, 1, 0.2),
        emissiveColor: Color3.create(0, 0.5, 0.5),
        emissiveIntensity: 1,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
      })
      zoneRingEntities.push(entity)
    }
  }
}

function getStarColor(system: StarSystem, homeSystemId: string | null, currentSystemId: string | null): { color: Color4; emissive: Color3; size: number } {
  if (system.id === currentSystemId) {
    return { color: Color4.create(0, 1, 0.5, 1), emissive: Color3.create(0, 1, 0.5), size: 0.15 }
  }
  if (system.id === homeSystemId) {
    return { color: Color4.create(1, 0.4, 1, 1), emissive: Color3.create(1, 0.4, 1), size: 0.12 }
  }
  if (system.has_station) {
    return { color: Color4.create(0, 1, 1, 1), emissive: Color3.create(0, 1, 1), size: 0.08 }
  }
  if (system.has_wormhole) {
    return { color: Color4.create(0.6, 0.2, 1, 1), emissive: Color3.create(0.6, 0.2, 1), size: 0.07 }
  }
  return { color: Color4.create(1, 1, 1, 1), emissive: Color3.create(0.8, 0.8, 0.8), size: 0.05 }
}

export function renderStarSystems(
  systems: StarSystem[],
  homeSystemId: string | null,
  currentSystemId: string | null
): void {
  let maxRadius = 1
  for (const sys of systems) {
    const dist = Math.sqrt(sys.coord_x ** 2 + sys.coord_y ** 2 + sys.coord_z ** 2)
    if (dist > maxRadius) maxRadius = dist
  }

  const scale = MAP_RADIUS / maxRadius

  createZoneRings(maxRadius)

  for (const system of systems) {
    const { color, emissive, size } = getStarColor(system, homeSystemId, currentSystemId)

    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(
        MAP_CENTER.x + system.coord_x * scale,
        MAP_CENTER.y + system.coord_z * scale,
        MAP_CENTER.z + system.coord_y * scale
      ),
      scale: Vector3.create(size, size, size)
    })
    MeshRenderer.setSphere(entity)
    MeshCollider.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: color,
      emissiveColor: emissive,
      emissiveIntensity: 3
    })

    starEntities.set(entity, system)
  }
}

export function clearMap(): void {
  for (const [entity] of starEntities) {
    engine.removeEntity(entity)
  }
  starEntities.clear()
  for (const entity of zoneRingEntities) {
    engine.removeEntity(entity)
  }
  zoneRingEntities.length = 0
}
