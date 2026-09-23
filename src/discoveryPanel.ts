import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { StarSystem } from './types'
import { setDiscoveryDescription } from './ui'
import { DECK_Y } from './environment'

const DISPLAY_CENTER = Vector3.create(128, DECK_Y + 0.55, 114.9)
const DESK_TILT = Quaternion.fromEulerDegrees(-50, 0, 0)

const displayEntities: Entity[] = []
let miniMapEntities: Entity[] = []
let arrowEntities: Entity[] = []
let discoveryOptions: any[] = []
let activeDiscovery: any = null
let currentSystem: StarSystem | null = null
let allSystems: StarSystem[] = []
let panelRoot: Entity | null = null

const ARROW_ICON = 'assets/icons/arrow-icon.png'
const ARROW_SIZE = 0.1
const ARROW_DISTANCE = 0.08

let onDiscoveryNotify: ((text: string, color: Color4) => void) | null = null
let onDiscoveryComplete: ((systemId: string, systemName: string) => void) | null = null
export function setDiscoveryNotifyCallback(cb: (text: string, color: Color4) => void): void { onDiscoveryNotify = cb }
export function setDiscoveryCompleteCallback(cb: (systemId: string, systemName: string) => void): void { onDiscoveryComplete = cb }

let mapCenterYStored = 1.0
let mapZStored = 0
let mapXStored = -1.5

