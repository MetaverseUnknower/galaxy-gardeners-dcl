// Overhead camera for the Stellar Navigation console: when the player steps up to the console,
// the view lifts above their head and looks down across the panel toward the galaxy map, and
// hands control back when they walk away.
import { engine, Transform, VirtualCamera, MainCamera, inputSystem, InputAction, PointerEventType, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color4, Color3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { DECK_Y, PLATFORM_Y } from './environment'
import { getPref, setPref } from './prefs'
import { setConsoleLowered, refreshNavConsole } from './navConsole'
import { rotateMap, tiltMap, zoomMap, resetMapView, getViewMode, getMapView } from './galaxyMap'
import { toggleOrbits } from './systemView'

export type CameraMode = 'free' | 'fixed' | 'top'
export const CAMERA_MODES: CameraMode[] = ['free', 'fixed', 'top']
export const CAMERA_MODE_LABELS: Record<CameraMode, string> = { free: 'FREE', fixed: 'CONSOLE', top: 'TOP' }
const PREF_KEY = 'consoleCamera'
/** 'free': the player's own camera. 'fixed': an overhead camera while standing at the console.
 *  'top': a top-down camera centered on the galaxy map, wherever the player is. Default is 'free'. */
export function getCameraMode(): CameraMode { const m = getPref<CameraMode>(PREF_KEY, 'free'); return CAMERA_MODES.includes(m) ? m : 'free' }
export function setCameraMode(mode: CameraMode): void { setPref(PREF_KEY, mode) }
export function cycleCameraMode(): CameraMode { const next = CAMERA_MODES[(CAMERA_MODES.indexOf(getCameraMode()) + 1) % CAMERA_MODES.length]; setCameraMode(next); return next }

// The player stands on the north side of the console (z 138.6..141.2) to use it.
const ZONE = { minX: 125.8, maxX: 130.2, minZ: 138.6, maxZ: 141.2 }
const CAMERA_POS = Vector3.create(128, DECK_Y + 3.4, 142.6)     // above and behind the player
const LOOK_AT = Vector3.create(128, DECK_Y + 0.9, 134.5)        // between the console face and the projector
// Top view: the camera hangs over the map center and tracks the map's height and zoom so the map fills the frame.
const MAP_CENTER_XZ = { x: 128, z: 128 }
const TOP_DISTANCE_PER_ZOOM = 14   // metres above the map per unit of map zoom (map radius is ~9m at zoom 1)
const TOP_MIN_DISTANCE = 6
const TOP_FADE_SPEED = 1.2         // 1/s; the black backdrop fades in over ~1.5s

let cameraEntity: ReturnType<typeof engine.addEntity> | null = null
let topCameraEntity: ReturnType<typeof engine.addEntity> | null = null
let topTargetEntity: ReturnType<typeof engine.addEntity> | null = null
let backdropEntity: ReturnType<typeof engine.addEntity> | null = null
let backdropAlpha = 0
let appliedCamera: ReturnType<typeof engine.addEntity> | null = null
let active = false        // player is at the console
let timer = 0

export function setupConsoleCamera(): void {
  const target = engine.addEntity()
  Transform.create(target, { position: LOOK_AT })
  cameraEntity = engine.addEntity()
  Transform.create(cameraEntity, { position: CAMERA_POS })
  VirtualCamera.create(cameraEntity, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0.8) }, lookAtEntity: target })
  topTargetEntity = engine.addEntity()
  Transform.create(topTargetEntity, { position: Vector3.create(MAP_CENTER_XZ.x, PLATFORM_Y + 1, MAP_CENTER_XZ.z) })
  topCameraEntity = engine.addEntity()
  Transform.create(topCameraEntity, { position: Vector3.create(MAP_CENTER_XZ.x, PLATFORM_Y + 15, MAP_CENTER_XZ.z + 0.6) })
  VirtualCamera.create(topCameraEntity, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(1.0) }, lookAtEntity: topTargetEntity })
  // Black backdrop under the map for the top view; invisible until that view fades it in.
  backdropEntity = engine.addEntity()
  Transform.create(backdropEntity, { position: Vector3.create(MAP_CENTER_XZ.x, PLATFORM_Y + 0.28, MAP_CENTER_XZ.z), rotation: Quaternion.fromEulerDegrees(90, 0, 0), scale: Vector3.create(0, 0, 1) })
  MeshRenderer.setPlane(backdropEntity)
  Material.setPbrMaterial(backdropEntity, { albedoColor: Color4.create(0, 0, 0, 0), emissiveColor: Color3.Black(), metallic: 0, roughness: 1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  engine.addSystem(topViewSystem)
  engine.addSystem(consoleCameraSystem)
  engine.addSystem(consoleKeysSystem)
}

// Top view: keep the camera fitted to the map and fade the backdrop in and out.
function topViewSystem(dt: number): void {
  if (!topCameraEntity || !topTargetEntity || !backdropEntity) return
  const top = getCameraMode() === 'top'
  if (top) {
    const view = getMapView()
    const distance = Math.max(TOP_MIN_DISTANCE, TOP_DISTANCE_PER_ZOOM * view.scale)
    Transform.getMutable(topTargetEntity).position = Vector3.create(MAP_CENTER_XZ.x, view.height, MAP_CENTER_XZ.z)
    // A hair off-axis in z keeps the look-down orientation well defined.
    Transform.getMutable(topCameraEntity).position = Vector3.create(MAP_CENTER_XZ.x, view.height + distance, MAP_CENTER_XZ.z + 0.04 * distance)
  }
  const targetAlpha = top ? 1 : 0
  if (Math.abs(backdropAlpha - targetAlpha) < 0.001 && backdropAlpha === targetAlpha) return
  backdropAlpha += (targetAlpha - backdropAlpha) * (1 - Math.exp(-TOP_FADE_SPEED * dt))
  if (Math.abs(backdropAlpha - targetAlpha) < 0.01) backdropAlpha = targetAlpha
  const t = Transform.getMutable(backdropEntity)
  t.scale = backdropAlpha > 0 ? Vector3.create(80, 80, 1) : Vector3.create(0, 0, 1)
  Material.setPbrMaterial(backdropEntity, { albedoColor: Color4.create(0, 0, 0, backdropAlpha), emissiveColor: Color3.Black(), metallic: 0, roughness: 1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
}

// Keyboard control of the map while standing at the console:
// 1-4 = rotate left, raise, lower, rotate right; with Shift held: zoom in, zoom out, recenter, pause/resume.
// Shift arrives as IA_MODIFIER down/up events (SDK 7.23+), so its held state is tracked from their timestamps.
let shiftHeld = false
function trackShift(): void {
  const down = inputSystem.getInputCommand(InputAction.IA_MODIFIER, PointerEventType.PET_DOWN)
  const up = inputSystem.getInputCommand(InputAction.IA_MODIFIER, PointerEventType.PET_UP)
  if (down && up) shiftHeld = down.timestamp > up.timestamp
  else if (down) shiftHeld = true
  else if (up) shiftHeld = false
}
function consoleKeysSystem(): void {
  trackShift()
  if (!active) return
  const down = (a: InputAction) => inputSystem.isTriggered(a, PointerEventType.PET_DOWN)
  const shift = shiftHeld
  if (down(InputAction.IA_ACTION_3)) shift ? zoomMap(1) : rotateMap(1)
  if (down(InputAction.IA_ACTION_4)) shift ? zoomMap(-1) : tiltMap(1)
  if (down(InputAction.IA_ACTION_5)) shift ? resetMapView() : tiltMap(-1)
  if (down(InputAction.IA_ACTION_6)) { if (shift) { if (getViewMode() === 'system') { toggleOrbits(); refreshNavConsole() } } else rotateMap(-1) }
}

function consoleCameraSystem(dt: number): void {
  timer += dt
  if (timer < 0.2) return
  timer = 0
  const p = getPlayer()?.position
  if (!p || !cameraEntity) return
  const inZone = p.x >= ZONE.minX && p.x <= ZONE.maxX && p.z >= ZONE.minZ && p.z <= ZONE.maxZ
  if (inZone !== active) { setConsoleLowered(inZone); active = inZone }
  const mode = getCameraMode()
  const want = mode === 'top' ? topCameraEntity : mode === 'fixed' && inZone ? cameraEntity : null
  if (want !== appliedCamera) {
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: want ?? undefined })
    appliedCamera = want
  }
}
