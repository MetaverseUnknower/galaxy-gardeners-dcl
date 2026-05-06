import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'

// East edge of platform, facing -X (inward toward center)
const DISPLAY_CENTER = Vector3.create(146, 42.0, 128)
const TEXT_ROT = Quaternion.fromEulerDegrees(0, 90, 0) // faces -X (toward center)

const displayEntities: Entity[] = []
let upgradeData: any[] = []
let upgradeActionStatus: Record<string, string> = {}

let onUpgradeNotify: ((text: string, color: Color4) => void) | null = null

export function setUpgradeNotifyCallback(cb: (text: string, color: Color4) => void): void {
  onUpgradeNotify = cb
}

const CATEGORY_LABELS: Record<string, string> = {
  fuel_tank: 'Fuel Tank',
  fuel_efficiency: 'Fuel Efficiency',
  cargo_hold: 'Cargo Hold',
  specimen_vault: 'Specimen Vault',
  mining_bay: 'Mining Bay',
  exploration_bay: 'Exploration Bay',
  expedition_speed: 'Expedition Speed',
  hull_reinforcement: 'Blast Shielding',
  pod_shielding: 'Env. Shielding',
  discovery_array: 'Discovery Array',
}

// Consistent color for all upgrade labels
const UPGRADE_LABEL_COLOR = Color3.create(0, 0.8, 1)

