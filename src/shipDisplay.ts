import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'

const DISPLAY_CENTER = Vector3.create(128, 41.3, 146)
const TEXT_ROT = Quaternion.fromEulerDegrees(0, 0, 0)
const STATS_OFFSET_X = -1.75
const MISSIONS_OFFSET_X = 1.6

const displayEntities: Entity[] = []
let missionEntities: Entity[] = []
let shipData: any = null
let expeditions: any[] = []
let missionActionStatus: Record<string, string> = {}
let onMissionNotify: ((text: string, color: Color4) => void) | null = null
let missionPage = 0
const MISSIONS_PER_PAGE = 4

export function setMissionNotifyCallback(cb: (text: string, color: Color4) => void): void { onMissionNotify = cb }

let solarRechargeRate = 0

export function setSolarRechargeRate(rate: number): void {
  solarRechargeRate = rate
}

export async function createShipDisplay(): Promise<void> {
  clearShipDisplay()
  try {
    const [ship, exps] = await Promise.all([api.getShipDashboard(), api.getExpeditions()])
    shipData = ship; expeditions = exps.filter((e: any) => e.status !== 'collected')
  } catch { return }

  const fuelY = DISPLAY_CENTER.y + 2.45
  const fuelPercent = shipData?.ship ? shipData.ship.fuel_current / shipData.ship.fuel_capacity : 0
  const gaugeWidth = 5.5

  // Fuel glass panel
  const fuelPanel = engine.addEntity()
  Transform.create(fuelPanel, { position: Vector3.create(DISPLAY_CENTER.x, fuelY, DISPLAY_CENTER.z), scale: Vector3.create(gaugeWidth + 0.5, 1.0, 0.03) })
  MeshRenderer.setBox(fuelPanel)
  Material.setPbrMaterial(fuelPanel, { albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4), emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  displayEntities.push(fuelPanel)

  // Gauge bg
  const gaugeBase = engine.addEntity()
  Transform.create(gaugeBase, { position: Vector3.create(DISPLAY_CENTER.x, fuelY - 0.1, DISPLAY_CENTER.z + 0.02), scale: Vector3.create(gaugeWidth, 0.3, 0.02) })
  MeshRenderer.setBox(gaugeBase)
  Material.setPbrMaterial(gaugeBase, { albedoColor: Color4.create(0.05, 0.1, 0.05, 0.6), emissiveColor: Color3.create(0, 0.1, 0), emissiveIntensity: 0.5, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  displayEntities.push(gaugeBase)

  // Gauge fill
  const fillWidth = Math.max(0.01, fuelPercent * gaugeWidth)
  const fill = engine.addEntity()
  Transform.create(fill, { position: Vector3.create(DISPLAY_CENTER.x - (gaugeWidth - fillWidth) / 2, fuelY - 0.1, DISPLAY_CENTER.z + 0.03), scale: Vector3.create(fillWidth, 0.25, 0.02) })
  MeshRenderer.setBox(fill)
  Material.setPbrMaterial(fill, { albedoColor: Color4.create(0, 0.8, 0.2, 0.8), emissiveColor: Color3.create(0, 0.6, 0.15), emissiveIntensity: 3, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  displayEntities.push(fill)

  // FUEL label
  const fuelLabel = engine.addEntity()
  Transform.create(fuelLabel, { position: Vector3.create(DISPLAY_CENTER.x - gaugeWidth / 2 - 0.1, fuelY + 0.25, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
  TextShape.create(fuelLabel, { text: 'FUEL', fontSize: 1.2, textColor: Color4.create(0, 1, 0.5, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
  displayEntities.push(fuelLabel)

  // Fuel numbers
  const fuelText = engine.addEntity()
  Transform.create(fuelText, { position: Vector3.create(DISPLAY_CENTER.x + gaugeWidth / 2 + 0.1, fuelY + 0.25, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
  TextShape.create(fuelText, { text: `${shipData.ship.fuel_current.toFixed(0)} / ${shipData.ship.fuel_capacity.toFixed(0)}`, fontSize: 1, textColor: Color4.create(0.8, 0.8, 0.8, 1), textAlign: TextAlignMode.TAM_MIDDLE_RIGHT })
  displayEntities.push(fuelText)

  // Solar recharge rate
  if (solarRechargeRate > 0) {
    const rechargeText = engine.addEntity()
    Transform.create(rechargeText, { position: Vector3.create(DISPLAY_CENTER.x, fuelY - 0.35, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
    TextShape.create(rechargeText, { text: `Solar Recharge: +${solarRechargeRate.toFixed(1)} fuel/hr`, fontSize: 0.6, textColor: Color4.create(1, 0.9, 0.3, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    displayEntities.push(rechargeText)
  }

  // Ship Stats panel
  const statsX = DISPLAY_CENTER.x + STATS_OFFSET_X
  const statsPanel = engine.addEntity()
  Transform.create(statsPanel, { position: Vector3.create(statsX, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z), scale: Vector3.create(2.5, 2.5, 0.03) })
  MeshRenderer.setBox(statsPanel)
  Material.setPbrMaterial(statsPanel, { albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4), emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  displayEntities.push(statsPanel)

  const statsTitle = engine.addEntity()
  Transform.create(statsTitle, { position: Vector3.create(statsX, DISPLAY_CENTER.y + 1.5, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
  TextShape.create(statsTitle, { text: 'SHIP STATS', fontSize: 1.5, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  displayEntities.push(statsTitle)

  const ship = shipData.ship
  const hullR = ship.hull_reinforcement || 0
  const podS = ship.pod_shielding || 0
  const stats = [
    { label: 'Fuel Efficiency', value: `${ship.fuel_efficiency.toFixed(1)}x` },
    { label: 'Cargo Capacity', value: `${ship.resource_storage}` },
    { label: 'Vault Capacity', value: `${ship.specimen_vault}` },
    { label: 'Expedition Speed', value: `${ship.expedition_speed.toFixed(1)}x` },
    { label: 'Blast Shielding', value: `${(hullR * 100).toFixed(0)}%` },
    { label: 'Env. Shielding', value: `${(podS * 100).toFixed(0)}%` },
  ]
  for (let i = 0; i < stats.length; i++) {
    const y = DISPLAY_CENTER.y + 1.0 - i * 0.28
    const l = engine.addEntity()
    Transform.create(l, { position: Vector3.create(statsX - 0.9, y, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
    TextShape.create(l, { text: stats[i].label, fontSize: 0.8, textColor: Color4.create(0.5, 0.5, 0.5, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
    displayEntities.push(l)
    const v = engine.addEntity()
    Transform.create(v, { position: Vector3.create(statsX + 0.9, y, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
    TextShape.create(v, { text: stats[i].value, fontSize: 0.8, textColor: Color4.create(0.9, 0.9, 0.9, 1), textAlign: TextAlignMode.TAM_MIDDLE_RIGHT })
    displayEntities.push(v)
  }

  // Active Missions panel
  createMissionsPanel()
}

function createMissionsPanel(): void {
  for (const e of missionEntities) engine.removeEntity(e)
  missionEntities = []
  const missionsX = DISPLAY_CENTER.x + MISSIONS_OFFSET_X
  const panelHeight = 2.5
  const mp = engine.addEntity()
  Transform.create(mp, { position: Vector3.create(missionsX, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z), scale: Vector3.create(2.8, panelHeight, 0.03) })
  MeshRenderer.setBox(mp)
  Material.setPbrMaterial(mp, { albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4), emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND })
  missionEntities.push(mp)

  const totalPages = Math.max(1, Math.ceil(expeditions.length / MISSIONS_PER_PAGE))
  if (missionPage >= totalPages) missionPage = totalPages - 1
  if (missionPage < 0) missionPage = 0

  const mt = engine.addEntity()
  Transform.create(mt, { position: Vector3.create(missionsX, DISPLAY_CENTER.y + 1.5, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
  TextShape.create(mt, {
    text: totalPages > 1 ? `ACTIVE MISSIONS (${missionPage + 1}/${totalPages})` : 'ACTIVE MISSIONS',
    fontSize: 1.5, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  missionEntities.push(mt)

  if (expeditions.length === 0) {
    const nm = engine.addEntity()
    Transform.create(nm, { position: Vector3.create(missionsX, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
    TextShape.create(nm, { text: 'No active missions', fontSize: 0.8, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    missionEntities.push(nm)
    return
  }

  // Page nav buttons
  if (totalPages > 1) {
    if (missionPage > 0) {
      const prevBtn = engine.addEntity()
      Transform.create(prevBtn, { position: Vector3.create(missionsX - 0.8, DISPLAY_CENTER.y - 0.55, DISPLAY_CENTER.z + 0.02), scale: Vector3.create(0.4, 0.2, 0.04) })
      MeshRenderer.setBox(prevBtn); MeshCollider.setBox(prevBtn)
      Material.setPbrMaterial(prevBtn, { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
      missionEntities.push(prevBtn)
      const prevLabel = engine.addEntity()
      Transform.create(prevLabel, { position: Vector3.create(missionsX - 0.8, DISPLAY_CENTER.y - 0.55, DISPLAY_CENTER.z + 0.05), rotation: TEXT_ROT })
      TextShape.create(prevLabel, { text: '< PREV', fontSize: 0.4, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      missionEntities.push(prevLabel)
      pointerEventsSystem.onPointerDown({ entity: prevBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Previous Page', maxDistance: 10 } }, () => { missionPage--; createMissionsPanel() })
    }
    if (missionPage < totalPages - 1) {
      const nextBtn = engine.addEntity()
      Transform.create(nextBtn, { position: Vector3.create(missionsX + 0.8, DISPLAY_CENTER.y - 0.55, DISPLAY_CENTER.z + 0.02), scale: Vector3.create(0.4, 0.2, 0.04) })
      MeshRenderer.setBox(nextBtn); MeshCollider.setBox(nextBtn)
      Material.setPbrMaterial(nextBtn, { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
      missionEntities.push(nextBtn)
      const nextLabel = engine.addEntity()
      Transform.create(nextLabel, { position: Vector3.create(missionsX + 0.8, DISPLAY_CENTER.y - 0.55, DISPLAY_CENTER.z + 0.05), rotation: TEXT_ROT })
      TextShape.create(nextLabel, { text: 'NEXT >', fontSize: 0.4, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      missionEntities.push(nextLabel)
      pointerEventsSystem.onPointerDown({ entity: nextBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Next Page', maxDistance: 10 } }, () => { missionPage++; createMissionsPanel() })
    }
  }

  const startIdx = missionPage * MISSIONS_PER_PAGE
  const endIdx = Math.min(startIdx + MISSIONS_PER_PAGE, expeditions.length)

  for (let i = startIdx; i < endIdx; i++) {
    const exp = expeditions[i]
    const row = i - startIdx
    const y = DISPLAY_CENTER.y + 1.0 - row * 0.4
    const isComplete = exp.status === 'completed' || (exp.completes_at && new Date(exp.completes_at).getTime() <= Date.now())
    const typeLabel = exp.expedition_type === 'mining' ? 'Mining' : 'Exploration'
    const actionStatus = missionActionStatus[exp.id]
    let timeText: string
    if (actionStatus) timeText = actionStatus
    else if (isComplete) timeText = 'READY'
    else { const mins = Math.max(0, Math.ceil((new Date(exp.completes_at).getTime() - Date.now()) / 60000)); const hrs = Math.floor(mins / 60); timeText = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m` }

    const te = engine.addEntity()
    Transform.create(te, { position: Vector3.create(missionsX - 0.8, y, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
    TextShape.create(te, { text: typeLabel, fontSize: 0.7, textColor: exp.expedition_type === 'mining' ? Color4.create(0.9, 0.7, 0.3, 1) : Color4.create(0.2, 0.8, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
    missionEntities.push(te)

    const ti = engine.addEntity()
    Transform.create(ti, { position: Vector3.create(missionsX + 0.4, y, DISPLAY_CENTER.z + 0.03), rotation: TEXT_ROT })
    TextShape.create(ti, { text: timeText, fontSize: 0.7, textColor: isComplete ? Color4.create(1, 1, 0, 1) : Color4.create(0.6, 0.6, 0.6, 1), textAlign: TextAlignMode.TAM_MIDDLE_RIGHT })
    missionEntities.push(ti)

    if (isComplete && !actionStatus) {
      const btn = engine.addEntity()
      Transform.create(btn, { position: Vector3.create(missionsX + 1.05, y, DISPLAY_CENTER.z + 0.02), scale: Vector3.create(0.5, 0.22, 0.04) })
      MeshRenderer.setBox(btn); MeshCollider.setBox(btn)
      Material.setPbrMaterial(btn, { albedoColor: Color4.create(0, 0.4, 0.5, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
      missionEntities.push(btn)
      const bl = engine.addEntity()
      Transform.create(bl, { position: Vector3.create(missionsX + 1.05, y, DISPLAY_CENTER.z + 0.05), rotation: TEXT_ROT })
      TextShape.create(bl, { text: 'COMPLETE', fontSize: 0.5, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      missionEntities.push(bl)
      pointerEventsSystem.onPointerDown({ entity: btn, opts: { button: InputAction.IA_POINTER, hoverText: 'Complete Mission', maxDistance: 10 } }, () => handleMissionCollect(exp.id))
    }
  }
}

async function handleMissionCollect(expeditionId: string): Promise<void> {
  missionActionStatus[expeditionId] = 'Processing...'
  createMissionsPanel()
  try {
    let result: any = null
    try { result = await api.completeExpedition(expeditionId) } catch {}
    if (result?.pod_lost) {
      if (onMissionNotify) onMissionNotify('Expedition failed — pod destroyed!', Color4.create(1, 0.3, 0.3, 1))
    } else {
      try {
        await api.collectExpedition(expeditionId)
        if (result?.type === 'exploration') {
          const parts: string[] = []
          if (result.newSpecies) parts.push('New species!')
          if (result.sampleCollected) parts.push('Sample collected')
          if (onMissionNotify) onMissionNotify(parts.length > 0 ? `Exploration success! ${parts.join(' — ')}` : 'Exploration complete!', Color4.create(0.2, 0.8, 0.4, 1))
        } else if (result?.rewards) {
          const rt = Object.entries(result.rewards).filter(([k]) => k !== 'species_id').map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')
          if (onMissionNotify) onMissionNotify(rt ? `Mining successful! ${rt}` : 'Mining complete!', Color4.create(0.9, 0.7, 0.3, 1))
        } else { if (onMissionNotify) onMissionNotify('Collected!', Color4.create(0, 1, 0.5, 1)) }
      } catch { if (onMissionNotify) onMissionNotify('Already collected', Color4.create(0.7, 0.7, 0.7, 1)) }
    }
    try { const exps = await api.getExpeditions(); expeditions = exps.filter((e: any) => e.status !== 'collected') } catch {}
    delete missionActionStatus[expeditionId]
    createMissionsPanel()
  } catch (err: any) { missionActionStatus[expeditionId] = err.message || 'Failed'; createMissionsPanel() }
}

export async function refreshMissions(): Promise<void> {
  try {
    const exps = await api.getExpeditions()
    expeditions = exps.filter((e: any) => e.status !== 'collected')
    createMissionsPanel()
  } catch {}
}

export function clearShipDisplay(): void {
  for (const e of displayEntities) engine.removeEntity(e); displayEntities.length = 0
  for (const e of missionEntities) engine.removeEntity(e); missionEntities.length = 0
  shipData = null; expeditions = []; missionActionStatus = {}
}
