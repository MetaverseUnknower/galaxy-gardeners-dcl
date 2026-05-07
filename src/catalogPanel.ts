import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode, TextShape, TextAlignMode, InputAction, pointerEventsSystem, ColliderLayer } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { selectBody } from './systemView'

// West edge of platform, facing +X
const DISPLAY_CENTER = Vector3.create(110, 42.0, 128)
const TEXT_ROT = Quaternion.fromEulerDegrees(0, -90, 0)
const PLANE_ROT = Quaternion.fromEulerDegrees(0, -90, 0)
const ICON_ROT = Quaternion.fromEulerDegrees(0, -90, 0)

const displayEntities: Entity[] = []
let catalogData: any[] = []
let catalogDetails: Record<string, any> = {}
let specimenData: any[] = []
let catalogPage = 0
let viewMode: 'catalog' | 'vault' = 'catalog'

const COLS = 6
const ROWS = 2
const ITEMS_PER_PAGE = COLS * ROWS
const TILE_SIZE = 0.9
const TILE_SPACING = 1.0
const GRID_WIDTH = (COLS - 1) * TILE_SPACING
const GRID_HEIGHT = (ROWS - 1) * TILE_SPACING

const RARITY_COLORS: Record<string, Color4> = {
  common: Color4.create(0.6, 0.6, 0.6, 1),
  uncommon: Color4.create(0.2, 0.8, 0.3, 1),
  rare: Color4.create(0.2, 0.5, 1, 1),
  epic: Color4.create(0.7, 0.3, 1, 1),
  legendary: Color4.create(1, 0.7, 0.1, 1),
  mythic: Color4.create(1, 0.3, 0.5, 1),
}

let onFloraSelect: ((flora: any) => void) | null = null
export function setFloraSelectCallback(cb: (flora: any) => void): void { onFloraSelect = cb }