export async function createUpgradesPanel(): Promise<void> {
  clearUpgradesPanel()

  try {
    upgradeData = await api.getAvailableUpgrades()
  } catch { return }

  // Title panel
  const titlePanel = engine.addEntity()
  Transform.create(titlePanel, {
    position: Vector3.create(DISPLAY_CENTER.x, DISPLAY_CENTER.y + 2.2, DISPLAY_CENTER.z),
    scale: Vector3.create(0.03, 0.8, 7.0)
  })
  MeshRenderer.setBox(titlePanel)
  Material.setPbrMaterial(titlePanel, {
    albedoColor: Color4.create(0.03, 0.1, 0.2, 0.4), emissiveColor: Color3.create(0, 0.15, 0.3),
    emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  displayEntities.push(titlePanel)

  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(DISPLAY_CENTER.x - 0.03, DISPLAY_CENTER.y + 2.2, DISPLAY_CENTER.z), rotation: TEXT_ROT })
  TextShape.create(title, { text: 'SHIP UPGRADES', fontSize: 1.5, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  displayEntities.push(title)

  // Main glass panel — wider for 2 columns
  const panelHeight = 3.0
  const panelWidth = 7.0
  const mainPanel = engine.addEntity()
  Transform.create(mainPanel, {
    position: Vector3.create(DISPLAY_CENTER.x, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z),
    scale: Vector3.create(0.03, panelHeight, panelWidth)
  })
  MeshRenderer.setBox(mainPanel)
  Material.setPbrMaterial(mainPanel, {
    albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4),
    emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  displayEntities.push(mainPanel)

  if (upgradeData.length === 0) {
    const noUpgrades = engine.addEntity()
    Transform.create(noUpgrades, { position: Vector3.create(DISPLAY_CENTER.x - 0.03, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z), rotation: TEXT_ROT })
    TextShape.create(noUpgrades, { text: 'All upgrades maxed!', fontSize: 0.8, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
    displayEntities.push(noUpgrades)
    return
  }

  const colOffsets = [1.7, -1.7] // Z offsets for left and right columns
  const rowSpacing = 0.45

  for (let i = 0; i < upgradeData.length; i++) {
    const upgrade = upgradeData[i]
    const col = i < 5 ? 0 : 1
    const row = i < 5 ? i : i - 5
    const colZ = DISPLAY_CENTER.z + colOffsets[col]
    const y = DISPLAY_CENTER.y + 1.5 - row * rowSpacing
    const label = CATEGORY_LABELS[upgrade.category] || upgrade.category.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
    const actionStatus = upgradeActionStatus[upgrade.category]

    const costs = Object.entries(upgrade.resourceCosts as Record<string, number>)
      .map(([k, v]) => `${v} ${k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}`)
      .join(', ')

    // Category label
    const catLabel = engine.addEntity()
    Transform.create(catLabel, { position: Vector3.create(DISPLAY_CENTER.x - 0.03, y, colZ + 1.2), rotation: TEXT_ROT })
    TextShape.create(catLabel, { text: `${label} T${upgrade.tier}`, fontSize: 0.5, textColor: Color4.create(UPGRADE_LABEL_COLOR.r, UPGRADE_LABEL_COLOR.g, UPGRADE_LABEL_COLOR.b, 1), textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
    displayEntities.push(catLabel)

    // Cost
    const costLabel = engine.addEntity()
    Transform.create(costLabel, { position: Vector3.create(DISPLAY_CENTER.x - 0.03, y - 0.18, colZ + 1.2), rotation: TEXT_ROT })
    TextShape.create(costLabel, {
      text: actionStatus || costs,
      fontSize: 0.35,
      textColor: actionStatus ? Color4.create(0, 1, 0.5, 1) : (upgrade.canAfford ? Color4.create(0.7, 0.7, 0.7, 1) : Color4.create(0.8, 0.3, 0.3, 1)),
      textAlign: TextAlignMode.TAM_MIDDLE_LEFT
    })
    displayEntities.push(costLabel)

    // Upgrade button
    if (upgrade.canAfford && !actionStatus) {
      const btn = engine.addEntity()
      Transform.create(btn, {
        position: Vector3.create(DISPLAY_CENTER.x - 0.02, y - 0.08, colZ - 0.5),
        scale: Vector3.create(0.04, 0.3, 0.5)
      })
      MeshRenderer.setBox(btn); MeshCollider.setBox(btn)
      Material.setPbrMaterial(btn, {
        albedoColor: Color4.create(0, 0.4, 0.5, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5
      })
      displayEntities.push(btn)

      const btnLabel = engine.addEntity()
      Transform.create(btnLabel, { position: Vector3.create(DISPLAY_CENTER.x - 0.05, y - 0.08, colZ - 0.5), rotation: TEXT_ROT })
      TextShape.create(btnLabel, { text: 'UPGRADE', fontSize: 0.4, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      displayEntities.push(btnLabel)

      pointerEventsSystem.onPointerDown(
        { entity: btn, opts: { button: InputAction.IA_POINTER, hoverText: `Upgrade ${label}`, maxDistance: 10 } },
        () => handleUpgrade(upgrade.category, label)
      )
    } else if (!actionStatus) {
      const insuffLabel = engine.addEntity()
      Transform.create(insuffLabel, { position: Vector3.create(DISPLAY_CENTER.x - 0.03, y - 0.08, colZ - 0.5), rotation: TEXT_ROT })
      TextShape.create(insuffLabel, { text: 'NEED RESOURCES', fontSize: 0.3, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      displayEntities.push(insuffLabel)
    }
  }
}

async function handleUpgrade(category: string, label: string): Promise<void> {
  upgradeActionStatus[category] = 'Upgrading...'
  await createUpgradesPanel()
  try {
    await api.applyUpgrade(category)
    if (onUpgradeNotify) onUpgradeNotify(`${label} upgraded!`, Color4.create(0, 1, 0.5, 1))
    delete upgradeActionStatus[category]
    upgradeData = await api.getAvailableUpgrades()
    await createUpgradesPanel()
  } catch (err: any) {
    if (onUpgradeNotify) onUpgradeNotify(err.message || 'Upgrade failed', Color4.create(1, 0.3, 0.3, 1))
    delete upgradeActionStatus[category]
    await createUpgradesPanel()
  }
}

export function clearUpgradesPanel(): void {
  for (const e of displayEntities) engine.removeEntity(e)
  displayEntities.length = 0
  upgradeActionStatus = {}
}
