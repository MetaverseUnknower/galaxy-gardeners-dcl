// Overhead camera for the Stellar Navigation console: when the player steps up to the console,
// the view lifts above their head and looks down across the panel toward the galaxy map, and
// hands control back when they walk away.
import { engine, Transform, VirtualCamera, MainCamera } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { DECK_Y } from './environment'
import { getPref, setPref } from './prefs'
import { getMapView, setMapView, MAP_LOWEST_HEIGHT } from './galaxyMap'

export type CameraMode = 'fixed' | 'free'
const PREF_KEY = 'consoleCamera'
/** Stepping up to the console always lowers the map into view; 'fixed' additionally lifts the camera over the console. Default is 'free'. */
export function getCameraMode(): CameraMode { return getPref<CameraMode>(PREF_KEY, 'free') }
export function setCameraMode(mode: CameraMode): void { setPref(PREF_KEY, mode) }

// The player stands on the north side of the console (z 138.6..141.2) to use it.
const ZONE = { minX: 125.8, maxX: 130.2, minZ: 138.6, maxZ: 141.2 }
const CAMERA_POS = Vector3.create(128, DECK_Y + 3.4, 142.6)     // above and behind the player
const LOOK_AT = Vector3.create(128, DECK_Y + 0.9, 134.5)        // between the console face and the projector

let cameraEntity: ReturnType<typeof engine.addEntity> | null = null
let active = false        // player is at the console
let cameraActive = false  // overhead camera engaged
let timer = 0

export function setupConsoleCamera(): void {
  const target = engine.addEntity()
  Transform.create(target, { position: LOOK_AT })
  cameraEntity = engine.addEntity()
  Transform.create(cameraEntity, { position: CAMERA_POS })
  VirtualCamera.create(cameraEntity, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) }, lookAtEntity: target })
  engine.addSystem(consoleCameraSystem)
}

let savedView: { height: number; scale: number } | null = null
let loweredTo = 0

function consoleCameraSystem(dt: number): void {
  timer += dt
  if (timer < 0.2) return
  timer = 0
  const p = getPlayer()?.position
  if (!p || !cameraEntity) return
  const inZone = p.x >= ZONE.minX && p.x <= ZONE.maxX && p.z >= ZONE.minZ && p.z <= ZONE.maxZ
  const wantCamera = inZone && getCameraMode() === 'fixed'
  if (inZone && !active) {
    // Bring the map down to the console (it shrinks to fit at the lowest heights) and remember where it was.
    savedView = getMapView()
    loweredTo = MAP_LOWEST_HEIGHT
    setMapView({ height: loweredTo })
    active = true
  } else if (!inZone && active) {
    // Put the map back unless the player moved it themselves while at the console.
    if (savedView && Math.abs(getMapView().height - loweredTo) < 0.01) setMapView(savedView)
    savedView = null
    active = false
  }
  if (wantCamera !== cameraActive) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: wantCamera ? cameraEntity : undefined })
    cameraActive = wantCamera
  }
}
