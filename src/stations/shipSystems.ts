// Ship station — Systems view (see references/ship-upgrades-concept.png).
// Top: upgrade cards in two columns around the ship hologram; click selects (magenta).
// Low: selected module, required resources with have/need and the UPGRADE button, system status bars.
import { TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { ViewDefinition, StationContext, Screens, TOP } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, image, clickable, icon, CYAN, MAGENTA3, MAGENTA, WHITE, DIM, MUTED, GREEN, RED, GREEN3, RED3 } from './draw'
// Tall (3:4) blueprint whose connector lines run to the image edges, meeting the upgrade cards' inner edges.
const SHIP_BLUEPRINT_SYSTEMS = 'assets/images/ship-blueprint-systems.png'
import { cargoUsed, titleCase } from './data'

const CATEGORY_LABELS: Record<string, string> = {
  fuel_tank: 'Fuel Tank', fuel_efficiency: 'Fuel Efficiency', cargo_hold: 'Cargo Hold', specimen_vault: 'Specimen Vault',
  mining_bay: 'Mining Bay', exploration_bay: 'Exploration Bay', expedition_speed: 'Expedition Speed',
  hull_reinforcement: 'Blast Shielding', pod_shielding: 'Env. Shielding', discovery_array: 'Discovery Array',
}
const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  fuel_tank: 'Increases maximum fuel capacity.',
  fuel_efficiency: 'Reduces fuel burned per light-year.',
  cargo_hold: 'Expands resource storage.',
  specimen_vault: 'Adds specimen jar slots.',
  mining_bay: 'Adds a mining pod bay.',
  exploration_bay: 'Adds an exploration pod bay.',
  expedition_speed: 'Pods complete missions faster.',
  hull_reinforcement: 'Protects pods from blast damage.',
  pod_shielding: 'Protects pods from harsh environments.',
  discovery_array: 'Improves discovery range and odds.',
}
function labelFor(c: string): string { return CATEGORY_LABELS[c] || titleCase(c) }

const topBag: Bag = []
const holoBag: Bag = []
const lowBag: Bag = []
let upgrades: any[] = []
let selected: string | null = null
let installing = false
let screens: Screens | null = null
let ctxRef: StationContext | null = null

const CARD_W = 1.75, CARD_H = 0.34

