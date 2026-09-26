// Discovery desk — Stellar Discovery (see docs/superpowers/specs/references/discovery-desk-concept.png).
// Upright panel above the desk: header, galactic coordinates, current star system.
// Desk face: TRAVEL VECTOR direction buttons on the left, GALACTIC MAP (local sector view) on the right.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, TextAlignMode, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { StarSystem } from './types'
import { setDiscoveryDescription } from './ui'
import { DECK_Y } from './environment'
import { Bag, clearBag, text, frame, header, bar, button, icon, dot, line, spinner, CYAN, CYAN3, MAGENTA, MAGENTA3, WHITE, DIM, MUTED, GREEN } from './stations/draw'
import { hideInTopView } from './topViewHide'
import { registerDimmableScreen } from './cabinDim'
import { redrawWhenCountdownChanges, minutesUntil } from './countdown'
import { isCurrentlyTraveling, getTravelDestination, getTravelFraction } from './navigation'

const DISPLAY_CENTER = Vector3.create(128, DECK_Y + 0.55, 114.9)
const LEFT = TextAlignMode.TAM_MIDDLE_LEFT, RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
// Screen roots use the station convention (x right, y up, -z toward the viewer). The desk faces +z,
// so both roots carry a half-turn; the desk root also leans back 50° like the low-desk screens.
const DESK_ROT = Quaternion.multiply(Quaternion.fromEulerDegrees(0, 180, 0), Quaternion.fromEulerDegrees(50, 0, 0))
const UPRIGHT_ROT = Quaternion.fromEulerDegrees(0, 180, 0)

const ICONS = {
  coordinates: 'assets/icons/coordinates-icon.png',
  system: 'assets/icons/galaxy-icon.png',
  travel: 'assets/icons/travel-icon.png',
  map: 'assets/icons/solar-system-icon.png',
  inward: 'assets/icons/direction-inward-icon.png',
  lateral: 'assets/icons/direction-lateral-icon.png',
  vertical: 'assets/icons/direction-vertical-icon.png',
  outward: 'assets/icons/direction-outward-icon.png',
}

const bag: Bag = []
let miniMapEntities: Entity[] = []
let arrowEntities: Entity[] = []
let discoveryOptions: any[] = []
let activeDiscovery: any = null
/** The search in progress, for the window effects: launching or probe en route (not once the signal is locked). */
export function getDiscoveryScan(): { direction: string } | null {
  if (pending?.kind === 'launch') return { direction: pending.direction }
  if (!activeDiscovery) return null
  const done = Date.now() >= new Date(activeDiscovery.completesAt).getTime()
  return done ? null : { direction: String(activeDiscovery.direction) }
}

// Set the instant a direction (or COMPLETE) is clicked, so the desk reacts before the server answers.
let pending: { kind: 'launch' | 'complete'; direction: string } | null = null
let currentSystem: StarSystem | null = null
let allSystems: StarSystem[] = []
let deskRoot: Entity | null = null
let topRoot: Entity | null = null
// The mini map and its hover arrows keep their original coordinate frame under this sub-root.
let panelRoot: Entity | null = null

const ARROW_ICON = 'assets/icons/arrow-icon.png'
const ARROW_SIZE = 0.1
const ARROW_DISTANCE = 0.08
const MAP_RADIUS = 0.765

let onDiscoveryNotify: ((text: string, color: Color4) => void) | null = null
let onDiscoveryComplete: ((systemId: string, systemName: string) => void) | null = null
export function setDiscoveryNotifyCallback(cb: (text: string, color: Color4) => void): void { onDiscoveryNotify = cb }
export function setDiscoveryCompleteCallback(cb: (systemId: string, systemName: string) => void): void { onDiscoveryComplete = cb }

// Mini-map center in the legacy frame (used by the hover arrows)
const mapXStored = 0, mapCenterYStored = 0, mapZStored = 0

