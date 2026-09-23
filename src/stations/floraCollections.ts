// Flora station — shared top screen (category tiles), Summary view and Inventory view
// (see references/flora-station-concept.png).
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import * as api from '../api'
import { ViewDefinition, StationContext, Screens, TOP, LOW } from '../stations'
import { Bag, clearBag, text, frame, header, bar, tile, button, WHITE, DIM, MUTED } from './draw'
import { cargoUsed, titleCase } from './data'

export const ICONS: { catalog: string; vault: string; resources?: string } = {
  catalog: 'assets/icons/catalog-icon.png',
  vault: 'assets/icons/specimen-icon.png',
  resources: 'assets/icons/resources-icon.png',   // placeholder until real art lands
}

let speciesCount = 0
export function setSpeciesCount(n: number): void { speciesCount = n }

export type CollectionId = 'summary' | 'catalog' | 'vault' | 'inventory'

export function drawCollectionsTop(bag: Bag, top: Entity, ctx: StationContext, current: CollectionId): void {
  frame(bag, top, 0, 0, TOP.halfW * 2, TOP.halfH * 2)
  header(bag, top, -2.6, 1.05, { icon: ICONS.catalog, title: 'SHIP COLLECTIONS', subtitle: 'explore // study // preserve' })
  text(bag, top, 2.6, 1.12, '"ALL LIFE EXPANDS THE MAP."', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
  text(bag, top, 2.6, 0.92, '— THE UNFOUND', 0.22, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
  const tiles: [CollectionId, string, string, string | undefined][] = [
    ['catalog', 'Flora Catalog', 'discovered species', ICONS.catalog],
    ['vault', 'Specimen Vault', 'captured life forms', ICONS.vault],
    ['inventory', 'Resource Inventory', 'materials & resources', ICONS.resources],
  ]
  tiles.forEach(([id, title, subtitle, ic], i) => {
    tile(bag, top, -1.85 + i * 1.85, -0.25, 1.6, 1.5, { icon: ic, title, subtitle, selected: id === current, hover: title, onClick: () => ctx.setView(id) })
  })
  text(bag, top, 2.6, -1.25, 'SELECT A CATEGORY', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
}

// ---- Summary view: counters with bars ----
const summaryBag: Bag = []
export const summaryView: ViewDefinition = {
  id: 'summary',
  async render({ top, low }: Screens, ctx: StationContext): Promise<void> {
    drawCollectionsTop(summaryBag, top, ctx, 'summary')
    frame(summaryBag, low, 0, 0, LOW.halfW * 2, LOW.halfH * 2)
    header(summaryBag, low, -2.6, 0.9, { icon: ICONS.catalog, title: 'COLLECTIONS', subtitle: 'select a category above', size: 0.6 })
    const d = ctx.dashboard
    if (!d) throw new Error('no dashboard')
    const catalog = await api.getCatalog()
    setSpeciesCount(catalog.length)
    const jars = (d.specimenSamples || []).length
    const vault = d.ship?.specimen_vault ?? 0
    const used = cargoUsed(d), cap = d.ship?.resource_storage ?? 0
    const rows: [string, string, number][] = [
      ['SPECIES DISCOVERED', `${speciesCount}`, speciesCount > 0 ? 1 : 0],
      ['SPECIMEN JARS', `${jars} / ${vault}`, vault ? jars / vault : 0],
      ['CARGO HOLD', `${used} / ${cap}`, cap ? used / cap : 0],
    ]
    rows.forEach(([k, v, pct], i) => {
      const y = 0.3 - i * 0.5
      text(summaryBag, low, -2.5, y + 0.1, k, 0.3, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
      text(summaryBag, low, 2.5, y + 0.1, v, 0.4, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(summaryBag, low, 0, y - 0.15, 5.0, pct, { h: 0.1 })
    })
  },
  clear(): void { clearBag(summaryBag) },
}

// ---- Inventory view: resources with quantities and bars ----
const invBag: Bag = []
export const inventoryView: ViewDefinition = {
  id: 'inventory',
  async render({ top, low }: Screens, ctx: StationContext): Promise<void> {
    drawCollectionsTop(invBag, top, ctx, 'inventory')
    frame(invBag, low, 0, 0, LOW.halfW * 2, LOW.halfH * 2)
    header(invBag, low, -2.6, 0.9, { icon: ICONS.resources, title: 'RESOURCE INVENTORY', subtitle: 'materials & resources', size: 0.6 })
    const d = ctx.dashboard
    if (!d) throw new Error('no dashboard')
    const used = cargoUsed(d), cap = d.ship?.resource_storage ?? 0
    text(invBag, low, 2.5, 0.98, `${used} / ${cap} UNITS`, 0.26, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
    bar(invBag, low, 1.9, 0.8, 1.2, cap ? used / cap : 0, { h: 0.06 })
    const rows: any[] = (d.inventory || []).filter((r: any) => (r.quantity ?? 0) > 0).sort((a: any, b: any) => (b.quantity ?? 0) - (a.quantity ?? 0))
    if (rows.length === 0) {
      text(invBag, low, 0, -0.1, 'Cargo hold is empty.', 0.42, WHITE)
      text(invBag, low, 0, -0.4, 'MINE ASTEROID BELTS TO GATHER RESOURCES.', 0.26, MUTED)
    }
    rows.slice(0, 12).forEach((r: any, i: number) => {
      const col = i < 6 ? 0 : 1
      const x = col === 0 ? -1.45 : 1.45
      const y = 0.5 - (i % 6) * 0.26
      text(invBag, low, x - 1.3, y + 0.06, titleCase(r.resource_type), 0.3, WHITE, TextAlignMode.TAM_MIDDLE_LEFT)
      text(invBag, low, x + 1.3, y + 0.06, `${r.quantity}`, 0.3, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(invBag, low, x, y - 0.1, 2.6, cap ? r.quantity / cap : 0, { h: 0.06 })
    })
    button(invBag, low, -1.85, -1.08, 1.5, 0.24, '‹ BACK TO COLLECTIONS', 'Back to Collections', () => ctx.setView('summary'), { size: 0.24 })
  },
  clear(): void { clearBag(invBag) },
}
