// Stellar Navigation console (see docs/superpowers/specs/references/nav-console-concept.png).
// A low desk north of the galaxy projector, facing it, carrying the map controls: view tabs,
// pause orbits, map navigation (tilt / rotate / zoom / recenter) and the station card.
import { engine, Entity, Transform, GltfContainer, TextAlignMode, ColliderLayer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { DECK_Y } from './environment'
import * as api from './api'
import { getViewMode, switchViewMode, canSwitchToSystemView, setViewModeChangedListener, rotateMap, tiltMap, zoomMap, resetMapView } from './galaxyMap'
import { getStationInfo, toggleOrbits, areOrbitsPaused, setStationChangedListener } from './systemView'
import { showNotification } from './ui'
import { getCameraMode, setCameraMode, CAMERA_MODES, CAMERA_MODE_LABELS, setCameraModeChangedListener } from './consoleCamera'
import { enterSleepMode } from './sleepMode'
import { isHeatMapOn, toggleHeatMap, heatMapTotal, setHeatMapChangedListener } from './heatMap'
import { isDocked, dockAt, undock, onDockingChanged } from './docking'
import { hideInTopView } from './topViewHide'
import { Bag, clearBag, text, frame, header, button, icon, image, dot, disc, pin, line, ring, clickable, CYAN, CYAN3, MAGENTA, MAGENTA3, WHITE, DIM, MUTED, GREEN, GREEN3 } from './stations/draw'

const LEFT = TextAlignMode.TAM_MIDDLE_LEFT, RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
// This desk is scaled down (0.85), so its text gets a local boost on top of the global scale.
const T = 1.3
const txt: typeof text = (into, root, x, y, str, size, color?, align?, z?) => text(into, root, x, y, str, size * T, color, align, z)
const hdr: typeof header = (into, root, x, y, opts) => header(into, root, x, y, { ...opts, size: (opts.size ?? 0.9) * T })
const btn: typeof button = (into, root, x, y, w, h, label, hover, onClick, opts = {}) => button(into, root, x, y, w, h, label, hover, onClick, { ...opts, size: (opts.size ?? 0.42) * T })
const CONSOLE_POSITION = Vector3.create(128, DECK_Y, 137.5)   // where the old display screen stood
const CONSOLE_SCALE = 0.85
const CONSOLE_DROP = 0.25     // how far the desk sinks when the player steps up to it
const CONSOLE_TILT = 8        // degrees the lowered desk tips toward the projector
const CONSOLE_DROP_SPEED = 3  // 1/s
// Same face geometry as the station low desks (model front is -z; here that faces the projector).
const SCREEN_OFFSET = Vector3.create(0, 1.35, -0.3)
const SCREEN_ROT = Quaternion.fromEulerDegrees(50, 0, 0)

const ICONS = {
  galaxy: 'assets/icons/galaxy-icon.png', system: 'assets/icons/system-icon.png', station: 'assets/icons/space-station-icon.png',
  pause: 'assets/icons/pause-icon.png', raise: 'assets/icons/height-adjust-icon.png',
  rotate: 'assets/icons/rotate-icon.png',
  zoomIn: 'assets/icons/zoom-in-icon.png', zoomOut: 'assets/icons/zoom-out-icon.png', recenter: 'assets/icons/recenter-icon.png',
  buildStation: 'assets/icons/build-station-icon.png',
  social: 'assets/icons/social-galaxy-icon.png',
  sleep: 'assets/icons/sleep-mode-icon.png',
}
const IMAGES = { galaxy: 'assets/images/galaxy-thumb.png', stationOrbit: 'assets/images/station-orbit.png', stationSlot: 'assets/images/station-slot-preview.png' }

let screen: Entity | null = null
let desk: Entity | null = null
let lowered = false
let tiltNow = 0
const bag: Bag = []
let systemName: string | null = null
let systemHasStation = false
// Station details for the current system, fetched when the galaxy list says one exists but the system view hasn't loaded.
let fetchedStation: { systemId: string; info: { id?: string; name: string; origin: string; founded_by: string | null } | null } | null = null
let lastCanSwitch = true
let lastPaused = false
let pollTimer = 0

/** The player's current system, from the galaxy list (has_station is known before the system view loads). */
export function setNavConsoleSystem(system: { id: string; name: string; has_station: boolean } | null): void {
  systemName = system?.name ?? null
  systemHasStation = !!system?.has_station
  refreshNavConsole()
  if (system?.has_station && fetchedStation?.systemId !== system.id) {
    api.getSystemDetail(system.id).then(detail => {
      fetchedStation = { systemId: system.id, info: detail?.station || null }
      refreshNavConsole()
    }).catch(() => {})
  }
}

export function createNavConsole(): void {
  desk = engine.addEntity()
  // Half-turn: the desk's front faces north, so the player stands behind it looking south at the projector.
  Transform.create(desk, { position: CONSOLE_POSITION, rotation: Quaternion.fromEulerDegrees(0, 180, 0), scale: Vector3.create(CONSOLE_SCALE, CONSOLE_SCALE, CONSOLE_SCALE) })
  GltfContainer.create(desk, { src: 'assets/models/nav_panel_low_1.glb', visibleMeshesCollisionMask: ColliderLayer.CL_PHYSICS })
  hideInTopView(desk)
  screen = engine.addEntity()
  Transform.create(screen, { position: SCREEN_OFFSET, rotation: SCREEN_ROT, parent: desk })
  setViewModeChangedListener(refreshNavConsole)
  setHeatMapChangedListener(refreshNavConsole)
  onDockingChanged(refreshNavConsole)
  setCameraModeChangedListener(refreshNavConsole)   // keeps the camera buttons in step with the HUD switcher and keys
  setStationChangedListener(refreshNavConsole)
  engine.addSystem(pollSystem)
  engine.addSystem(deskMotionSystem)
  refreshNavConsole()
}

/** Sink the console out of the sightline to the map while the player stands at it. */
export function setConsoleLowered(on: boolean): void { lowered = on }

function deskMotionSystem(dt: number): void {
  if (!desk) return
  const t = Transform.getMutable(desk)
  const targetY = CONSOLE_POSITION.y - (lowered ? CONSOLE_DROP : 0)
  const k = 1 - Math.exp(-CONSOLE_DROP_SPEED * dt)
  t.position = Vector3.create(t.position.x, t.position.y + (targetY - t.position.y) * k, t.position.z)
  tiltNow += ((lowered ? CONSOLE_TILT : 0) - tiltNow) * k
  // Tip the far (projector-side) edge down as it sinks. If it tips the wrong way, negate CONSOLE_TILT.
  t.rotation = Quaternion.multiply(Quaternion.fromEulerDegrees(0, 180, 0), Quaternion.fromEulerDegrees(tiltNow, 0, 0))
}

// Re-draw when transit state or the orbit pause flips without a click on this console.
function pollSystem(dt: number): void {
  pollTimer += dt
  if (pollTimer < 0.5) return
  pollTimer = 0
  const canSwitch = canSwitchToSystemView(), paused = areOrbitsPaused()
  if (canSwitch !== lastCanSwitch || paused !== lastPaused) refreshNavConsole()
}

/** Square icon button with a caption underneath (the MAP NAVIGATION grid). */
function iconButton(root: Entity, x: number, y: number, iconSrc: string, label: string, hover: string, onClick: () => void, flip: { x?: boolean; y?: boolean } = {}): void {
  const w = 0.42, h = 0.42
  const f = frame(bag, root, x, y, w, h, { fill: Color4.create(0.02, 0.06, 0.12, 1), z: -0.02 })
  icon(bag, root, x, y + 0.08, 0.2, iconSrc, { z: -0.04, flipX: flip.x, flipY: flip.y })
  txt(bag, root, x, y - 0.13, label, 0.11, CYAN, TextAlignMode.TAM_MIDDLE_CENTER, -0.04)
  clickable(f, hover, onClick)
}

export function refreshNavConsole(): void {
  if (!screen) return
  clearBag(bag)
  const root = screen
  const mode = getViewMode()
  const canSwitch = canSwitchToSystemView()
  const paused = areOrbitsPaused()
  // Detail (with the station's name) exists once the system view has loaded; otherwise fall back to the list's flag.
  const station = getStationInfo() ?? fetchedStation?.info ?? (systemHasStation ? { name: 'Space Station', origin: '', founded_by: null } : null)
  const inSystemView = mode === 'system'
  lastCanSwitch = canSwitch; lastPaused = paused

  // Header + top-right cells
  hdr(bag, root, -2.65, 1.0, { icon: ICONS.galaxy, title: 'STELLAR NAVIGATION', subtitle: 'galactic cartography', size: 0.5 })
  frame(bag, root, 1.55, 1.0, 2.4, 0.42)
  line(bag, root, 1.55, 1.18, 1.55, 0.82, CYAN3, { thickness: 0.008, alpha: 0.6 })
  icon(bag, root, 0.5, 1.0, 0.24, ICONS.galaxy)
  txt(bag, root, 0.68, 1.08, 'CURRENT SYSTEM', 0.13, DIM, LEFT)
  txt(bag, root, 0.68, 0.92, systemName || 'Unknown', 0.22, CYAN, LEFT)
  icon(bag, root, 1.75, 1.0, 0.24, ICONS.station)
  if (station) {
    txt(bag, root, 1.93, 1.08, 'STELLAR STATION', 0.13, DIM, LEFT)
    txt(bag, root, 1.93, 0.92, station.name, 0.2, CYAN, LEFT)
  } else {
    txt(bag, root, 1.93, 1.12, 'STATION STATUS', 0.12, DIM, LEFT)
    txt(bag, root, 1.93, 1.0, 'NO STATION PRESENT', 0.13, MAGENTA, LEFT)
    dot(bag, root, 1.98, 0.88, 0.04, GREEN3)
    txt(bag, root, 2.06, 0.88, 'STATION SLOT AVAILABLE', 0.1, GREEN, LEFT)
  }

  // View tabs
  const galaxyActive = mode === 'galaxy'
  // Map legend: the free strip left of the view tabs. Each mark has the same shape as on the map, so none of
  // them depends on colour: cube, pinned star, plain star, haloed star.
  const L1 = 0.67, L2 = 0.5, C1 = -2.64, C2 = -1.99, LS = 0.13   // one-word labels so they can be large; the tab starts at x -1.35
  frame(bag, root, C1, L1, 0.07, 0.07, { border: Color3.create(0, 1, 0.5), fill: Color4.create(0, 1, 0.5, 1), borderWidth: 0.01 })
  txt(bag, root, C1 + 0.09, L1, 'HERE', LS, DIM, LEFT)
  disc(bag, root, C2, L1 - 0.02, 0.045, Color3.create(1, 0.3, 1))
  pin(bag, root, C2, L1 + 0.045, 0.045, 0.05, Color3.create(1, 0.3, 1))   // the map's home pin, hovering over the star
  txt(bag, root, C2 + 0.09, L1, 'HOME', LS, DIM, LEFT)
  disc(bag, root, C1, L2, 0.035, Color3.create(1, 1, 1))
  txt(bag, root, C1 + 0.09, L2, 'STAR', LS, DIM, LEFT)
  disc(bag, root, C2, L2, 0.08, Color3.create(0, 0.8, 0.8), { alpha: 0.28, z: -0.03 })   // the halo disc
  disc(bag, root, C2, L2, 0.035, Color3.create(0, 0.8, 0.8))
  txt(bag, root, C2 + 0.09, L2, 'STATION', LS, DIM, LEFT)
  // Both view tabs share one active style (magenta outline and text) so the selection reads the same either way.
  btn(bag, root, -0.55, 0.55, 1.6, 0.3, 'GALAXY MAP', 'Galaxy View', () => switchViewMode('galaxy'), { variant: galaxyActive ? 'magenta' : 'outline', icon: ICONS.galaxy, size: 0.22 })
  btn(bag, root, 1.15, 0.55, 1.6, 0.3, 'STAR SYSTEM', canSwitch ? 'System View' : 'System View (in transit)', () => switchViewMode('system'), { variant: !canSwitch ? 'disabled' : galaxyActive ? 'outline' : 'magenta', icon: ICONS.system, size: 0.22 })

  // Left: pause orbits + galaxy thumbnail
  if (inSystemView) {
    const pauseFill = frame(bag, root, -1.95, -0.05, 1.5, 0.9, { border: MAGENTA3, fill: Color4.create(0.12, 0.02, 0.1, 1) })
    icon(bag, root, -1.95, 0.16, 0.34, ICONS.pause, { color: MAGENTA3 })
    txt(bag, root, -1.95, -0.19, paused ? 'RESUME ORBITS' : 'PAUSE ORBITS', 0.24, MAGENTA)
    txt(bag, root, -1.95, -0.37, paused ? 'RESUME CELESTIAL MOTION' : 'FREEZE CELESTIAL MOTION', 0.11, DIM)
    clickable(pauseFill, paused ? 'Resume Orbits' : 'Pause Orbits', () => { toggleOrbits(); refreshNavConsole() })
  } else {
    // Galaxy view: the same slot toggles the social heat map (orbits only pause in star system view).
    const on = isHeatMapOn()
    const heatFill = frame(bag, root, -1.95, -0.05, 1.5, 0.9, on ? { border: MAGENTA3, fill: Color4.create(0.12, 0.02, 0.1, 1) } : {})
    icon(bag, root, -1.95, 0.16, 0.34, ICONS.social, { color: on ? MAGENTA3 : CYAN3 })
    txt(bag, root, -1.95, -0.19, on ? 'HIDE HEAT MAP' : 'SOCIAL HEAT MAP', 0.24, on ? MAGENTA : CYAN)
    const n = heatMapTotal()
    txt(bag, root, -1.95, -0.37, on ? `${n} EXPLORER${n === 1 ? '' : 'S'} ACTIVE TODAY` : 'SHOW WHERE EXPLORERS ARE', 0.11, DIM)
    clickable(heatFill, on ? 'Hide Heat Map' : 'Show Heat Map', () => { void toggleHeatMap() })
  }
  frame(bag, root, -1.95, -0.85, 1.2, 0.6)
  image(bag, root, -1.95, -0.85, 1.16, 0.58, IMAGES.galaxy)   // 2:1, matching the texture

  // Center: map navigation
  // Top edge flush with the view tabs (0.4), bottom edge through the camera buttons' centre line (-1.1).
  frame(bag, root, 0.05, -0.35, 2.3, 1.5)   // spans -1.1..1.2; the station column starts at 1.45
  txt(bag, root, -1.0, 0.31, 'MAP NAVIGATION', 0.16, CYAN, LEFT)
  txt(bag, root, 1.12, 0.3, '1 2 3 4  ROTATE L · RAISE · LOWER · ROTATE R', 0.1, DIM, RIGHT)
  txt(bag, root, 1.12, 0.19, 'SHIFT + 1 2 3 4  ZOOM IN · ZOOM OUT · RECENTER · PAUSE', 0.1, DIM, RIGHT)
  iconButton(root, -0.86, -0.37, ICONS.rotate, 'ROTATE LEFT', 'Rotate Left', () => rotateMap(1))
  iconButton(root, -0.4, -0.12, ICONS.raise, 'RAISE', 'Raise Map', () => tiltMap(1))
  iconButton(root, -0.4, -0.62, ICONS.raise, 'LOWER', 'Lower Map', () => tiltMap(-1), { y: true })
  iconButton(root, 0.06, -0.37, ICONS.rotate, 'ROTATE RIGHT', 'Rotate Right', () => rotateMap(-1), { x: true })
  iconButton(root, 0.52, -0.12, ICONS.zoomIn, 'ZOOM IN', 'Zoom In', () => zoomMap(1))
  iconButton(root, 0.52, -0.62, ICONS.zoomOut, 'ZOOM OUT', 'Zoom Out', () => zoomMap(-1))
  iconButton(root, 0.98, -0.37, ICONS.recenter, 'RECENTER', 'Recenter Map', () => resetMapView())

  // Right: station card + thumbnail (dock when a station exists, build when the slot is free)
  if (station) {
    const stationId: string | undefined = (station as any).id ?? fetchedStation?.info?.id
    const docked = isDocked()
    txt(bag, root, 1.5, 0.31, station.name, 0.15, WHITE, LEFT)
    dot(bag, root, 1.55, 0.19, 0.05, docked ? MAGENTA3 : GREEN3)
    txt(bag, root, 1.63, 0.19, docked ? 'DOCKED  //  EXTERNAL SERVICE' : 'DOCKING AVAILABLE', 0.12, docked ? MAGENTA : GREEN, LEFT)
    const dockFill = frame(bag, root, 2.1, -0.25, 1.3, 0.75, docked ? { border: MAGENTA3, fill: Color4.create(0.12, 0.02, 0.1, 1) } : { fill: Color4.create(0.02, 0.1, 0.16, 1) })
    icon(bag, root, 2.1, -0.05, 0.3, ICONS.station, docked ? { color: MAGENTA3 } : {})
    txt(bag, root, 2.1, -0.32, docked ? 'UNDOCK' : 'DOCK', 0.3, docked ? MAGENTA : CYAN)
    txt(bag, root, 2.1, -0.5, docked ? 'RELEASE CLAMPS  »' : 'APPROACH & DOCK  »', 0.11, DIM)
    clickable(dockFill, docked ? `Undock from ${station.name}` : `Dock at ${station.name}`, () => {
      if (docked) { void undock(); return }
      if (!stationId) { showNotification('Station registry unavailable. Try again in a moment, Captain.', Color4.create(1, 0.4, 0.4, 1)); return }
      void dockAt(stationId, station.name)
    })
    frame(bag, root, 2.1, -0.87, 1.0, 0.5)
    image(bag, root, 2.1, -0.87, 0.96, 0.48, IMAGES.stationOrbit)   // 2:1
  } else {
    txt(bag, root, 2.1, 0.3, 'NO STATION PRESENT', 0.16, WHITE)
    txt(bag, root, 2.1, 0.14, 'CONSTRUCT A STATION IN THIS SYSTEM', 0.09, CYAN)
    const buildFill = frame(bag, root, 2.1, -0.32, 1.3, 0.62, { border: GREEN3, fill: Color4.create(0.02, 0.16, 0.08, 1) })
    icon(bag, root, 2.1, -0.18, 0.3, ICONS.buildStation, { color: GREEN3 })
    txt(bag, root, 2.1, -0.47, 'BUILD STATION  »', 0.22, GREEN)
    clickable(buildFill, 'Build Station', () => { console.log('Build'); showNotification('Station construction coming soon', GREEN) })
    frame(bag, root, 2.1, -0.87, 1.0, 0.5)
    image(bag, root, 2.1, -0.87, 0.96, 0.48, IMAGES.stationSlot)   // 2:1
  }

  // Footer, with the console camera toggle in the middle
  const cam = getCameraMode()
  txt(bag, root, -0.92, -0.99, 'CAMERA', 0.09, DIM, RIGHT, -0.02)
  CAMERA_MODES.forEach((mode, i) => {
    btn(bag, root, -0.57 + i * 0.62, -0.99, 0.58, 0.18, CAMERA_MODE_LABELS[mode], `${CAMERA_MODE_LABELS[mode]} camera`, () => { setCameraMode(mode); refreshNavConsole() }, { size: 0.1, variant: mode === cam ? 'primary' : 'outline' })
  })
  // Sleep mode lives under the camera row, on the footer line.
  btn(bag, root, 0.05, -1.19, 1.2, 0.14, 'SLEEP MODE', 'Sleep Mode', () => enterSleepMode(), { size: 0.09, variant: 'magenta', icon: ICONS.sleep, iconSize: 0.11, iconInset: 0.26 })
  txt(bag, root, -2.65, -1.26, 'CHART  //  NAVIGATE  //  EXPLORE', 0.11, MUTED, LEFT)
  txt(bag, root, 2.65, -1.19, 'STELLAR CARTOGRAPHY   v2.4.1', 0.11, MUTED, RIGHT)

}