export async function createDiscoveryPanel(systems: StarSystem[], playerCurrentSystemId: string | null): Promise<void> {
  clearDiscoveryPanel()
  allSystems = systems
  currentSystem = systems.find(s => s.id === playerCurrentSystemId) || null
  try {
    const [options, active] = await Promise.all([api.getDiscoveryOptions(), api.getActiveDiscovery()])
    discoveryOptions = options; activeDiscovery = active
  } catch { return }

  panelRoot = engine.addEntity()
  Transform.create(panelRoot, { position: DISPLAY_CENTER, rotation: DESK_TILT, scale: Vector3.create(0.9, 0.9, 0.9) })

  const panelWidth = 6.0; const panelHeight = 2.8
  const mapX = -1.5; const mapZ = 0; const buttonsX = 1.5



  // Coord panel (vertical, world space)
  const cos50 = Math.cos(50 * Math.PI / 180); const sin50 = Math.sin(50 * Math.PI / 180)
  const panelTopLocalY = 1.0 + (panelHeight + 0.5) / 2
  const topWorldY = DISPLAY_CENTER.y + panelTopLocalY * cos50
  const topWorldZ = DISPLAY_CENTER.z + panelTopLocalY * sin50
  const coordPanelZ = topWorldZ - 4.1 + 0.25
  const coordPanelHeight = 1.2
  const coordPanelY = topWorldY + coordPanelHeight / 2 - 0.4

  const coordPanel = engine.addEntity()
  Transform.create(coordPanel, { position: Vector3.create(DISPLAY_CENTER.x, coordPanelY, coordPanelZ), scale: Vector3.create(5.5, coordPanelHeight, 0.03) })
  MeshRenderer.setBox(coordPanel)
  Material.setPbrMaterial(coordPanel, { albedoColor: Color4.create(0.03, 0.1, 0.2, 0.4), emissiveColor: Color3.create(0, 0.15, 0.3), emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  displayEntities.push(coordPanel)

  const sysLabel = engine.addEntity()
  Transform.create(sysLabel, { position: Vector3.create(DISPLAY_CENTER.x - 1.2, coordPanelY + 0.22, coordPanelZ + 0.03), rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  TextShape.create(sysLabel, { text: 'CURRENT STAR SYSTEM', fontSize: 0.4, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
  displayEntities.push(sysLabel)

  const sysName = engine.addEntity()
  Transform.create(sysName, { position: Vector3.create(DISPLAY_CENTER.x - 1.2, coordPanelY - 0.15, coordPanelZ + 0.03), rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  TextShape.create(sysName, { text: currentSystem?.name || 'Unknown', fontSize: 0.8, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
  displayEntities.push(sysName)

  const coordLabel = engine.addEntity()
  Transform.create(coordLabel, { position: Vector3.create(DISPLAY_CENTER.x + 1.2, coordPanelY + 0.22, coordPanelZ + 0.03), rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  TextShape.create(coordLabel, { text: 'GALACTIC COORDINATES', fontSize: 0.4, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_RIGHT })
  displayEntities.push(coordLabel)

  const coordText = currentSystem ? `R: ${currentSystem.coord_r.toFixed(1)}  Θ: ${(currentSystem.coord_theta * 180 / Math.PI).toFixed(1)}°  Z: ${currentSystem.coord_z.toFixed(1)}` : 'R: ?  Θ: ?  Z: ?'
  const coords = engine.addEntity()
  Transform.create(coords, { position: Vector3.create(DISPLAY_CENTER.x + 1.2, coordPanelY - 0.15, coordPanelZ + 0.03), rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  TextShape.create(coords, { text: coordText, fontSize: 0.6, textColor: Color4.create(0.6, 0.6, 0.6, 1), textAlign: TextAlignMode.TAM_MIDDLE_RIGHT })
  displayEntities.push(coords)

  // Mini galaxy map
  const mapCenterY = 1.0
  mapCenterYStored = mapCenterY; mapZStored = mapZ; mapXStored = mapX

  const mapRadius = 0.765
  let maxR = 1
  for (const s of allSystems) { const dist = Math.sqrt(s.coord_x ** 2 + s.coord_y ** 2); if (dist > maxR) maxR = dist }
  const mapScale = mapRadius / maxR

  const rotAngle = currentSystem ? -Math.atan2(currentSystem.coord_y, currentSystem.coord_x) - Math.PI / 2 : 0
  const cosR = Math.cos(rotAngle); const sinR = Math.sin(rotAngle)
  function rotatePoint(x: number, y: number) { return { rx: x * cosR - y * sinR, ry: x * sinR + y * cosR } }

  // Mini nebula
  let miniSeed = 42
  function miniRandom(): number { miniSeed = (miniSeed * 16807 + 0) % 2147483647; return (miniSeed - 1) / 2147483646 }
  for (let i = 0; i < 200; i++) {
    const rNorm = Math.pow(miniRandom(), 0.3); const r = rNorm * mapRadius * 1.5
    const armIndex = i % 5; const armOffset = armIndex * (2 * Math.PI / 5); const windAngle = rNorm * 2.8
    const pe = Math.sin(rNorm * Math.PI); const rt = 1 - Math.pow(Math.max(0, rNorm - 0.85) / 0.15, 2)
    const pw = 0.6 * Math.pow(Math.max(pe, 0.2), 0.5) * rt; const sp = (miniRandom() * 2 - 1) * pw
    const theta = armOffset + windAngle + sp
    const rawX = r * Math.cos(theta); const rawY = r * Math.sin(theta)
    const { rx: x, ry: y } = rotatePoint(rawX, rawY)
    const dot = engine.addEntity()
    Transform.create(dot, { position: Vector3.create(mapX + x, mapCenterY + y, 0.15 + mapZ), scale: Vector3.create(0.013, 0.013, 0.013), parent: panelRoot })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, { albedoColor: Color4.create(0.3, 0.6, 0.7, 0.6), emissiveColor: Color3.create(0.2, 0.5, 0.6), emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
    miniMapEntities.push(dot)
  }

  // Core glow
  const coreGlow = engine.addEntity()
  Transform.create(coreGlow, { position: Vector3.create(mapX, mapCenterY, 0.15 + mapZ), scale: Vector3.create(0.15, 0.15, 0.01), parent: panelRoot })
  MeshRenderer.setSphere(coreGlow)
  Material.setPbrMaterial(coreGlow, { albedoColor: Color4.create(1, 0.85, 0.4, 0.4), emissiveColor: Color3.create(1, 0.8, 0.3), emissiveIntensity: 3, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  miniMapEntities.push(coreGlow)

  // Stars
  for (const sys of allSystems) {
    const { rx, ry } = rotatePoint(sys.coord_x * mapScale, sys.coord_y * mapScale)
    const dot = engine.addEntity()
    Transform.create(dot, { position: Vector3.create(mapX + rx, mapCenterY + ry, 0.17 + mapZ), scale: Vector3.create(0.01, 0.01, 0.01), parent: panelRoot })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, { albedoColor: Color4.create(0.6, 0.6, 0.6, 0.6), emissiveColor: Color3.create(0.4, 0.4, 0.4), emissiveIntensity: 1.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
    miniMapEntities.push(dot)
  }

  // Current marker
  if (currentSystem) {
    const { rx, ry } = rotatePoint(currentSystem.coord_x * mapScale, currentSystem.coord_y * mapScale)
    const marker = engine.addEntity()
    Transform.create(marker, { position: Vector3.create(mapX + rx, mapCenterY + ry, 0.18 + mapZ), scale: Vector3.create(0.03, 0.03, 0.03), parent: panelRoot })
    MeshRenderer.setSphere(marker)
    Material.setPbrMaterial(marker, { albedoColor: Color4.create(0, 1, 0.5, 1), emissiveColor: Color3.create(0, 1, 0.5), emissiveIntensity: 5 })
    miniMapEntities.push(marker)
  }

  // DISCOVERY title
  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(buttonsX, 2.0, 0.03), rotation: Quaternion.fromEulerDegrees(0, 180, 0), parent: panelRoot })
  TextShape.create(title, { text: 'DISCOVERY', fontSize: 1.2, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  displayEntities.push(title)

  if (activeDiscovery) {
    const timeLeft = Math.max(0, Math.ceil((new Date(activeDiscovery.completesAt).getTime() - Date.now()) / 60000))
    const isReady = timeLeft <= 0
    const st = engine.addEntity()
    Transform.create(st, { position: Vector3.create(buttonsX, 1.5, 0.03), rotation: Quaternion.fromEulerDegrees(0, 180, 0), parent: panelRoot })
    TextShape.create(st, { text: isReady ? `Discovery ${activeDiscovery.direction} — READY` : `Discovering ${activeDiscovery.direction}... ${timeLeft}m`, fontSize: 0.7, textColor: isReady ? Color4.create(1, 1, 0, 1) : Color4.create(0.6, 0.6, 0.6, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    displayEntities.push(st)
    if (isReady) {
      const cb = engine.addEntity()
      Transform.create(cb, { position: Vector3.create(buttonsX, 1.0, 0.02), scale: Vector3.create(1.2, 0.3, 0.04), parent: panelRoot })
      MeshRenderer.setBox(cb); MeshCollider.setBox(cb)
      Material.setPbrMaterial(cb, { albedoColor: Color4.create(0, 0.4, 0.5, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
      displayEntities.push(cb)
      const cbl = engine.addEntity()
      Transform.create(cbl, { position: Vector3.create(buttonsX, 1.0, 0.05), rotation: Quaternion.fromEulerDegrees(0, 180, 0), parent: panelRoot })
      TextShape.create(cbl, { text: 'COMPLETE', fontSize: 0.7, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      displayEntities.push(cbl)
      pointerEventsSystem.onPointerDown({ entity: cb, opts: { button: InputAction.IA_POINTER, hoverText: 'Complete Discovery', maxDistance: 10 } }, () => handleCompleteDiscovery(activeDiscovery.id))
    }
    return
  }

  // Direction buttons
  const hoverTexts: Record<string, string> = { inward: 'Search Inwards', lateral: 'Search Laterally', outward: 'Search Outwards', vertical: 'Search Vertically' }
  const directions = [
    { dir: 'inward', label: 'INWARD', color: Color3.create(0.6, 0.1, 0.25), glowColor: Color3.create(0.8, 0.1, 0.3), yOff: 1.65 },
    { dir: 'lateral', label: 'LATERAL', color: Color3.create(0, 0.4, 0.6), glowColor: Color3.create(0, 0.5, 0.8), yOff: 1.2 },
    { dir: 'vertical', label: 'VERTICAL', color: Color3.create(0.35, 0.1, 0.6), glowColor: Color3.create(0.5, 0.1, 0.8), yOff: 0.75 },
    { dir: 'outward', label: 'OUTWARD', color: Color3.create(0, 0.5, 0.3), glowColor: Color3.create(0, 0.7, 0.4), yOff: 0.3 },
  ]

  for (const d of directions) {
    const option = discoveryOptions.find((o: any) => o.direction === d.dir)
    const mins = option?.estimatedMinutes || 0
    const hrs = Math.floor(mins / 60); const m = mins % 60
    const timeStr = hrs > 0 ? `${hrs}h ${m}m` : `${m}m`
    const description = option?.description || ''

    const btn = engine.addEntity()
    Transform.create(btn, { position: Vector3.create(buttonsX, d.yOff, 0.2), scale: Vector3.create(2.0, 0.3, 0.04), parent: panelRoot })
    MeshRenderer.setBox(btn); MeshCollider.setBox(btn)
    Material.setPbrMaterial(btn, { albedoColor: Color4.create(0.02, 0.02, 0.05, 1), emissiveColor: d.glowColor, emissiveIntensity: 2 })
    displayEntities.push(btn)

    pointerEventsSystem.onPointerDown({ entity: btn, opts: { button: InputAction.IA_POINTER, hoverText: hoverTexts[d.dir] || d.label, maxDistance: 10 } }, () => handleStartDiscovery(d.dir))

    const label = engine.addEntity()
    Transform.create(label, { position: Vector3.create(buttonsX, d.yOff, 0.23), rotation: Quaternion.fromEulerDegrees(0, 180, 0), parent: panelRoot })
    TextShape.create(label, { text: d.label, fontSize: 0.6, textColor: Color4.create(d.color.r, d.color.g, d.color.b, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    displayEntities.push(label)

    pointerEventsSystem.onPointerHoverEnter({ entity: btn }, () => {
      showDirectionArrows(d.dir, d.color)
      setDiscoveryDescription(`${description}  —  Est. ${timeStr}`)
    })
    pointerEventsSystem.onPointerHoverLeave({ entity: btn }, () => { hideArrows(); setDiscoveryDescription(null) })
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
  const mapScale = 0.765 / maxR
  const rotA = -Math.atan2(currentSystem.coord_y, currentSystem.coord_x) - Math.PI / 2
  const c = Math.cos(rotA), sn = Math.sin(rotA)
  const sx = currentSystem.coord_x * mapScale, sy = currentSystem.coord_y * mapScale
  const rotCX = sx * c - sy * sn, rotCY = sx * sn + sy * c
  const cx = mapXStored + rotCX, cy = mapCenterYStored + rotCY, cz = 0.18 + mapZStored
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
  try {
    const result = await api.startDiscovery(direction)
    if (onDiscoveryNotify) { const mins = result.durationMinutes; const hrs = Math.floor(mins / 60); const m = mins % 60; onDiscoveryNotify(`Discovery started: ${direction} — ETA ${hrs > 0 ? `${hrs}h ${m}m` : `${m}m`}`, Color4.create(0, 1, 1, 1)) }
    activeDiscovery = await api.getActiveDiscovery()
    await createDiscoveryPanel(allSystems, currentSystem?.id || null)
  } catch (err: any) { if (onDiscoveryNotify) onDiscoveryNotify(err.message || 'Discovery failed', Color4.create(1, 0.3, 0.3, 1)) }
}

async function handleCompleteDiscovery(discoveryId: string): Promise<void> {
  try {
    const result = await api.completeDiscovery(discoveryId)
    if (onDiscoveryNotify) onDiscoveryNotify(`New system discovered: ${result.systemName || 'Unknown'}!`, Color4.create(0, 1, 0.5, 1))
    activeDiscovery = null
    if (onDiscoveryComplete && result.systemId) {
      onDiscoveryComplete(result.systemId, result.systemName || 'Unknown')
    }
    await createDiscoveryPanel(allSystems, currentSystem?.id || null)
  } catch (err: any) { if (onDiscoveryNotify) onDiscoveryNotify(err.message || 'Complete failed', Color4.create(1, 0.3, 0.3, 1)) }
}

export function clearDiscoveryPanel(): void {
  hideArrows()
  for (const e of displayEntities) engine.removeEntity(e); displayEntities.length = 0
  for (const e of miniMapEntities) engine.removeEntity(e); miniMapEntities.length = 0
  if (panelRoot) { engine.removeEntity(panelRoot); panelRoot = null }
  discoveryOptions = []; activeDiscovery = null
}
