// Fixed cameras for the ship tour. Each shot is a VirtualCamera looking at a target; applying one takes the
// camera from the console camera module (suspended) and releasing hands it back.
import { engine, Entity, Transform, VirtualCamera, MainCamera } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { DECK_Y, PLATFORM_Y } from '../environment'
import { setCameraSuspended } from '../consoleCamera'

export type ShotId = 'bridge' | 'hologram' | 'hologramClose' | 'shipDesk' | 'floraDesk' | 'navConsole' | 'discovery' | 'galaxyTop' | 'window'

// Desks sit at (128 ± 10.8, 121.3), angled toward the hologram at (128, 128); cameras stand ~5.5 m in front.
const SHOTS: Record<ShotId, { pos: Vector3; lookAt: Vector3 }> = {
  bridge:        { pos: Vector3.create(128, PLATFORM_Y + 3.2, 141.5), lookAt: Vector3.create(128, PLATFORM_Y + 1.2, 124) },
  hologram:      { pos: Vector3.create(128, PLATFORM_Y + 3.5, 137), lookAt: Vector3.create(128, PLATFORM_Y + 1.5, 128) },
  hologramClose: { pos: Vector3.create(128, PLATFORM_Y + 2.6, 133.5), lookAt: Vector3.create(128, PLATFORM_Y + 1.3, 128) },
  shipDesk:      { pos: Vector3.create(134.1, DECK_Y + 2.6, 124.2), lookAt: Vector3.create(138.8, DECK_Y + 2.6, 121.3) },
  floraDesk:     { pos: Vector3.create(121.9, DECK_Y + 2.6, 124.2), lookAt: Vector3.create(117.2, DECK_Y + 2.6, 121.3) },
  navConsole:    { pos: Vector3.create(128, DECK_Y + 3.4, 142.6), lookAt: Vector3.create(128, DECK_Y + 0.9, 134.5) },
  discovery:     { pos: Vector3.create(128, DECK_Y + 2.2, 119.8), lookAt: Vector3.create(128, DECK_Y + 1.0, 114.9) },
  // Out of the front window (glass at z≈112) toward the space ahead: the wormhole cutscenes
  window:        { pos: Vector3.create(128, PLATFORM_Y + 2.4, 126), lookAt: Vector3.create(128, 45, 80) },
  galaxyTop:     { pos: Vector3.create(128, PLATFORM_Y + 15, 128.6), lookAt: Vector3.create(128, PLATFORM_Y + 1, 128) },
}

const cameras = new Map<ShotId, Entity>()

export function setupTourShots(): void {
  for (const id of Object.keys(SHOTS) as ShotId[]) {
    const target = engine.addEntity()
    Transform.create(target, { position: SHOTS[id].lookAt })
    const cam = engine.addEntity()
    Transform.create(cam, { position: SHOTS[id].pos })
    VirtualCamera.create(cam, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(1.2) }, lookAtEntity: target })
    cameras.set(id, cam)
  }
}

export function applyShot(id: ShotId): void {
  const cam = cameras.get(id)
  if (!cam) return
  setCameraSuspended(true)
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: cam })
}

export function releaseShot(): void {
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
  setCameraSuspended(false)   // the console camera re-applies the player's own mode on its next tick
}
