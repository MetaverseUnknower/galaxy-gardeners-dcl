import { engine, Entity, Transform, MeshRenderer, Material, InputAction, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { starEntities, getGalaxyRoot } from './galaxyMap'
import { isCurrentlyTraveling } from './navigation'
import { StarSystem } from './types'

let selectedSystem: StarSystem | null = null
let selectionRingEntities: Entity[] = []
let onSelectionChange: ((system: StarSystem | null) => void) | null = null

export function getSelectedSystem(): StarSystem | null {
  return selectedSystem
}

export function setSelectionCallback(callback: (system: StarSystem | null) => void): void {
  onSelectionChange = callback
}

function createSelectionRing(position: Vector3): void {
  clearSelectionRing()

  const root = getGalaxyRoot()
  const ringRadius = 0.25
  const segments = 16
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(
        position.x + Math.cos(angle) * ringRadius,
        position.y,
        position.z + Math.sin(angle) * ringRadius
      ),
      scale: Vector3.create(0.025, 0.025, 0.025),
      parent: root
    })
    MeshRenderer.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(1, 1, 0, 1),
      emissiveColor: Color3.create(1, 1, 0),
      emissiveIntensity: 5
    })
    selectionRingEntities.push(entity)
  }
}

function clearSelectionRing(): void {
  for (const entity of selectionRingEntities) {
    engine.removeEntity(entity)
  }
  selectionRingEntities = []
}

export function selectSystem(system: StarSystem | null, entity?: Entity): void {
  selectedSystem = system

  if (system && entity) {
    const transform = Transform.get(entity)
    createSelectionRing(transform.position)
  } else {
    clearSelectionRing()
  }

  if (onSelectionChange) {
    onSelectionChange(system)
  }
}

export function setupInteraction(): void {
  for (const [entity, system] of starEntities) {
    pointerEventsSystem.onPointerDown(
      {
        entity,
        opts: {
          button: InputAction.IA_POINTER,
          hoverText: system.name,
          maxDistance: 20
        }
      },
      () => {
        if (isCurrentlyTraveling()) return
        selectSystem(system, entity)
      }
    )
  }
}
