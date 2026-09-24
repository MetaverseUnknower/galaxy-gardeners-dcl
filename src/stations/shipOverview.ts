// Ship station — Overview view (see references/ship-overview-concept.png).
// Top: fuel frame with refine/buy buttons, resources readout, ship hologram, Upgrades entry.
// Low: ship stats with bars, active missions with collect.
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { openRefineryDialog, openPurchaseDialog } from '../ui'
import { ViewDefinition, StationContext, Screens, TOP, refreshStation } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, image, WHITE, DIM, MUTED, GREEN } from './draw'
import { cargoUsed } from './data'

// Blueprint line-art of the ship, drawn flat on the glass (see assets/icons/manifest.json for the art spec).
export const SHIP_BLUEPRINT = 'assets/images/ship-blueprint.png'

let solarRechargeRate = 0
export function setSolarRechargeRate(rate: number): void { solarRechargeRate = rate }

// Cosmetic bar scaling for the stats panel (the concept shows bars; the API has no maxima).
const STAT_SCALE: Record<string, number> = { fuel_efficiency: 3, resource_storage: 500, specimen_vault: 50, expedition_speed: 3, hull_reinforcement: 1, pod_shielding: 1 }
const MISSIONS_PER_PAGE = 4   // leaves room for the Pod Operations button under the list

const topBag: Bag = []
const lowBag: Bag = []
const missionBag: Bag = []
let expeditions: any[] = []
let actionStatus: Record<string, string> = {}
let page = 0
let screens: Screens | null = null
let ctxRef: StationContext | null = null

function icons(name: string): string | undefined { return ICONS[name] }
// Glyph files (white on transparent, tinted in-scene). The first five are placeholders until real art lands.
const ICONS: Record<string, string | undefined> = {
  fuel: 'assets/icons/fuel-icon.png', upgrades: 'assets/icons/upgrades-icon.png', stats: 'assets/icons/stats-icon.png',
  missions: 'assets/icons/missions-icon.png', resources: 'assets/icons/resources-icon.png',
  refine: 'assets/icons/refinery-icon.png', buy: 'assets/icons/fuel-purchase-icon.png',
}

