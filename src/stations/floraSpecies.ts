// Flora station — Catalog and Vault views: species list on the left, large image in the center,
// details on the right (see references/flora-station-concept.png).
import { TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { selectBody } from '../systemView'
import { ViewDefinition, StationContext, Screens, LOW } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, listRow, image, WHITE, DIM, MUTED, CYAN } from './draw'
import { drawCollectionsTop, setSpeciesCount, ICONS, CollectionId } from './floraCollections'

const RARITY_COLORS: Record<string, Color4> = {
  common: Color4.create(0.6, 0.6, 0.6, 1), uncommon: Color4.create(0.2, 0.8, 0.3, 1), rare: Color4.create(0.2, 0.5, 1, 1),
  epic: Color4.create(0.7, 0.3, 1, 1), legendary: Color4.create(1, 0.7, 0.1, 1), mythic: Color4.create(1, 0.3, 0.5, 1),
}
const PER_PAGE = 5

let onFloraSelect: ((flora: any) => void) | null = null
export function setFloraSelectCallback(cb: (flora: any) => void): void { onFloraSelect = cb }

let catalogData: any[] = []
const details: Record<string, any> = {}
function capitalize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

async function loadCatalog(): Promise<void> {
  const catalog = await api.getCatalog()
  catalogData = catalog.reverse()
  setSpeciesCount(catalogData.length)
}

// Keeps today's behaviour: the rest of the scene (2D detail panel, system view) hears the selection.
function announce(entry: any, detail: any, loading: boolean): void {
  selectBody(null)
  const d: Record<string, string> = {}
  d['Rarity'] = capitalize(entry.rarity || 'unknown')
  if (entry.count) d['Specimens'] = `${entry.count}`
  d['Location'] = entry.body_name || entry.planet_name || 'Unknown'
  d['System'] = entry.system_name || 'Unknown'
  if (loading) d['Traits'] = 'Loading...'
  else if (detail) {
    for (const k of ['atmosphere', 'temperature', 'gravity', 'moisture', 'radiation', 'soil']) if (detail[k]) d[capitalize(k)] = capitalize(detail[k])
    if (detail.discovered_by) d['Discovered By'] = detail.discovered_by
  }
  if (onFloraSelect) onFloraSelect({ type: 'flora', name: entry.name, id: entry.id, imageUrl: entry.image_url, details: d, canDeploy: false })
}