function drawTop(): void {
  if (!screens || !ctxRef) return
  clearBag(topBag)
  const top = screens.top
  header(topBag, top, -2.6, 1.05, { icon: 'assets/icons/systems-icon.png', title: 'SHIP SYSTEMS', subtitle: 'upgrade and maintain your vessel' })
  text(topBag, top, 2.6, 1.05, 'EXPLORATION  //  RESEARCH  //  DISCOVERY', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
  // Fills the gap between the card columns (inner edges at x ±0.975) at the image's own 3:4 ratio.
  if (holoBag.length === 0) image(holoBag, top, 0, -0.2, 1.95, 2.6, SHIP_BLUEPRINT_SYSTEMS, { z: -0.02 })
  text(topBag, top, 0, -1.45, '— A DEEPER UNIVERSE AWAITS —', 0.24, MUTED)
  if (upgrades.length === 0) { text(topBag, top, 0, -0.9, 'All upgrades maxed!', 0.45, DIM); return }
  upgrades.forEach((u, i) => {
    const col = i < 5 ? 0 : 1
    const row = i < 5 ? i : i - 5
    const x = col === 0 ? -1.85 : 1.85
    const y = 0.6 - row * 0.4
    const isSel = u.category === selected
    const f = frame(topBag, top, x, y, CARD_W, CARD_H, { border: isSel ? MAGENTA3 : undefined, borderWidth: isSel ? 0.03 : 0.02, fill: isSel ? Color4.create(0.15, 0.02, 0.12, 0.8) : undefined })
    text(topBag, top, x - CARD_W / 2 + 0.1, y + 0.06, `${labelFor(u.category)} T${u.tier}`, 0.3, isSel ? MAGENTA : WHITE, TextAlignMode.TAM_MIDDLE_LEFT)
    const costs = Object.entries(u.resourceCosts as Record<string, number>).map(([k, v]) => `${v} ${titleCase(k)}`).join(', ')
    text(topBag, top, x - CARD_W / 2 + 0.1, y - 0.09, costs, 0.22, u.canAfford ? DIM : Color4.create(0.8, 0.4, 0.4, 1), TextAlignMode.TAM_MIDDLE_LEFT)
    text(topBag, top, x + CARD_W / 2 - 0.1, y, '›', 0.5, isSel ? MAGENTA : CYAN, TextAlignMode.TAM_MIDDLE_RIGHT)
    clickable(f, `Select ${labelFor(u.category)}`, () => { selected = u.category; drawTop(); drawLow() })
  })
}

function drawLow(): void {
  if (!screens || !ctxRef) return
  clearBag(lowBag)
  const low = screens.low
  const ctx = ctxRef
  const u = upgrades.find(x => x.category === selected)

  // Selected module, left
  frame(lowBag, low, -1.85, 0.1, 1.75, 2.0)
  text(lowBag, low, -2.6, 1.0, 'SELECTED MODULE', 0.28, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  if (!u) {
    text(lowBag, low, -1.85, 0.1, upgrades.length ? 'Select a module above' : 'Nothing to upgrade', 0.38, MUTED)
  } else {
    text(lowBag, low, -2.6, 0.7, `${labelFor(u.category)} T${u.tier}`, 0.5, MAGENTA, TextAlignMode.TAM_MIDDLE_LEFT)
    text(lowBag, low, -2.6, 0.42, CATEGORY_DESCRIPTIONS[u.category] || '', 0.26, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
    const rows: [string, string][] = [['CURRENT LEVEL', u.tier > 1 ? `T${u.tier - 1}` : 'None'], ['NEXT LEVEL', `T${u.tier}`]]
    for (const [k, v] of Object.entries((u.statModifier || {}) as Record<string, any>)) rows.push([titleCase(k).toUpperCase() + ' (NEXT)', `${v}`])
    rows.slice(0, 5).forEach(([k, v], i) => {
      const y = 0.1 - i * 0.22
      text(lowBag, low, -2.6, y, k, 0.24, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
      text(lowBag, low, -1.1, y, v, 0.26, i >= 2 ? GREEN : WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
    })
  }

  // Required resources + UPGRADE, middle
  frame(lowBag, low, 0, 0.1, 1.75, 2.0)
  text(lowBag, low, -0.75, 1.0, 'REQUIRED RESOURCES', 0.28, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  if (u) {
    const inv: any[] = ctx.dashboard?.inventory || []
    const have = (r: string) => inv.find(x => x.resource_type === r)?.quantity ?? 0
    Object.entries(u.resourceCosts as Record<string, number>).slice(0, 4).forEach(([r, need], i) => {
      const y = 0.65 - i * 0.3
      const ok = have(r) >= need
      frame(lowBag, low, 0, y, 1.55, 0.26, { border: ok ? undefined : RED3, fill: Color4.create(0.02, 0.05, 0.12, 0.8) })
      text(lowBag, low, -0.7, y, titleCase(r), 0.28, WHITE, TextAlignMode.TAM_MIDDLE_LEFT)
      text(lowBag, low, 0.5, y, `${have(r)} / ${need}`, 0.28, ok ? GREEN : RED, TextAlignMode.TAM_MIDDLE_RIGHT)
      icon(lowBag, low, 0.62, y, 0.2, ok ? 'assets/icons/check-icon.png' : 'assets/icons/cross-icon.png', { color: ok ? GREEN3 : RED3 })
    })
    if (installing) button(lowBag, low, 0, -0.6, 1.55, 0.42, 'UPGRADING…', 'Upgrading', () => {}, { variant: 'disabled', size: 0.4 })
    else if (u.canAfford) button(lowBag, low, 0, -0.6, 1.55, 0.42, 'UPGRADE', `Upgrade ${labelFor(u.category)}`, () => install(u.category), { variant: 'primary', size: 0.44 })
    else button(lowBag, low, 0, -0.6, 1.55, 0.42, 'NEED RESOURCES', 'Insufficient resources', () => {}, { variant: 'disabled', size: 0.34 })
  }

  // System status, right
  frame(lowBag, low, 1.85, 0.1, 1.75, 2.0)
  text(lowBag, low, 1.1, 1.0, 'SYSTEM STATUS', 0.28, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  const ship = ctx.dashboard?.ship
  if (ship) {
    const used = cargoUsed(ctx.dashboard)
    const jars = (ctx.dashboard?.specimenSamples || []).length
    const rows: [string, number, string][] = [
      ['FUEL', ship.fuel_capacity ? ship.fuel_current / ship.fuel_capacity : 0, `${Math.round(ship.fuel_capacity ? ship.fuel_current / ship.fuel_capacity * 100 : 0)}%`],
      ['CARGO', ship.resource_storage ? used / ship.resource_storage : 0, `${Math.round(ship.resource_storage ? used / ship.resource_storage * 100 : 0)}%`],
      ['VAULT', ship.specimen_vault ? jars / ship.specimen_vault : 0, `${jars} / ${ship.specimen_vault}`],
      ['BLAST SHIELDING', ship.hull_reinforcement || 0, `${Math.round((ship.hull_reinforcement || 0) * 100)}%`],
      ['ENV. SHIELDING', ship.pod_shielding || 0, `${Math.round((ship.pod_shielding || 0) * 100)}%`],
    ]
    rows.forEach(([k, pct, v], i) => {
      const y = 0.65 - i * 0.3
      text(lowBag, low, 1.1, y + 0.08, k, 0.22, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
      text(lowBag, low, 2.6, y + 0.08, v, 0.24, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
      bar(lowBag, low, 1.85, y - 0.08, 1.5, pct, { h: 0.07 })
    })
  } else {
    text(lowBag, low, 1.85, 0.1, 'Ship data unavailable', 0.34, MUTED)
  }
  button(lowBag, low, -2.05, -1.05, 1.4, 0.24, '‹ BACK TO OVERVIEW', 'Back to Overview', () => ctx.setView('overview'), { size: 0.24 })
}

async function install(category: string): Promise<void> {
  const ctx = ctxRef
  if (!ctx || installing) return
  installing = true
  drawLow()
  try {
    await ctx.busy(api.applyUpgrade(category))
    ctx.notify(`${labelFor(category)} upgraded!`, Color4.create(0, 1, 0.5, 1))
  } catch (err: any) {
    ctx.notify(err.message || 'Upgrade failed', Color4.create(1, 0.3, 0.3, 1))
  }
  installing = false
  await ctx.refresh()   // re-fetches dashboard and re-runs render(), which reloads upgrades
}

export const shipSystemsView: ViewDefinition = {
  id: 'systems',
  async render(s: Screens, ctx: StationContext): Promise<void> {
    screens = s; ctxRef = ctx
    upgrades = await api.getAvailableUpgrades()
    if (!upgrades.find(u => u.category === selected)) selected = upgrades[0]?.category ?? null
    drawTop()
    drawLow()
  },
  clear(): void { clearBag(topBag); clearBag(holoBag); clearBag(lowBag); screens = null },
}