export async function createDiscoveryPanel(systems: StarSystem[], playerCurrentSystemId: string | null): Promise<void> {
  clearDiscoveryPanel()
  allSystems = systems
  currentSystem = systems.find(s => s.id === playerCurrentSystemId) || null
  try {
    const [options, active] = await Promise.all([api.getDiscoveryOptions(), api.getActiveDiscovery()])
    discoveryOptions = options; activeDiscovery = active
  } catch { return }

  // DISPLAY_CENTER is the desk face's lower front edge; the screen root sits mid-face, 1.1m up the slope.
  const cos50 = Math.cos(50 * Math.PI / 180), sin50 = Math.sin(50 * Math.PI / 180)
  // Lifted 0.15m off the face along its normal so nothing sits inside the desk's own surface.
  const upSlope = 1.0, offFace = 0.15
  deskRoot = engine.addEntity()
  Transform.create(deskRoot, { position: Vector3.create(DISPLAY_CENTER.x, DISPLAY_CENTER.y + upSlope * cos50 + offFace * sin50, DISPLAY_CENTER.z - upSlope * sin50 + offFace * cos50), rotation: DESK_ROT })
  // Upright panel floating behind and above the desk, high enough that the desk does not hide its bottom.
  topRoot = engine.addEntity()
  Transform.create(topRoot, { position: Vector3.create(DISPLAY_CENTER.x, DISPLAY_CENTER.y + 2.6, DISPLAY_CENTER.z - 1.8), rotation: UPRIGHT_ROT })
  hideInTopView(deskRoot); hideInTopView(topRoot)
  registerDimmableScreen(topRoot, 2.8, 0.85)          // upright panel: 5.6 × 1.7 frame
  registerDimmableScreen(deskRoot, 2.75, 1.15, -0.05)  // desk face: content from y -1.12 to 1.0

  drawUpright(topRoot)
  drawDesk(deskRoot)
}

function drawUpright(root: Entity): void {
  const W = 5.6, H = 1.7
  frame(bag, root, 0, 0, W, H)
  line(bag, root, -2.62, 0.62, -2.62, 0.32, CYAN3, { thickness: 0.03 })
  header(bag, root, -2.5, 0.5, { title: 'STELLAR DISCOVERY', subtitle: 'plot your course', size: 0.7 })
  icon(bag, root, 0.85, 0.5, 0.28, ICONS.coordinates)
  text(bag, root, 1.1, 0.58, 'STELLAR CARTOGRAPHY', 0.2, DIM, LEFT)
  text(bag, root, 1.1, 0.4, 'V2.4.1', 0.2, DIM, LEFT)
  bar(bag, root, 2.15, 0.4, 0.7, 0.3, { h: 0.05 })

  // Two cells
  frame(bag, root, 0, -0.32, W - 0.3, 0.85, { border: Color3.create(0.1, 0.5, 0.65) })
  line(bag, root, 0, 0.05, 0, -0.7, CYAN3, { thickness: 0.01, alpha: 0.6 })
  // Flush left in the cell: icon against the border, label and value sharing one left edge.
  icon(bag, root, -2.45, -0.12, 0.3, ICONS.coordinates)
  text(bag, root, -2.22, -0.12, 'GALACTIC COORDINATES', 0.24, DIM, LEFT)
  // In transit the ship is between systems: no system name, and the origin's coordinates no longer apply.
  const inTransit = isCurrentlyTraveling()
  const coordText = inTransit ? 'R: —   Θ: —   Z: —' : currentSystem ? `R: ${currentSystem.coord_r.toFixed(1)}   Θ: ${(currentSystem.coord_theta * 180 / Math.PI).toFixed(1)}°   Z: ${currentSystem.coord_z.toFixed(1)}` : 'R: ?   Θ: ?   Z: ?'
  text(bag, root, -2.22, -0.48, coordText, 0.34, WHITE, LEFT)
  icon(bag, root, 0.2, -0.12, 0.3, ICONS.system)
  text(bag, root, 0.43, -0.12, 'CURRENT STAR SYSTEM', 0.24, DIM, LEFT)
  text(bag, root, 0.43, -0.48, inTransit ? 'Deep space' : (currentSystem?.name || 'Unknown'), 0.5, CYAN, LEFT)
}

