import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'

// West edge of platform, facing +X (inward toward center)
const DISPLAY_CENTER = Vector3.create(110, 41.5, 128)
const TEXT_ROT = Quaternion.fromEulerDegrees(0, -90, 0) // faces +X

const displayEntities: Entity[] = []
let catalogData: any[] = []
let catalogPage = 0
const ITEMS_PER_PAGE = 4

const RARITY_COLORS: Record<string, Color4> = {
  common: Color4.create(0.6, 0.6, 0.6, 1),
  uncommon: Color4.create(0.2, 0.8, 0.3, 1),
  rare: Color4.create(0.2, 0.5, 1, 1),
  epic: Color4.create(0.7, 0.3, 1, 1),
  legendary: Color4.create(1, 0.7, 0.1, 1),
  mythic: Color4.create(1, 0.3, 0.5, 1),
}

export async function createCatalogPanel(): Promise<void> {
  clearCatalogPanel()

  try {
    catalogData = await api.getCatalog()
  } catch { return }

  renderPage()
}

function renderPage(): void {
  // Clear previous page entities (keep title/panel)
  for (const e of displayEntities) engine.removeEntity(e)
  displayEntities.length = 0

  const totalPages = Math.max(1, Math.ceil(catalogData.length / ITEMS_PER_PAGE))
  if (catalogPage >= totalPages) catalogPage = totalPages - 1
  if (catalogPage < 0) catalogPage = 0

  // Title panel
  const titlePanel = engine.addEntity()
  Transform.create(titlePanel, {
    position: Vector3.create(DISPLAY_CENTER.x, DISPLAY_CENTER.y + 2.5, DISPLAY_CENTER.z),
    scale: Vector3.create(0.03, 0.8, 7)
  })
  MeshRenderer.setBox(titlePanel)
  Material.setPbrMaterial(titlePanel, {
    albedoColor: Color4.create(0.03, 0.1, 0.2, 0.4), emissiveColor: Color3.create(0, 0.15, 0.3),
    emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  displayEntities.push(titlePanel)

  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + 2.5, DISPLAY_CENTER.z), rotation: TEXT_ROT })
  TextShape.create(title, {
    text: totalPages > 1 ? `FLORA CATALOG (${catalogPage + 1}/${totalPages})` : 'FLORA CATALOG',
    fontSize: 1.5, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  displayEntities.push(title)

  const countText = engine.addEntity()
  Transform.create(countText, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + 2.15, DISPLAY_CENTER.z), rotation: TEXT_ROT })
  TextShape.create(countText, {
    text: `${catalogData.length} species cataloged`,
    fontSize: 0.6, textColor: Color4.create(0.5, 0.5, 0.5, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  displayEntities.push(countText)

  if (catalogData.length === 0) {
    const emptyText = engine.addEntity()
    Transform.create(emptyText, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z), rotation: TEXT_ROT })
    TextShape.create(emptyText, {
      text: 'No species discovered yet.\nExplore life-bearing planets\nto discover alien flora!',
      fontSize: 0.7, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(emptyText)
    return
  }

  // Catalog entries
  const startIdx = catalogPage * ITEMS_PER_PAGE
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, catalogData.length)
  const cardSpacing = 1.6
  const startZ = DISPLAY_CENTER.z + ((ITEMS_PER_PAGE - 1) * cardSpacing) / 2

  for (let i = startIdx; i < endIdx; i++) {
    const entry = catalogData[i]
    const cardIdx = i - startIdx
    const cardZ = startZ - cardIdx * cardSpacing
    const cardY = DISPLAY_CENTER.y + 0.5

    // Card glass panel
    const card = engine.addEntity()
    Transform.create(card, {
      position: Vector3.create(DISPLAY_CENTER.x, cardY, cardZ),
      scale: Vector3.create(0.03, 2.8, 1.4)
    })
    MeshRenderer.setBox(card)
    Material.setPbrMaterial(card, {
      albedoColor: Color4.create(0.05, 0.15, 0.25, 0.3), emissiveColor: Color3.create(0, 0.2, 0.4),
      emissiveIntensity: 0.5, metallic: 0.9, roughness: 0.1, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    displayEntities.push(card)

    // Specimen image
    if (entry.image_url) {
      const imgBorder = engine.addEntity()
      Transform.create(imgBorder, {
        position: Vector3.create(DISPLAY_CENTER.x + 0.02, cardY + 0.5, cardZ),
        scale: Vector3.create(0.01, 1.1, 1.1)
      })
      MeshRenderer.setBox(imgBorder)
      Material.setPbrMaterial(imgBorder, {
        albedoColor: Color4.create(0.02, 0.02, 0.05, 0.8),
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
      })
      displayEntities.push(imgBorder)

      const img = engine.addEntity()
      Transform.create(img, {
        position: Vector3.create(DISPLAY_CENTER.x + 0.025, cardY + 0.5, cardZ),
        scale: Vector3.create(0.01, 1.0, 1.0)
      })
      MeshRenderer.setBox(img)
      Material.setPbrMaterial(img, {
        texture: Material.Texture.Common({ src: entry.image_url }),
        emissiveTexture: Material.Texture.Common({ src: entry.image_url }),
        emissiveIntensity: 0.5
      })
      displayEntities.push(img)
    }

    // Species name
    const nameEntity = engine.addEntity()
    Transform.create(nameEntity, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, cardY - 0.65, cardZ), rotation: TEXT_ROT })
    TextShape.create(nameEntity, {
      text: entry.name, fontSize: 0.5,
      textColor: RARITY_COLORS[entry.rarity] || Color4.create(0.8, 0.8, 0.8, 1),
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(nameEntity)

    // Rarity
    const rarityEntity = engine.addEntity()
    Transform.create(rarityEntity, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, cardY - 0.9, cardZ), rotation: TEXT_ROT })
    TextShape.create(rarityEntity, {
      text: (entry.rarity || 'unknown').toUpperCase(), fontSize: 0.35,
      textColor: RARITY_COLORS[entry.rarity] || Color4.create(0.5, 0.5, 0.5, 1),
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(rarityEntity)

    // Location
    const locEntity = engine.addEntity()
    Transform.create(locEntity, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, cardY - 1.15, cardZ), rotation: TEXT_ROT })
    TextShape.create(locEntity, {
      text: `${entry.body_name} — ${entry.system_name}`, fontSize: 0.3,
      textColor: Color4.create(0.4, 0.4, 0.4, 1),
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(locEntity)
  }

  // Page nav buttons
  if (totalPages > 1) {
    if (catalogPage > 0) {
      const prevBtn = engine.addEntity()
      Transform.create(prevBtn, { position: Vector3.create(DISPLAY_CENTER.x + 0.02, DISPLAY_CENTER.y - 1.0, DISPLAY_CENTER.z + 2.5), scale: Vector3.create(0.04, 0.25, 0.5) })
      MeshRenderer.setBox(prevBtn); MeshCollider.setBox(prevBtn)
      Material.setPbrMaterial(prevBtn, { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
      displayEntities.push(prevBtn)
      const prevLabel = engine.addEntity()
      Transform.create(prevLabel, { position: Vector3.create(DISPLAY_CENTER.x + 0.05, DISPLAY_CENTER.y - 1.0, DISPLAY_CENTER.z + 2.5), rotation: TEXT_ROT })
      TextShape.create(prevLabel, { text: '< PREV', fontSize: 0.4, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      displayEntities.push(prevLabel)
      pointerEventsSystem.onPointerDown({ entity: prevBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Previous Page', maxDistance: 10 } }, () => { catalogPage--; renderPage() })
    }
    if (catalogPage < totalPages - 1) {
      const nextBtn = engine.addEntity()
      Transform.create(nextBtn, { position: Vector3.create(DISPLAY_CENTER.x + 0.02, DISPLAY_CENTER.y - 1.0, DISPLAY_CENTER.z - 2.5), scale: Vector3.create(0.04, 0.25, 0.5) })
      MeshRenderer.setBox(nextBtn); MeshCollider.setBox(nextBtn)
      Material.setPbrMaterial(nextBtn, { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
      displayEntities.push(nextBtn)
      const nextLabel = engine.addEntity()
      Transform.create(nextLabel, { position: Vector3.create(DISPLAY_CENTER.x + 0.05, DISPLAY_CENTER.y - 1.0, DISPLAY_CENTER.z - 2.5), rotation: TEXT_ROT })
      TextShape.create(nextLabel, { text: 'NEXT >', fontSize: 0.4, textColor: Color4.create(0, 0, 0, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
      displayEntities.push(nextLabel)
      pointerEventsSystem.onPointerDown({ entity: nextBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Next Page', maxDistance: 10 } }, () => { catalogPage++; renderPage() })
    }
  }
}

export function clearCatalogPanel(): void {
  for (const e of displayEntities) engine.removeEntity(e)
  displayEntities.length = 0
  catalogData = []
  catalogPage = 0
}