function makeSpeciesView(id: CollectionId, title: string, subtitle: string, icon: string | undefined, emptyText: string, getEntries: (ctx: StationContext) => Promise<any[]>, counter: (entries: any[], ctx: StationContext) => { label: string; pct: number }, showCount: boolean): ViewDefinition {
  const bag: Bag = []
  const paneBag: Bag = []
  let page = 0
  let selectedId: string | null = null
  let entries: any[] = []
  let screens: Screens | null = null
  let ctxRef: StationContext | null = null

  function drawList(): void {
    if (!screens || !ctxRef) return
    clearBag(paneBag)
    const low = screens.low
    const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE))
    if (page >= totalPages) page = totalPages - 1
    if (page < 0) page = 0
    // Left: list
    frame(paneBag, low, -1.85, -0.15, 1.75, 1.75)
    if (entries.length === 0) {
      text(paneBag, low, -1.85, -0.15, emptyText, 0.3, MUTED)
    }
    entries.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE).forEach((e, i) => {
      listRow(paneBag, low, -1.85, 0.5 - i * 0.34, 1.6, 0.3, { label: showCount ? `${e.name} (x${e.count})` : e.name, selected: e.id === selectedId, hover: e.name, onClick: () => select(e), imageSrc: e.image_url })
    })
    if (page > 0) button(paneBag, low, -2.3, -0.9, 0.7, 0.2, '‹ PREV', 'Previous Page', () => { page--; drawList() }, { size: 0.22 })
    if (page < totalPages - 1) button(paneBag, low, -1.4, -0.9, 0.7, 0.2, 'NEXT ›', 'Next Page', () => { page++; drawList() }, { size: 0.22 })
    // Center: image
    frame(paneBag, low, 0, -0.15, 1.6, 1.75)
    const sel = entries.find(e => e.id === selectedId)
    if (sel?.image_url) image(paneBag, low, 0, -0.1, 1.3, 1.3, sel.image_url)
    else text(paneBag, low, 0, -0.15, sel ? 'NO IMAGE' : '', 0.26, MUTED)
    // Right: details
    frame(paneBag, low, 1.85, -0.15, 1.75, 1.75)
    if (sel) {
      text(paneBag, low, 1.1, 0.55, sel.name.toUpperCase(), 0.4, CYAN, TextAlignMode.TAM_MIDDLE_LEFT)
      const det = details[sel.id]
      const rows: [string, string, Color4][] = [['Rarity', capitalize(sel.rarity || 'unknown'), RARITY_COLORS[sel.rarity] || WHITE]]
      if (sel.count) rows.push(['Specimens', `${sel.count}`, WHITE])
      rows.push(['Location', sel.body_name || sel.planet_name || 'Unknown', WHITE])
      rows.push(['System', sel.system_name || 'Unknown', WHITE])
      if (det === undefined) rows.push(['Traits', 'Loading...', DIM])
      else if (det) for (const k of ['atmosphere', 'temperature', 'gravity', 'moisture', 'radiation', 'soil']) if (det[k]) rows.push([capitalize(k), capitalize(det[k]), CYAN])
      rows.slice(0, 7).forEach(([k, v, c], i) => {
        const y = 0.25 - i * 0.18
        text(paneBag, low, 1.1, y, k, 0.24, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
        text(paneBag, low, 2.6, y, v, 0.24, c, TextAlignMode.TAM_MIDDLE_RIGHT)
      })
    } else {
      text(paneBag, low, 1.85, -0.15, entries.length ? 'Select a species' : '', 0.28, MUTED)
    }
  }

  async function select(entry: any): Promise<void> {
    selectedId = entry.id
    drawList()
    announce(entry, details[entry.id], details[entry.id] === undefined)
    if (details[entry.id] === undefined) {
      try { details[entry.id] = await api.getCatalogDetail(entry.id) } catch { details[entry.id] = null }
      if (selectedId === entry.id) { drawList(); announce(entry, details[entry.id], false) }
    }
  }

  return {
    id,
    async render(s: Screens, ctx: StationContext): Promise<void> {
      screens = s; ctxRef = ctx
      drawCollectionsTop(bag, s.top, ctx, id)
      frame(bag, s.low, 0, 0, LOW.halfW * 2, LOW.halfH * 2)
      header(bag, s.low, -2.6, 0.95, { icon, title, subtitle, size: 0.6 })
      entries = await getEntries(ctx)
      const c = counter(entries, ctx)
      text(bag, s.low, 2.5, 1.02, c.label.toUpperCase(), 0.24, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(bag, s.low, 1.9, 0.86, 1.2, c.pct, { h: 0.06 })
      button(bag, s.low, -1.85, -1.08, 1.5, 0.24, '‹ BACK TO COLLECTIONS', 'Back to Collections', () => ctx.setView('summary'), { size: 0.24 })
      text(bag, s.low, 2.6, -1.08, 'EXPLORE  //  STUDY  //  PRESERVE', 0.22, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
      if (!entries.find(e => e.id === selectedId)) selectedId = entries[0]?.id ?? null
      drawList()
    },
    clear(): void { clearBag(bag); clearBag(paneBag); screens = null },
  }
}

export const catalogView = makeSpeciesView('catalog', 'FLORA CATALOG', 'plants & botanical data', ICONS.catalog,
  'No species discovered yet.\nExplore life-bearing planets\nto discover alien flora!',
  async () => { await loadCatalog(); return catalogData },
  (entries) => ({ label: `${entries.length} species discovered`, pct: entries.length > 0 ? 1 : 0 }), false)

export const vaultView = makeSpeciesView('vault', 'SPECIMEN VAULT', 'captured life forms', ICONS.vault,
  'No specimens in vault.\nComplete exploration expeditions\nto collect samples!',
  async (ctx) => {
    if (catalogData.length === 0) await loadCatalog()
    if (!ctx.dashboard) throw new Error('no dashboard')
    const samples: any[] = ctx.dashboard.specimenSamples || []
    const counts: Record<string, number> = {}
    for (const s of samples) counts[s.species_id] = (counts[s.species_id] || 0) + 1
    return Object.entries(counts).map(([speciesId, count]) => {
      const c = catalogData.find(e => e.id === speciesId)
      return { id: speciesId, name: c?.name || 'Unknown Species', rarity: c?.rarity || 'common', image_url: c?.image_url || null, count, body_name: c?.body_name, system_name: c?.system_name }
    })
  },
  (_entries, ctx) => {
    const jars = (ctx.dashboard?.specimenSamples || []).length
    const cap = ctx.dashboard?.ship?.specimen_vault ?? 0
    return { label: `${jars} / ${cap} jars`, pct: cap ? jars / cap : 0 }
  }, true)
