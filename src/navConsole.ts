// Stellar Navigation console (see docs/superpowers/specs/references/nav-console-concept.png).
// A low desk north of the galaxy projector, facing it, carrying the map controls: view tabs,
// pause orbits, map navigation (tilt / rotate / zoom / recenter) and the station card.
import { engine, Entity, Transform, GltfContainer, TextAlignMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { DECK_Y } from './environment'
import { getViewMode, switchViewMode, canSwitchToSystemView, setViewModeChangedListener, rotateMap, tiltMap, zoomMap, resetMapView } from './galaxyMap'
import { getStationInfo, toggleOrbits, areOrbitsPaused, setStationChangedListener } from './systemView'
import { showNotification } from './ui'
import { Bag, clearBag, text, frame, header, button, icon, image, dot, line, clickable, CYAN, CYAN3, MAGENTA, MAGENTA3, DIM, MUTED, GREEN, GREEN3 } from './stations/draw'

const LEFT = TextAlignMode.TAM_MIDDLE_LEFT, RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
const CONSOLE_POSITION = Vector3.create(128, DECK_Y, 137.5)   // where the old display screen stood
const CONSOLE_SCALE = 0.85
// Same face geometry as the station low desks (model front is -z; here that faces the projector).
const SCREEN_OFFSET = Vector3.create(0, 1.35, -0.3)
const SCREEN_ROT = Quaternion.fromEulerDegrees(50, 0, 0)

const ICONS = {
  galaxy: 'assets/icons/galaxy-icon.png', system: 'assets/icons/system-icon.png', station: 'assets/icons/space-station-icon.png',
  pause: 'assets/icons/pause-icon.png', raise: 'assets/icons/height-adjust-icon.png',
  rotateLeft: 'assets/icons/rotate-icon.png', rotateRight: 'assets/icons/rotate-right-icon.png',
  zoomIn: 'assets/icons/zoom-in-icon.png', zoomOut: 'assets/icons/zoom-out-icon.png', recenter: 'assets/icons/recenter-icon.png',
}
const IMAGES = { galaxy: 'assets/images/galaxy-thumb.png', stationOrbit: 'assets/images/station-orbit.png' }

let screen: Entity | null = null
const bag: Bag = []
let systemName: string | null = null
let lastCanSwitch = true
let lastPaused = false
let pollTimer = 0

export function setNavConsoleSystem(name: string | null): void { systemName = name; refreshNavConsole() }

export function createNavConsole(): void {
  const desk = engine.addEntity()
  // Half-turn: the desk's front faces north, so the player stands behind it looking south at the projector.
  Transform.create(desk, { position: CONSOLE_POSITION, rotation: Quaternion.fromEulerDegrees(0, 180, 0), scale: Vector3.create(CONSOLE_SCALE, CONSOLE_SCALE, CONSOLE_SCALE) })
  GltfContainer.create(desk, { src: 'assets/models/nav_panel_low_1.glb' })
  screen = engine.addEntity()
  Transform.create(screen, { position: SCREEN_OFFSET, rotation: SCREEN_ROT, parent: desk })
  setViewModeChangedListener(refreshNavConsole)
  setStationChangedListener(refreshNavConsole)
  engine.addSystem(pollSystem)
  refreshNavConsole()
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
function iconButton(root: Entity, x: number, y: number, iconSrc: string, label: string, hover: string, onClick: () => void, flipY = false): void {
  const w = 0.42, h = 0.42
  const f = frame(bag, root, x, y, w, h, { fill: Color4.create(0.02, 0.06, 0.12, 1), z: -0.02 })
  icon(bag, root, x, y + 0.08, 0.2, iconSrc, { z: -0.04, flipY })
  text(bag, root, x, y - 0.13, label, 0.11, CYAN, TextAlignMode.TAM_MIDDLE_CENTER, -0.04)
  clickable(f, hover, onClick)
}

export function refreshNavConsole(): void {
  if (!screen) return
  clearBag(bag)
  const root = screen
  const mode = getViewMode()
  const canSwitch = canSwitchToSystemView()
  const paused = areOrbitsPaused()
  const station = getStationInfo()
  lastCanSwitch = canSwitch; lastPaused = paused

  // Header + top-right cells
  header(bag, root, -2.65, 1.0, { icon: ICONS.galaxy, title: 'STELLAR NAVIGATION', subtitle: 'galactic cartography', size: 0.5 })
  frame(bag, root, 1.55, 1.0, 2.4, 0.42)
  line(bag, root, 1.55, 1.18, 1.55, 0.82, CYAN3, { thickness: 0.008, alpha: 0.6 })
  icon(bag, root, 0.5, 1.0, 0.24, ICONS.galaxy)
  text(bag, root, 0.68, 1.08, 'CURRENT SYSTEM', 0.13, DIM, LEFT)
  text(bag, root, 0.68, 0.92, systemName || 'Unknown', 0.22, CYAN, LEFT)
  icon(bag, root, 1.75, 1.0, 0.24, ICONS.station)
  text(bag, root, 1.93, 1.08, 'STELLAR STATION', 0.13, DIM, LEFT)
  dot(bag, root, 1.98, 0.92, 0.05, station ? GREEN3 : Color3.create(0.35, 0.45, 0.55))
  text(bag, root, 2.06, 0.92, station ? 'DOCKING AVAILABLE' : 'NO STATION', 0.13, station ? GREEN : MUTED, LEFT)

  // View tabs
  const galaxyActive = mode === 'galaxy'
  button(bag, root, -0.55, 0.55, 1.6, 0.3, 'GALAXY MAP', 'Galaxy View', () => switchViewMode('galaxy'), { variant: galaxyActive ? 'magenta' : 'outline', icon: ICONS.galaxy, size: 0.22 })
  button(bag, root, 1.15, 0.55, 1.6, 0.3, 'STAR SYSTEM', canSwitch ? 'System View' : 'System View (in transit)', () => switchViewMode('system'), { variant: !canSwitch ? 'disabled' : galaxyActive ? 'outline' : 'primary', icon: ICONS.system, size: 0.22 })

  // Left: pause orbits + galaxy thumbnail
  const pauseFill = frame(bag, root, -1.95, -0.05, 1.5, 0.9, { border: MAGENTA3, fill: Color4.create(0.12, 0.02, 0.1, 1) })
  icon(bag, root, -1.95, 0.2, 0.34, ICONS.pause, { color: MAGENTA3 })
  text(bag, root, -1.95, -0.15, paused ? 'RESUME ORBITS' : 'PAUSE ORBITS', 0.24, MAGENTA)
  text(bag, root, -1.95, -0.33, paused ? 'RESUME CELESTIAL MOTION' : 'FREEZE CELESTIAL MOTION', 0.11, DIM)
  clickable(pauseFill, paused ? 'Resume Orbits' : 'Pause Orbits', () => { toggleOrbits(); refreshNavConsole() })
  frame(bag, root, -1.95, -0.8, 1.5, 0.5)
  image(bag, root, -1.95, -0.8, 1.4, 0.42, IMAGES.galaxy)

  // Center: map navigation
  frame(bag, root, 0.05, -0.35, 2.3, 1.6)   // spans -1.1..1.2; the station column starts at 1.45
  text(bag, root, -1.0, 0.33, 'MAP NAVIGATION', 0.16, CYAN, LEFT)
  text(bag, root, 1.1, 0.33, 'EXPLORE THE GALAXY', 0.1, MUTED, RIGHT)
  iconButton(root, -0.86, -0.45, ICONS.rotateLeft, 'ROTATE LEFT', 'Rotate Left', () => rotateMap(1))
  iconButton(root, -0.4, -0.2, ICONS.raise, 'RAISE', 'Raise Map', () => tiltMap(1))
  iconButton(root, -0.4, -0.7, ICONS.raise, 'LOWER', 'Lower Map', () => tiltMap(-1), true)
  iconButton(root, 0.06, -0.45, ICONS.rotateRight, 'ROTATE RIGHT', 'Rotate Right', () => rotateMap(-1))
  iconButton(root, 0.52, -0.2, ICONS.zoomIn, 'ZOOM IN', 'Zoom In', () => zoomMap(1))
  iconButton(root, 0.52, -0.7, ICONS.zoomOut, 'ZOOM OUT', 'Zoom Out', () => zoomMap(-1))
  iconButton(root, 0.98, -0.45, ICONS.recenter, 'RECENTER', 'Recenter Map', () => resetMapView())

  // Right: station card + orbit thumbnail
  dot(bag, root, 1.55, 0.33, 0.05, station ? GREEN3 : Color3.create(0.35, 0.45, 0.55))
  text(bag, root, 1.63, 0.36, 'STELLAR STATION', 0.14, DIM, LEFT)
  text(bag, root, 1.63, 0.22, station ? 'DOCKING AVAILABLE' : 'NO STATION IN SYSTEM', 0.12, station ? GREEN : MUTED, LEFT)
  const dockFill = frame(bag, root, 2.1, -0.25, 1.3, 0.75, { fill: Color4.create(0.02, 0.1, 0.16, 1) })
  icon(bag, root, 2.1, -0.05, 0.3, ICONS.station)
  text(bag, root, 2.1, -0.32, station ? 'DOCK' : 'BUILD', 0.3, CYAN)
  text(bag, root, 2.1, -0.5, station ? 'APPROACH & DOCK  »' : 'FOUND A STATION  »', 0.11, DIM)
  clickable(dockFill, station ? `Dock at ${station.name}` : 'Build Station', () => {
    console.log(station ? 'Dock' : 'Build')
    showNotification(station ? `Docking at ${station.name} coming soon` : 'Station construction coming soon', CYAN)
  })
  frame(bag, root, 2.1, -0.88, 1.3, 0.42)
  image(bag, root, 2.1, -0.88, 1.2, 0.36, IMAGES.stationOrbit)

  // Footer
  text(bag, root, -2.65, -1.12, 'CHART  //  NAVIGATE  //  EXPLORE', 0.11, MUTED, LEFT)
  text(bag, root, 2.65, -1.12, 'STELLAR CARTOGRAPHY   v2.4.1', 0.11, MUTED, RIGHT)

}