function drawDesk(root: Entity): void {
  // Left: travel vector
  header(bag, root, -2.65, 1.0, { icon: ICONS.travel, title: 'TRAVEL VECTOR', subtitle: 'select direction', size: 0.55 })
  if (pending) drawPending(root)
  else if (activeDiscovery) drawActiveDiscovery(root)
  else drawDirectionButtons(root)

  // Right: galactic map
  frame(bag, root, 1.4, -0.2, 2.6, 2.05)
  header(bag, root, 0.15, 1.0, { icon: ICONS.map, title: 'GALACTIC MAP', subtitle: 'local sector view', size: 0.55 })
  drawMiniMap(root, 1.45, -0.25)
  // Legend
  const lx = 2.15, ly = 0.55
  dot(bag, root, lx, ly, 0.05, Color3.create(1, 0.85, 0.4)); text(bag, root, lx + 0.1, ly, 'CORE', 0.14, DIM, LEFT)
  dot(bag, root, lx, ly - 0.16, 0.04, Color3.create(0.6, 0.6, 0.6)); text(bag, root, lx + 0.1, ly - 0.16, 'STAR SYSTEM', 0.14, DIM, LEFT)
  dot(bag, root, lx, ly - 0.32, 0.05, Color3.create(0, 1, 0.5)); text(bag, root, lx + 0.1, ly - 0.32, 'YOU ARE HERE', 0.14, DIM, LEFT)

  // Footer
  text(bag, root, -2.6, -1.12, 'CHART  //  DISCOVER  //  NAVIGATE', 0.16, MUTED, LEFT)
  text(bag, root, 2.6, -1.12, 'EXPLORE  //  NAVIGATE  //  GO FURTHER', 0.16, MUTED, RIGHT)
}

function drawDirectionButtons(root: Entity): void {
  const hoverTexts: Record<string, string> = { inward: 'Search Inwards', lateral: 'Search Laterally', outward: 'Search Outwards', vertical: 'Search Vertically' }
  const directions: { dir: string; label: string; variant: 'magenta' | 'outline'; color: Color3; iconSrc: string; y: number }[] = [
    { dir: 'inward', label: 'INWARD', variant: 'magenta', color: MAGENTA3, iconSrc: ICONS.inward, y: 0.5 },
    { dir: 'lateral', label: 'LATERAL', variant: 'outline', color: CYAN3, iconSrc: ICONS.lateral, y: 0.06 },
    { dir: 'vertical', label: 'VERTICAL', variant: 'magenta', color: MAGENTA3, iconSrc: ICONS.vertical, y: -0.38 },
    { dir: 'outward', label: 'OUTWARD', variant: 'outline', color: CYAN3, iconSrc: ICONS.outward, y: -0.82 },
  ]
  for (const d of directions) {
    const option = discoveryOptions.find((o: any) => o.direction === d.dir)
    const mins = option?.estimatedMinutes || 0
    const hrs = Math.floor(mins / 60); const m = mins % 60
    const timeStr = hrs > 0 ? `${hrs}h ${m}m` : `${m}m`
    const description = option?.description || ''
    const btn = button(bag, root, -1.4, d.y, 2.5, 0.36, d.label, hoverTexts[d.dir], () => handleStartDiscovery(d.dir), { variant: d.variant, icon: d.iconSrc, size: 0.36 })
    text(bag, root, -0.25, d.y, '»', 0.4, d.variant === 'magenta' ? MAGENTA : CYAN, RIGHT, -0.05)
    pointerEventsSystem.onPointerHoverEnter({ entity: btn }, () => { showDirectionArrows(d.dir, d.color); setDiscoveryDescription(`${description}  —  Est. ${timeStr}`) })
    pointerEventsSystem.onPointerHoverLeave({ entity: btn }, () => { hideArrows(); setDiscoveryDescription(null) })
  }
}