function capitalize(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

export async function createCatalogPanel(): Promise<void> {
  clearCatalogPanel()

  try {
    const [catalog, shipDash] = await Promise.all([
      api.getCatalog(),
      api.getShipDashboard()
    ])
    catalogData = catalog.reverse()
    specimenData = shipDash?.specimenSamples || []
  } catch { return }

  renderPage()
}

function renderPage(): void {
  for (const e of displayEntities) engine.removeEntity(e)
  displayEntities.length = 0

  const panelWidth = GRID_WIDTH + 1.5
  const panelHeight = GRID_HEIGHT + 2.5

  // Main glass panel
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

  // Title bar with view toggle buttons
  const titleY = DISPLAY_CENTER.y + panelHeight / 2 + 0.1

  // Catalog button
  const catalogBtn = engine.addEntity()
  Transform.create(catalogBtn, {
    position: Vector3.create(DISPLAY_CENTER.x + 0.02, titleY, DISPLAY_CENTER.z + 1.2),
    scale: Vector3.create(0.04, 0.6, 0.6)
  })
  MeshRenderer.setBox(catalogBtn); MeshCollider.setBox(catalogBtn)
  Material.setPbrMaterial(catalogBtn, {
    albedoColor: Color4.create(0, 0.3, 0.4, 1),
    emissiveColor: Color3.create(0, 0.6, 0.8),
    emissiveIntensity: 1.5
  })
  displayEntities.push(catalogBtn)
  pointerEventsSystem.onPointerDown(
    { entity: catalogBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Flora Catalog', maxDistance: 10 } },
    () => { viewMode = 'catalog'; catalogPage = 0; renderPage() }
  )

  // Catalog icon
  const catalogIcon = engine.addEntity()
  Transform.create(catalogIcon, {
    position: Vector3.create(DISPLAY_CENTER.x + 0.05, titleY, DISPLAY_CENTER.z + 1.2),
    scale: Vector3.create(0.45, 0.45, 1), rotation: ICON_ROT
  })
  MeshRenderer.setPlane(catalogIcon)
  Material.setPbrMaterial(catalogIcon, {
    texture: Material.Texture.Common({ src: 'assets/icons/catalog-icon.png' }),
    emissiveTexture: Material.Texture.Common({ src: 'assets/icons/catalog-icon.png' }),
    albedoColor: Color4.create(0, 0.08, 0.25, 0.9), emissiveColor: Color3.create(0, 0.08, 0.25),
    emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  displayEntities.push(catalogIcon)

  // Vault button
  const vaultBtn = engine.addEntity()
  Transform.create(vaultBtn, {
    position: Vector3.create(DISPLAY_CENTER.x + 0.02, titleY, DISPLAY_CENTER.z - 1.2),
    scale: Vector3.create(0.04, 0.6, 0.6)
  })
  MeshRenderer.setBox(vaultBtn); MeshCollider.setBox(vaultBtn)
  Material.setPbrMaterial(vaultBtn, {
    albedoColor: Color4.create(0, 0.3, 0.4, 1),
    emissiveColor: Color3.create(0, 0.6, 0.8),
    emissiveIntensity: 1.5
  })
  displayEntities.push(vaultBtn)
  pointerEventsSystem.onPointerDown(
    { entity: vaultBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Specimen Vault', maxDistance: 10 } },
    () => { viewMode = 'vault'; catalogPage = 0; renderPage() }
  )

  // Vault icon
  const vaultIcon = engine.addEntity()
  Transform.create(vaultIcon, {
    position: Vector3.create(DISPLAY_CENTER.x + 0.05, titleY, DISPLAY_CENTER.z - 1.2),
    scale: Vector3.create(0.45, 0.45, 1), rotation: ICON_ROT
  })
  MeshRenderer.setPlane(vaultIcon)
  Material.setPbrMaterial(vaultIcon, {
    texture: Material.Texture.Common({ src: 'assets/icons/specimen-icon.png' }),
    emissiveTexture: Material.Texture.Common({ src: 'assets/icons/specimen-icon.png' }),
    albedoColor: Color4.create(0, 0.08, 0.25, 0.9), emissiveColor: Color3.create(0, 0.08, 0.25),
    emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
  displayEntities.push(vaultIcon)

  // Title text between buttons
  const title = engine.addEntity()
  Transform.create(title, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, titleY, DISPLAY_CENTER.z), rotation: TEXT_ROT })
  TextShape.create(title, {
    text: viewMode === 'catalog' ? 'FLORA CATALOG' : 'SPECIMEN VAULT',
    fontSize: 1.2, textColor: Color4.create(0, 1, 1, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  displayEntities.push(title)

  if (viewMode === 'catalog') {
    renderCatalogGrid(panelWidth, panelHeight)
  } else {
    renderVaultGrid(panelWidth, panelHeight)
  }
}

function renderCatalogGrid(panelWidth: number, panelHeight: number): void {
  const totalPages = Math.max(1, Math.ceil(catalogData.length / ITEMS_PER_PAGE))
  if (catalogPage >= totalPages) catalogPage = totalPages - 1
  if (catalogPage < 0) catalogPage = 0

  // Count
  const countText = engine.addEntity()
  Transform.create(countText, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + panelHeight / 2 - 0.25, DISPLAY_CENTER.z), rotation: TEXT_ROT })
  TextShape.create(countText, {
    text: `${catalogData.length} species cataloged${totalPages > 1 ? ` — Page ${catalogPage + 1}/${totalPages}` : ''}`,
    fontSize: 0.5, textColor: Color4.create(0.5, 0.5, 0.5, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  displayEntities.push(countText)

  if (catalogData.length === 0) {
    const emptyText = engine.addEntity()
    Transform.create(emptyText, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z), rotation: TEXT_ROT })
    TextShape.create(emptyText, {
      text: 'No species discovered yet.\nExplore life-bearing planets\nto discover alien flora!',
      fontSize: 0.6, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(emptyText)
    return
  }

  const startIdx = catalogPage * ITEMS_PER_PAGE
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, catalogData.length)
  renderTileGrid(catalogData.slice(startIdx, endIdx), panelWidth, panelHeight, async (entry) => {
    handleFloraSelect(entry, catalogDetails[entry.id], !catalogDetails[entry.id])
    if (!catalogDetails[entry.id]) {
      try { catalogDetails[entry.id] = await api.getCatalogDetail(entry.id) } catch {}
      handleFloraSelect(entry, catalogDetails[entry.id], false)
    }
  })
  renderPageNav(totalPages, panelWidth, panelHeight)
}

function renderVaultGrid(panelWidth: number, panelHeight: number): void {
  // Group specimens by species_id, count them, cross-reference with catalog for names/images
  const speciesCounts: Record<string, number> = {}
  for (const s of specimenData) {
    speciesCounts[s.species_id] = (speciesCounts[s.species_id] || 0) + 1
  }

  // Build vault entries with catalog info
  const vaultEntries: any[] = []
  for (const [speciesId, count] of Object.entries(speciesCounts)) {
    const catalogEntry = catalogData.find(c => c.id === speciesId)
    vaultEntries.push({
      id: speciesId,
      name: catalogEntry?.name || 'Unknown Species',
      rarity: catalogEntry?.rarity || 'common',
      image_url: catalogEntry?.image_url || null,
      count,
    })
  }

  const totalPages = Math.max(1, Math.ceil(vaultEntries.length / ITEMS_PER_PAGE))
  if (catalogPage >= totalPages) catalogPage = totalPages - 1
  if (catalogPage < 0) catalogPage = 0

  const countText = engine.addEntity()
  Transform.create(countText, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + panelHeight / 2 - 0.25, DISPLAY_CENTER.z), rotation: TEXT_ROT })
  TextShape.create(countText, {
    text: `${specimenData.length} specimens stored${totalPages > 1 ? ` — Page ${catalogPage + 1}/${totalPages}` : ''}`,
    fontSize: 0.5, textColor: Color4.create(0.5, 0.5, 0.5, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  displayEntities.push(countText)

  if (vaultEntries.length === 0) {
    const emptyText = engine.addEntity()
    Transform.create(emptyText, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, DISPLAY_CENTER.y + 0.5, DISPLAY_CENTER.z), rotation: TEXT_ROT })
    TextShape.create(emptyText, {
      text: 'No specimens in vault.\nComplete exploration expeditions\nto collect samples!',
      fontSize: 0.6, textColor: Color4.create(0.4, 0.4, 0.4, 1), textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(emptyText)
    return
  }

  const startIdx = catalogPage * ITEMS_PER_PAGE
  const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, vaultEntries.length)
  renderTileGrid(vaultEntries.slice(startIdx, endIdx), panelWidth, panelHeight, async (entry) => {
    handleFloraSelect(entry, catalogDetails[entry.id], !catalogDetails[entry.id])
    if (!catalogDetails[entry.id]) {
      try { catalogDetails[entry.id] = await api.getCatalogDetail(entry.id) } catch {}
      handleFloraSelect(entry, catalogDetails[entry.id], false)
    }
  }, true)
  renderPageNav(totalPages, panelWidth, panelHeight)
}

function renderTileGrid(entries: any[], panelWidth: number, panelHeight: number, onClick: (entry: any) => void, showCount: boolean = false): void {
  const gridTopY = DISPLAY_CENTER.y + panelHeight / 2 - 1.2
  const gridRightZ = DISPLAY_CENTER.z - GRID_WIDTH / 2

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const tileZ = gridRightZ + col * TILE_SPACING
    const tileY = gridTopY - row * TILE_SPACING

    // Thumbnail background
    const tileBg = engine.addEntity()
    Transform.create(tileBg, {
      position: Vector3.create(DISPLAY_CENTER.x + 0.02, tileY + 0.1, tileZ),
      scale: Vector3.create(TILE_SIZE, TILE_SIZE, 1), rotation: PLANE_ROT
    })
    MeshRenderer.setPlane(tileBg)
    Material.setPbrMaterial(tileBg, {
      albedoColor: Color4.create(0.02, 0.02, 0.05, 0.8),
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    displayEntities.push(tileBg)

    // Thumbnail image
    if (entry.image_url) {
      const img = engine.addEntity()
      Transform.create(img, {
        position: Vector3.create(DISPLAY_CENTER.x + 0.025, tileY + 0.1, tileZ),
        scale: Vector3.create(TILE_SIZE - 0.05, TILE_SIZE - 0.05, 1), rotation: PLANE_ROT
      })
      MeshRenderer.setPlane(img)
      MeshCollider.setPlane(img, ColliderLayer.CL_POINTER)
      Material.setBasicMaterial(img, {
        texture: Material.Texture.Common({ src: entry.image_url })
      })
      displayEntities.push(img)

      const capturedEntry = entry
      pointerEventsSystem.onPointerDown(
        { entity: img, opts: { button: InputAction.IA_POINTER, hoverText: entry.name, maxDistance: 12 } },
        () => onClick(capturedEntry)
      )
    }

    // Name below
    const nameEntity = engine.addEntity()
    Transform.create(nameEntity, { position: Vector3.create(DISPLAY_CENTER.x + 0.03, tileY - 0.4, tileZ), rotation: TEXT_ROT })
    TextShape.create(nameEntity, {
      text: showCount ? `${entry.name} (x${entry.count})` : entry.name,
      fontSize: 0.6,
      textColor: RARITY_COLORS[entry.rarity] || Color4.create(0.8, 0.8, 0.8, 1),
      textAlign: TextAlignMode.TAM_MIDDLE_CENTER
    })
    displayEntities.push(nameEntity)
  }
}

function renderPageNav(totalPages: number, panelWidth: number, panelHeight: number): void {
  if (totalPages <= 1) return

  const navY = DISPLAY_CENTER.y - panelHeight / 2 + 0.3
  const btnSpacing = 0.4

  if (catalogPage > 0) {
    const prevBtn = engine.addEntity()
    Transform.create(prevBtn, { position: Vector3.create(DISPLAY_CENTER.x + 0.02, navY, DISPLAY_CENTER.z - btnSpacing), scale: Vector3.create(0.04, 0.35, 0.35) })
    MeshRenderer.setBox(prevBtn); MeshCollider.setBox(prevBtn)
    Material.setPbrMaterial(prevBtn, { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
    displayEntities.push(prevBtn)

    const prevIcon = engine.addEntity()
    Transform.create(prevIcon, {
      position: Vector3.create(DISPLAY_CENTER.x + 0.05, navY, DISPLAY_CENTER.z - btnSpacing),
      scale: Vector3.create(0.25, 0.25, 1), rotation: Quaternion.fromEulerDegrees(0, -90, 180)
    })
    MeshRenderer.setPlane(prevIcon)
    Material.setPbrMaterial(prevIcon, {
      texture: Material.Texture.Common({ src: 'assets/icons/arrow-icon.png' }),
      emissiveTexture: Material.Texture.Common({ src: 'assets/icons/arrow-icon.png' }),
      albedoColor: Color4.create(0, 0.08, 0.25, 0.9), emissiveColor: Color3.create(0, 0.08, 0.25),
      emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    displayEntities.push(prevIcon)

    pointerEventsSystem.onPointerDown({ entity: prevBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Previous Page', maxDistance: 10 } }, () => { catalogPage--; renderPage() })
  }

  if (catalogPage < totalPages - 1) {
    const nextBtn = engine.addEntity()
    Transform.create(nextBtn, { position: Vector3.create(DISPLAY_CENTER.x + 0.02, navY, DISPLAY_CENTER.z + btnSpacing), scale: Vector3.create(0.04, 0.35, 0.35) })
    MeshRenderer.setBox(nextBtn); MeshCollider.setBox(nextBtn)
    Material.setPbrMaterial(nextBtn, { albedoColor: Color4.create(0.05, 0.1, 0.15, 1), emissiveColor: Color3.create(0, 0.6, 0.8), emissiveIntensity: 1.5 })
    displayEntities.push(nextBtn)

    const nextIcon = engine.addEntity()
    Transform.create(nextIcon, {
      position: Vector3.create(DISPLAY_CENTER.x + 0.05, navY, DISPLAY_CENTER.z + btnSpacing),
      scale: Vector3.create(0.25, 0.25, 1), rotation: Quaternion.fromEulerDegrees(0, -90, 0)
    })
    MeshRenderer.setPlane(nextIcon)
    Material.setPbrMaterial(nextIcon, {
      texture: Material.Texture.Common({ src: 'assets/icons/arrow-icon.png' }),
      emissiveTexture: Material.Texture.Common({ src: 'assets/icons/arrow-icon.png' }),
      albedoColor: Color4.create(0, 0.08, 0.25, 0.9), emissiveColor: Color3.create(0, 0.08, 0.25),
      emissiveIntensity: 2, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
    })
    displayEntities.push(nextIcon)

    pointerEventsSystem.onPointerDown({ entity: nextBtn, opts: { button: InputAction.IA_POINTER, hoverText: 'Next Page', maxDistance: 10 } }, () => { catalogPage++; renderPage() })
  }
}

function handleFloraSelect(entry: any, detail: any, loading: boolean = false): void {
  selectBody(null)

  const details: Record<string, string> = {}
  details['Rarity'] = capitalize(entry.rarity || 'unknown')
  if (entry.count) details['Specimens'] = `${entry.count}`
  details['Location'] = entry.body_name || entry.planet_name || 'Unknown'
  details['System'] = entry.system_name || 'Unknown'

  if (loading) {
    details['Traits'] = 'Loading...'
  } else if (detail) {
    if (detail.atmosphere) details['Atmosphere'] = capitalize(detail.atmosphere)
    if (detail.temperature) details['Temperature'] = capitalize(detail.temperature)
    if (detail.gravity) details['Gravity'] = capitalize(detail.gravity)
    if (detail.moisture) details['Moisture'] = capitalize(detail.moisture)
    if (detail.radiation) details['Radiation'] = capitalize(detail.radiation)
    if (detail.soil) details['Soil'] = capitalize(detail.soil)
    if (detail.discovered_by) details['Discovered By'] = detail.discovered_by
  }

  if (onFloraSelect) {
    onFloraSelect({
      type: 'flora',
      name: entry.name,
      id: entry.id,
      imageUrl: entry.image_url,
      details,
      canDeploy: false
    })
  }
}

export async function refreshCatalog(): Promise<void> {
  try {
    const [catalog, shipDash] = await Promise.all([
      api.getCatalog(),
      api.getShipDashboard()
    ])
    catalogData = catalog.reverse()
    specimenData = shipDash?.specimenSamples || []
    renderPage()
  } catch {}
}

export function clearCatalogPanel(): void {
  for (const e of displayEntities) engine.removeEntity(e)
  displayEntities.length = 0
  catalogData = []
  catalogDetails = {}
  specimenData = []
  catalogPage = 0
  viewMode = 'catalog'
}