function drawTop(top: Entity, ctx: StationContext): void {
  clearBag(topBag)
  const d = ctx.dashboard
  const ship = d?.ship
  header(topBag, top, -2.6, 1.05, { title: 'SHIP OVERVIEW', subtitle: 'keep exploring' })
  // Resources readout, top right
  const used = cargoUsed(d), cap = ship?.resource_storage ?? 0
  text(topBag, top, 2.55, 1.15, 'RESOURCES', 0.3, DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
  text(topBag, top, 2.55, 0.92, `${used} / ${cap}`, 0.5, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
  bar(topBag, top, 1.95, 0.72, 1.2, cap > 0 ? used / cap : 0, { h: 0.08 })

  // Fuel frame, left
  frame(topBag, top, -1.4, -0.35, 2.6, 1.85)
  header(topBag, top, -2.6, 0.3, { icon: icons('fuel'), title: 'FUEL', size: 0.7 })
  if (ship) {
    const pct = ship.fuel_capacity > 0 ? ship.fuel_current / ship.fuel_capacity : 0
    bar(topBag, top, -1.85, -0.15, 1.5, pct, { h: 0.2 })   // ends at -1.1; the reading sits right of it
    text(topBag, top, -0.15, -0.15, `${ship.fuel_current.toFixed(0)} / ${ship.fuel_capacity.toFixed(0)}`, 0.42, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
    if (solarRechargeRate > 0) text(topBag, top, -2.55, -0.45, `Solar Recharge: +${solarRechargeRate.toFixed(1)} fuel/hr`, 0.32, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
  } else {
    text(topBag, top, -1.4, -0.15, 'Fuel data unavailable', 0.4, MUTED)
  }
  button(topBag, top, -2.0, -0.95, 1.15, 0.36, 'REFINE', 'Refine Fuel', () => openRefineryDialog(), { icon: icons('refine'), size: 0.34 })
  button(topBag, top, -0.75, -0.95, 1.15, 0.36, 'BUY FUEL', 'Purchase Fuel Cells', () => openPurchaseDialog(), { icon: icons('buy'), size: 0.34 })
  text(topBag, top, -2.55, -1.2, '"FURTHER SHORES AWAIT."  — THE UNFOUND', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_LEFT)

  // Ship frame, right: hologram + Upgrades entry
  frame(topBag, top, 1.4, -0.35, 2.6, 1.85)
  image(topBag, top, 0.9, -0.35, 1.3, 1.3, SHIP_BLUEPRINT)
  button(topBag, top, 2.05, -0.35, 1.1, 0.42, 'UPGRADES »', 'Ship Systems', () => ctx.setView('systems'), { icon: icons('upgrades'), size: 0.34 })
  text(topBag, top, 2.6, -1.25, 'EXPLORE  //  UPGRADE  //  GO FURTHER', 0.24, MUTED, TextAlignMode.TAM_MIDDLE_RIGHT)
}

function drawStats(low: Entity, ctx: StationContext): void {
  const ship = ctx.dashboard?.ship
  frame(lowBag, low, -1.4, 0, 2.6, 2.3)
  header(lowBag, low, -2.6, 0.9, { icon: icons('stats'), title: 'SHIP STATS', size: 0.6 })
  if (!ship) { text(lowBag, low, -1.4, 0, 'Ship data unavailable', 0.4, MUTED); return }
  const rows: [string, string, number][] = [
    ['Fuel Efficiency', `${ship.fuel_efficiency.toFixed(1)}x`, ship.fuel_efficiency / STAT_SCALE.fuel_efficiency],
    ['Cargo Capacity', `${ship.resource_storage}`, ship.resource_storage / STAT_SCALE.resource_storage],
    ['Vault Capacity', `${ship.specimen_vault}`, ship.specimen_vault / STAT_SCALE.specimen_vault],
    ['Expedition Speed', `${ship.expedition_speed.toFixed(1)}x`, ship.expedition_speed / STAT_SCALE.expedition_speed],
    ['Blast Shielding', `${((ship.hull_reinforcement || 0) * 100).toFixed(0)}%`, (ship.hull_reinforcement || 0) / STAT_SCALE.hull_reinforcement],
    ['Env. Shielding', `${((ship.pod_shielding || 0) * 100).toFixed(0)}%`, (ship.pod_shielding || 0) / STAT_SCALE.pod_shielding],
  ]
  rows.forEach(([label, value, pct], i) => {
    const y = 0.5 - i * 0.28
    text(lowBag, low, -2.55, y, label, 0.34, DIM, TextAlignMode.TAM_MIDDLE_LEFT)
    text(lowBag, low, -1.2, y, value, 0.3, WHITE, TextAlignMode.TAM_MIDDLE_RIGHT)
    bar(lowBag, low, -0.62, y, 0.85, pct, { h: 0.1 })   // ends at -0.195, inside the frame edge at -0.1
  })
}

function drawMissions(): void {
  if (!screens || !ctxRef) return
  clearBag(missionBag)
  const low = screens.low
  frame(missionBag, low, 1.4, 0, 2.6, 2.3)
  const totalPages = Math.max(1, Math.ceil(expeditions.length / MISSIONS_PER_PAGE))
  if (page >= totalPages) page = totalPages - 1
  if (page < 0) page = 0
  header(missionBag, low, 0.2, 0.9, { icon: icons('missions'), title: totalPages > 1 ? `ACTIVE MISSIONS ${page + 1}/${totalPages}` : 'ACTIVE MISSIONS', size: 0.6 })
  // Entry to the Pod Operations view, under the list (as in the concept).
  button(missionBag, low, 1.4, -0.92, 2.2, 0.3, 'POD OPERATIONS »', 'Pod Operations', () => ctxRef?.setView('pods'), { icon: icons('missions'), size: 0.34 })
  if (expeditions.length === 0) {
    text(missionBag, low, 1.4, 0.05, 'No active missions', 0.42, WHITE)
    text(missionBag, low, 1.4, -0.25, 'CHART A COURSE. MAKE IT COUNT.', 0.26, MUTED)
    return
  }
  const start = page * MISSIONS_PER_PAGE
  expeditions.slice(start, start + MISSIONS_PER_PAGE).forEach((exp, i) => {
    const y = 0.5 - i * 0.3
    const isComplete = exp.status === 'completed' || (exp.completes_at && new Date(exp.completes_at).getTime() <= Date.now())
    const status = actionStatus[exp.id]
    let timeText: string
    if (status) timeText = status
    else if (isComplete) timeText = 'READY'
    else { const mins = Math.max(0, Math.ceil((new Date(exp.completes_at).getTime() - Date.now()) / 60000)); const hrs = Math.floor(mins / 60); timeText = hrs > 0 ? `${hrs}h ${mins % 60}m` : `${mins}m` }
    const mining = exp.expedition_type === 'mining'
    text(missionBag, low, 0.25, y, mining ? 'Mining' : 'Exploration', 0.34, mining ? Color4.create(0.9, 0.7, 0.3, 1) : GREEN, TextAlignMode.TAM_MIDDLE_LEFT)
    text(missionBag, low, 1.75, y, timeText, 0.34, isComplete ? Color4.create(1, 1, 0.3, 1) : DIM, TextAlignMode.TAM_MIDDLE_RIGHT)
    if (isComplete && !status) button(missionBag, low, 2.25, y, 0.75, 0.24, 'COLLECT', 'Complete Mission', () => collect(exp.id), { size: 0.26 })
  })
  if (page > 0) button(missionBag, low, 0.7, -0.62, 0.7, 0.22, '‹ PREV', 'Previous Page', () => { page--; drawMissions() }, { size: 0.24 })
  if (page < totalPages - 1) button(missionBag, low, 2.1, -0.62, 0.7, 0.22, 'NEXT ›', 'Next Page', () => { page++; drawMissions() }, { size: 0.24 })
}

async function collect(expeditionId: string): Promise<void> {
  const ctx = ctxRef
  if (!ctx) return
  actionStatus[expeditionId] = 'Processing...'
  drawMissions()
  try {
    let result: any = null
    try { result = await api.completeExpedition(expeditionId) } catch {}
    if (result?.pod_lost) {
      ctx.notify('Expedition failed — pod destroyed!', Color4.create(1, 0.3, 0.3, 1))
    } else {
      try {
        await api.collectExpedition(expeditionId)
        if (result?.type === 'exploration') {
          const parts: string[] = []
          if (result.newSpecies) parts.push('New species!')
          if (result.sampleCollected) parts.push('Sample collected')
          ctx.notify(parts.length > 0 ? `Exploration success! ${parts.join(' — ')}` : 'Exploration complete!', Color4.create(0.2, 0.8, 0.4, 1))
        } else if (result?.rewards) {
          const rt = Object.entries(result.rewards).filter(([k]) => k !== 'species_id').map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`).join(', ')
          ctx.notify(rt ? `Mining successful! ${rt}` : 'Mining complete!', Color4.create(0.9, 0.7, 0.3, 1))
        } else { ctx.notify('Collected!', Color4.create(0, 1, 0.5, 1)) }
        refreshStation('flora')
      } catch { ctx.notify('Already collected', Color4.create(0.7, 0.7, 0.7, 1)) }
    }
    delete actionStatus[expeditionId]
    await ctx.refresh()
  } catch (err: any) { actionStatus[expeditionId] = err.message || 'Failed'; drawMissions() }
}

export const shipOverviewView: ViewDefinition = {
  id: 'overview',
  async render(s: Screens, ctx: StationContext): Promise<void> {
    screens = s; ctxRef = ctx
    drawTop(s.top, ctx)
    drawStats(s.low, ctx)
    const exps = await api.getExpeditions()   // throws -> framework shows "Unable to load"
    expeditions = exps.filter((e: any) => e.status !== 'collected')
    drawMissions()
  },
  clear(): void { clearBag(topBag); clearBag(lowBag); clearBag(missionBag); screens = null },
}
