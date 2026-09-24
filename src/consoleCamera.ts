// Overhead camera for the Stellar Navigation console: when the player steps up to the console,
// the view lifts above their head and looks down across the panel toward the galaxy map, and
// hands control back when they walk away.
import { engine, Transform, VirtualCamera, MainCamera } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { DECK_Y } from './environment'

// The player stands on the north side of the console (z 138.6..141.2) to use it.
const ZONE = { minX: 125.8, maxX: 130.2, minZ: 138.6, maxZ: 141.2 }
const CAMERA_POS = Vector3.create(128, DECK_Y + 3.4, 142.6)     // above and behind the player
const LOOK_AT = Vector3.create(128, DECK_Y + 0.9, 134.5)        // between the console face and the projector

let cameraEntity: ReturnType<typeof engine.addEntity> | null = null
let active = false
let timer = 0

export function setupConsoleCamera(): void {
  const target = engine.addEntity()
  Transform.create(target, { position: LOOK_AT })
  cameraEntity = engine.addEntity()
  Transform.create(cameraEntity, { position: CAMERA_POS })
  VirtualCamera.create(cameraEntity, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) }, lookAtEntity: target })
  engine.addSystem(consoleCameraSystem)
}

function consoleCameraSystem(dt: number): void {
  timer += dt
  if (timer < 0.2) return
  timer = 0
  const p = getPlayer()?.position
  if (!p || !cameraEntity) return
  const inZone = p.x >= ZONE.minX && p.x <= ZONE.maxX && p.z >= ZONE.minZ && p.z <= ZONE.maxZ
  if (inZone && !active) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: cameraEntity })
    active = true
  } else if (!inZone && active) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    active = false
  }
}