/** Launch / completion in flight: the direction buttons are gone (nothing to double-click) and a spinner shows. */
function drawPending(root: Entity): void {
  const p = pending!
  frame(bag, root, -1.4, -0.15, 2.5, 1.7, { border: MAGENTA3 })
  spinner(bag, root, -1.4, 0.3, 0.42)
  text(bag, root, -1.4, -0.1, p.kind === 'launch' ? 'LAUNCHING PROBE' : 'LOCKING SIGNAL', 0.34, MAGENTA)
  text(bag, root, -1.4, -0.38, `${p.direction.toUpperCase()} VECTOR`, 0.24, WHITE)
  text(bag, root, -1.4, -0.62, p.kind === 'launch' ? 'CALCULATING TRAJECTORY…' : 'RESOLVING NEW STAR SYSTEM…', 0.18, DIM)
}

/** Redraw both screens from the state already in hand (no server round trip). */
export function refreshDiscoveryPanel(): void { redraw() }

function redraw(): void {
  if (!deskRoot || !topRoot) return
  hideArrows()
  clearBag(bag)
  for (const e of miniMapEntities) engine.removeEntity(e); miniMapEntities.length = 0
  if (panelRoot) { engine.removeEntity(panelRoot); panelRoot = null }
  drawUpright(topRoot)
  drawDesk(deskRoot)
}

function drawActiveDiscovery(root: Entity): void {
  frame(bag, root, -1.4, -0.15, 2.5, 1.7, { border: MAGENTA3 })
  const timeLeft = Math.max(0, Math.ceil((new Date(activeDiscovery.completesAt).getTime() - Date.now()) / 60000))
  const isReady = timeLeft <= 0
  const total = activeDiscovery.durationMinutes || Math.max(timeLeft, 1)
  text(bag, root, -1.4, 0.35, `SEARCHING ${String(activeDiscovery.direction).toUpperCase()}`, 0.34, MAGENTA)
  text(bag, root, -1.4, 0.05, isReady ? 'SIGNAL LOCKED — READY' : `${timeLeft}m remaining`, 0.26, isReady ? GREEN : WHITE)
  bar(bag, root, -1.4, -0.25, 2.0, isReady ? 1 : 1 - timeLeft / total, { h: 0.1, color: MAGENTA3 })
  if (isReady) button(bag, root, -1.4, -0.65, 1.8, 0.36, 'COMPLETE DISCOVERY', 'Complete Discovery', () => handleCompleteDiscovery(activeDiscovery.id), { variant: 'primary', size: 0.3 })
  else text(bag, root, -1.4, -0.65, 'PROBE EN ROUTE', 0.2, MUTED)
}

/** Mini galaxy map at (cx, cy) on the desk root, drawn in its original frame under `panelRoot`. */
/** The ship's galactic x/y for the mini map: its system, or interpolated along the route in transit. */
function shipPosition(): { x: number; y: number; label: string } | null {
  const dest = getTravelDestination()
  if (currentSystem && dest) {
    const f = getTravelFraction()
    return { x: currentSystem.coord_x + (dest.coord_x - currentSystem.coord_x) * f, y: currentSystem.coord_y + (dest.coord_y - currentSystem.coord_y) * f, label: 'IN TRANSIT' }
  }
  if (isCurrentlyTraveling()) return null   // destination not known yet: don't pin the ship to the origin
  return currentSystem ? { x: currentSystem.coord_x, y: currentSystem.coord_y, label: currentSystem.name } : null
}

function drawMiniMap(root: Entity, cx: number, cy: number): void {
  panelRoot = engine.addEntity()
  // Half-turn sub-root: the old map code used +z toward the viewer and yaw-180 text.
  Transform.create(panelRoot, { position: Vector3.create(cx, cy, -0.06), rotation: Quaternion.fromEulerDegrees(0, 180, 0), scale: Vector3.create(0.9, 0.9, 0.9), parent: root })
  const mapX = mapXStored, mapCenterY = mapCenterYStored, mapZ = mapZStored

  let maxR = 1
  for (const s of allSystems) { const dist = Math.sqrt(s.coord_x ** 2 + s.coord_y ** 2); if (dist > maxR) maxR = dist }
  const mapScale = MAP_RADIUS / maxR
  // Where the ship is: its system, or partway along the route while travelling (never naming the origin).
  const here = shipPosition()
  const rotAngle = here ? -Math.atan2(here.y, here.x) - Math.PI / 2 : 0
  const cosR = Math.cos(rotAngle); const sinR = Math.sin(rotAngle)
  function rotatePoint(x: number, y: number) { return { rx: x * cosR - y * sinR, ry: x * sinR + y * cosR } }

  // Nebula dust
  let miniSeed = 42
  function miniRandom(): number { miniSeed = (miniSeed * 16807 + 0) % 2147483647; return (miniSeed - 1) / 2147483646 }
  for (let i = 0; i < 200; i++) {
    const rNorm = Math.pow(miniRandom(), 0.3); const r = rNorm * MAP_RADIUS * 1.5
    const armIndex = i % 5; const armOffset = armIndex * (2 * Math.PI / 5); const windAngle = rNorm * 2.8
    const pe = Math.sin(rNorm * Math.PI); const rt = 1 - Math.pow(Math.max(0, rNorm - 0.85) / 0.15, 2)
    const pw = 0.6 * Math.pow(Math.max(pe, 0.2), 0.5) * rt; const sp = (miniRandom() * 2 - 1) * pw
    const theta = armOffset + windAngle + sp
    const { rx: x, ry: y } = rotatePoint(r * Math.cos(theta), r * Math.sin(theta))
    const d = engine.addEntity()
    Transform.create(d, { position: Vector3.create(mapX + x, mapCenterY + y, 0.02 + mapZ), scale: Vector3.create(0.013, 0.013, 0.013), parent: panelRoot })
    MeshRenderer.setSphere(d)
    Material.setPbrMaterial(d, { albedoColor: Color4.create(0.3, 0.6, 0.7, 0.6), emissiveColor: Color3.create(0.2, 0.5, 0.6), emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
    miniMapEntities.push(d)
  }
  // Orbit guides
  for (const r of [0.25, 0.45, 0.65]) ringLegacy(mapX, mapCenterY, r * MAP_RADIUS / 0.765, 0.01 + mapZ)
  // Core glow
  const coreGlow = engine.addEntity()
  Transform.create(coreGlow, { position: Vector3.create(mapX, mapCenterY, 0.02 + mapZ), scale: Vector3.create(0.15, 0.15, 0.01), parent: panelRoot })
  MeshRenderer.setSphere(coreGlow)
  Material.setPbrMaterial(coreGlow, { albedoColor: Color4.create(1, 0.85, 0.4, 0.4), emissiveColor: Color3.create(1, 0.8, 0.3), emissiveIntensity: 3, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  miniMapEntities.push(coreGlow)
  // Stars
  for (const sys of allSystems) {
    const { rx, ry } = rotatePoint(sys.coord_x * mapScale, sys.coord_y * mapScale)
    const d = engine.addEntity()
    Transform.create(d, { position: Vector3.create(mapX + rx, mapCenterY + ry, 0.04 + mapZ), scale: Vector3.create(0.012, 0.012, 0.012), parent: panelRoot })
    MeshRenderer.setSphere(d)
    Material.setPbrMaterial(d, { albedoColor: Color4.create(0.7, 0.8, 0.9, 0.8), emissiveColor: Color3.create(0.5, 0.6, 0.7), emissiveIntensity: 1.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
    miniMapEntities.push(d)
  }
  // Current marker with a callout
  if (here) {
    const { rx, ry } = rotatePoint(here.x * mapScale, here.y * mapScale)
    const marker = engine.addEntity()
    Transform.create(marker, { position: Vector3.create(mapX + rx, mapCenterY + ry, 0.05 + mapZ), scale: Vector3.create(0.035, 0.035, 0.035), parent: panelRoot })
    MeshRenderer.setSphere(marker)
    Material.setPbrMaterial(marker, { albedoColor: Color4.create(0, 1, 0.5, 1), emissiveColor: Color3.create(0, 1, 0.5), emissiveIntensity: 5 })
    miniMapEntities.push(marker)
    // Callout drawn on the desk root (station frame): mirror x from the legacy frame, scale 0.9.
    const mx = cx - rx * 0.9, my = cy + ry * 0.9
    const tx = Math.min(2.45, mx + 0.35), ty = my + 0.22
    line(bag, root, mx, my, tx - 0.05, ty, CYAN3, { thickness: 0.006, z: -0.07 })
    frame(bag, root, tx + 0.3, ty, 0.7, 0.16, { fill: Color4.create(0.02, 0.05, 0.12, 1), z: -0.07 })
    text(bag, root, tx + 0.3, ty, here.label, 0.13, WHITE, TextAlignMode.TAM_MIDDLE_CENTER, -0.085)
  }
}

function ringLegacy(cx: number, cy: number, r: number, z: number): void {
  const n = 40
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2
    const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create((x0 + x1) / 2, (y0 + y1) / 2, z), scale: Vector3.create(Math.hypot(x1 - x0, y1 - y0), 0.005, 0.003), rotation: Quaternion.fromEulerDegrees(0, 0, Math.atan2(y1 - y0, x1 - x0) * 180 / Math.PI), parent: panelRoot! })
    MeshRenderer.setBox(e)
    Material.setPbrMaterial(e, { albedoColor: Color4.create(0.1, 0.4, 0.55, 0.6), emissiveColor: Color3.create(0.1, 0.4, 0.55), emissiveIntensity: 1.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
    miniMapEntities.push(e)
  }
}

function createArrow(x: number, y: number, z: number, rotationDeg: number, color: Color3, perpendicular: boolean = false): Entity {
  const arrow = engine.addEntity()
  const rot = perpendicular
    ? Quaternion.multiply(Quaternion.fromEulerDegrees(90, 0, 0), Quaternion.fromEulerDegrees(0, 180, rotationDeg))
    : Quaternion.fromEulerDegrees(0, 180, rotationDeg)
  Transform.create(arrow, { position: Vector3.create(x, y, z), scale: Vector3.create(ARROW_SIZE, ARROW_SIZE, 1), rotation: rot, parent: panelRoot! })
  MeshRenderer.setPlane(arrow)
  Material.setPbrMaterial(arrow, {
    texture: Material.Texture.Common({ src: ARROW_ICON }), emissiveTexture: Material.Texture.Common({ src: ARROW_ICON }),
    albedoColor: Color4.create(color.r, color.g, color.b, 1), emissiveColor: color, emissiveIntensity: 4, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  arrowEntities.push(arrow)
  return arrow
}

function showDirectionArrows(direction: string, color: Color3): void {
  hideArrows()
  if (!currentSystem || !panelRoot) return
  let maxR = 1
  for (const s of allSystems) { const dist = Math.sqrt(s.coord_x ** 2 + s.coord_y ** 2); if (dist > maxR) maxR = dist }
  const mapScale = MAP_RADIUS / maxR
  const rotA = -Math.atan2(currentSystem.coord_y, currentSystem.coord_x) - Math.PI / 2
  const c = Math.cos(rotA), sn = Math.sin(rotA)
  const sx = currentSystem.coord_x * mapScale, sy = currentSystem.coord_y * mapScale
  const rotCX = sx * c - sy * sn, rotCY = sx * sn + sy * c
  const cx = mapXStored + rotCX, cy = mapCenterYStored + rotCY, cz = 0.06 + mapZStored
  const angleToCenter = Math.atan2(rotCY, rotCX)
  const lateralAngle = angleToCenter + Math.PI / 2
  switch (direction) {
    case 'inward':
      createArrow(cx - Math.cos(angleToCenter) * ARROW_DISTANCE, cy - Math.sin(angleToCenter) * ARROW_DISTANCE, cz, -(angleToCenter * 180 / Math.PI), color)
      break
    case 'outward':
      createArrow(cx + Math.cos(angleToCenter) * ARROW_DISTANCE, cy + Math.sin(angleToCenter) * ARROW_DISTANCE, cz, -(angleToCenter * 180 / Math.PI) + 180, color)
      break
    case 'lateral':
      createArrow(cx + Math.cos(lateralAngle) * ARROW_DISTANCE, cy + Math.sin(lateralAngle) * ARROW_DISTANCE, cz, -(lateralAngle * 180 / Math.PI) + 180, color)
      createArrow(cx - Math.cos(lateralAngle) * ARROW_DISTANCE, cy - Math.sin(lateralAngle) * ARROW_DISTANCE, cz, -(lateralAngle * 180 / Math.PI), color)
      break
    case 'vertical':
      createArrow(cx, cy, cz + ARROW_DISTANCE, 90, color, true)
      createArrow(cx, cy, cz - ARROW_DISTANCE, -90, color, true)
      break
  }
}

function hideArrows(): void { for (const e of arrowEntities) engine.removeEntity(e); arrowEntities = [] }

async function handleStartDiscovery(direction: string): Promise<void> {
  if (pending) return
  pending = { kind: 'launch', direction }
  setDiscoveryDescription(null)
  redraw()
  try {
    const result = await api.startDiscovery(direction)
    if (onDiscoveryNotify) { const mins = result.durationMinutes; const hrs = Math.floor(mins / 60); const m = mins % 60; onDiscoveryNotify(`Discovery started: ${direction} — ETA ${hrs > 0 ? `${hrs}h ${m}m` : `${m}m`}`, Color4.create(0, 1, 1, 1)) }
    activeDiscovery = await api.getActiveDiscovery()
  } catch (err: any) { if (onDiscoveryNotify) onDiscoveryNotify(err.message || 'Discovery failed', Color4.create(1, 0.3, 0.3, 1)) }
  pending = null
  redraw()
}

async function handleCompleteDiscovery(discoveryId: string): Promise<void> {
  if (pending) return
  pending = { kind: 'complete', direction: String(activeDiscovery?.direction ?? '') }
  redraw()
  try {
    const result = await api.completeDiscovery(discoveryId)
    if (onDiscoveryNotify) onDiscoveryNotify(`New system discovered: ${result.systemName || 'Unknown'}!`, Color4.create(0, 1, 0.5, 1))
    activeDiscovery = null
    if (onDiscoveryComplete && result.systemId) onDiscoveryComplete(result.systemId, result.systemName || 'Unknown')
    pending = null
    await createDiscoveryPanel(allSystems, currentSystem?.id || null)
  } catch (err: any) {
    if (onDiscoveryNotify) onDiscoveryNotify(err.message || 'Complete failed', Color4.create(1, 0.3, 0.3, 1))
    pending = null
    redraw()
  }
}

export function clearDiscoveryPanel(): void {
  hideArrows()
  clearBag(bag)
  for (const e of miniMapEntities) engine.removeEntity(e); miniMapEntities.length = 0
  if (panelRoot) { engine.removeEntity(panelRoot); panelRoot = null }
  if (deskRoot) { engine.removeEntity(deskRoot); deskRoot = null }
  if (topRoot) { engine.removeEntity(topRoot); topRoot = null }
  discoveryOptions = []; activeDiscovery = null; pending = null
}

// The active discovery's minutes-remaining ticks down and turns to SIGNAL LOCKED on time.
redrawWhenCountdownChanges(
  () => deskRoot && activeDiscovery && !pending ? String(minutesUntil(activeDiscovery.completesAt)) : '',
  () => redraw(),
)

// In transit the ship marker creeps along the route: redraw at each percent of the trip.
redrawWhenCountdownChanges(
  () => deskRoot && !pending && getTravelDestination() ? String(Math.floor(getTravelFraction() * 100)) : '',
  () => redraw(),
)
