// Ship station — Pod Operations view (see references/pod-operations-concept.png).
// Top: bay cards (pods online / capacity, MANAGE) and the orbital sector map with click-to-deploy.
// Low: the selected bay — its pods, BUILD POD with costs, bay status and the emergency trade.
import { Entity, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import * as api from '../api'
import { ViewDefinition, StationContext, Screens } from '../stations'
import { Bag, clearBag, text, frame, header, bar, button, image, WHITE, DIM, MUTED, GREEN, RED, CYAN, CYAN3 } from './draw'
import { titleCase } from './data'
import { renderSectorMap, minutesLeft, formatMinutes } from './sectorMap'

type BayType = 'mining' | 'exploration'
const LEFT = TextAlignMode.TAM_MIDDLE_LEFT, RIGHT = TextAlignMode.TAM_MIDDLE_RIGHT
const EMERGENCY_POD_FUEL = 20

const BAYS: { type: BayType; title: string; subtitle: string; capacityField: string; thumb: string; podImage: string; tag: string; icon: string }[] = [
  { type: 'exploration', title: 'EXPLORATION BAY', subtitle: 'survey // map // discover', capacityField: 'exploration_pods_max', thumb: 'assets/images/exploration-bay.png', podImage: 'assets/images/exploration-pod-blueprint.png', tag: 'EX', icon: 'assets/icons/missions-icon.png' },
  { type: 'mining', title: 'MINING BAY', subtitle: 'extract // harvest // supply', capacityField: 'mining_pods_max', thumb: 'assets/images/mining-bay.png', podImage: 'assets/images/mining-pod-blueprint.png', tag: 'MN', icon: 'assets/icons/resources-icon.png' },
]

let currentSystemId: string | null = null
export function setPodOpsSystemId(id: string | null): void { currentSystemId = id }

const topBag: Bag = []
const cardBag: Bag = []
const mapBag: Bag = []
const lowBag: Bag = []
let selectedBay: BayType = 'exploration'
let bodyNames: Record<string, string> = {}
let screens: Screens | null = null
let ctxRef: StationContext | null = null
let busyAction = false

function podsOf(ctx: StationContext, type: BayType): any[] { return (ctx.dashboard?.pods || []).filter((p: any) => p.pod_type === type && !p.is_destroyed) }
function activeExpeditions(ctx: StationContext, type: BayType): any[] { return (ctx.dashboard?.activeExpeditions || []).filter((e: any) => e.expedition_type === type && e.status !== 'collected') }

function drawBayCards(): void {
  if (!screens || !ctxRef) return
  clearBag(cardBag)
  const { top } = screens, ctx = ctxRef
  BAYS.forEach((bay, i) => {
    const cy = i === 0 ? 0.25 : -0.85
    const ship = ctx.dashboard?.ship
    const pods = podsOf(ctx, bay.type)
    const capacity: number = ship?.[bay.capacityField] ?? 0
    const idle = pods.filter((p: any) => !p.is_deployed).length
    const status = pods.length === 0 ? 'NO PODS' : idle > 0 ? 'READY' : 'ALL DEPLOYED'
    const statusColor = pods.length === 0 ? MUTED : idle > 0 ? GREEN : Color4.create(1, 0.8, 0.3, 1)
    const selected = bay.type === selectedBay
    frame(cardBag, top, -1.45, cy, 2.6, 1.0, { border: selected ? CYAN3 : undefined, borderWidth: selected ? 0.03 : 0.02 })
    header(cardBag, top, -2.65, cy + 0.33, { icon: bay.icon, title: bay.title, subtitle: bay.subtitle, size: 0.42 })
    image(cardBag, top, -2.15, cy - 0.2, 0.9, 0.45, bay.thumb)
    text(cardBag, top, -1.55, cy - 0.08, `${pods.length} / ${capacity}`, 0.55, WHITE, LEFT)
    text(cardBag, top, -1.55, cy - 0.27, 'PODS ONLINE', 0.22, DIM, LEFT)
    text(cardBag, top, -1.55, cy - 0.42, `● ${status}`, 0.22, statusColor, LEFT)
    button(cardBag, top, -0.62, cy - 0.34, 0.8, 0.24, 'MANAGE ›', `Manage ${bay.title.toLowerCase()}`, () => { selectedBay = bay.type; drawBayCards(); drawLow() }, { size: 0.24, variant: selected ? 'primary' : 'outline' })
  })
}

function drawLow(): void {
  if (!screens || !ctxRef) return
  clearBag(lowBag)
  const { low } = screens, ctx = ctxRef
  const bay = BAYS.find(b => b.type === selectedBay)!
  const ship = ctx.dashboard?.ship
  const pods = podsOf(ctx, bay.type)
  const exps = activeExpeditions(ctx, bay.type)
  const capacity: number = ship?.[bay.capacityField] ?? 0
  const deployed = pods.filter((p: any) => p.is_deployed).length

  header(lowBag, low, -2.6, 1.0, { icon: bay.icon, title: bay.title, subtitle: 'manage pods', size: 0.5 })
  text(lowBag, low, 2.6, 1.0, `POD-${bay.tag}`, 0.24, DIM, RIGHT)

  // Left: pod blueprint + pod list
  frame(lowBag, low, -1.85, -0.1, 1.75, 1.7)
  image(lowBag, low, -1.85, 0.32, 1.2, 0.9, bay.podImage)
  if (pods.length === 0) text(lowBag, low, -1.85, -0.4, 'No pods in this bay', 0.24, MUTED)
  pods.slice(0, 4).forEach((p: any, i: number) => {
    const y = -0.22 - i * 0.18
    const label = `POD-${bay.tag}-${String(i + 1).padStart(2, '0')}`
    text(lowBag, low, -2.65, y, label, 0.2, WHITE, LEFT)
    if (p.is_deployed) {
      const e = exps[Math.min(i, exps.length - 1)]
      const target = e ? (bodyNames[e.belt_id || e.moon_id || e.planet_id] || 'en route') : ''
      const eta = e?.completes_at ? formatMinutes(minutesLeft(e.completes_at)) : ''
      text(lowBag, low, -1.05, y, `DEPLOYED ${target} ${eta}`.trim(), 0.16, CYAN, RIGHT)
    } else text(lowBag, low, -1.05, y, 'IDLE', 0.18, GREEN, RIGHT)
  })

  // Center: build
  frame(lowBag, low, 0, -0.1, 1.75, 1.7)
  text(lowBag, low, -0.75, 0.62, 'BUILD POD', 0.28, DIM, LEFT)
  const fab = (ctx.dashboard?.podRepair || []).find((f: any) => f.podType === bay.type)
  const active = ctx.dashboard?.activeFabrication
  const fabricating = active && active.pod_type === bay.type && active.status === 'in_progress'
  if (fabricating) {
    const left = minutesLeft(active.completes_at)
    const total = active.duration_minutes || 1
    text(lowBag, low, 0, 0.3, left > 0 ? 'FABRICATING…' : 'FABRICATION COMPLETE', 0.3, CYAN)
    text(lowBag, low, 0, 0.05, left > 0 ? `${formatMinutes(left)} remaining` : 'Ready to bring online', 0.22, WHITE)
    bar(lowBag, low, 0, -0.2, 1.4, 1 - left / total, { h: 0.1 })
    button(lowBag, low, 0, -0.62, 1.5, 0.3, left > 0 ? 'IN PROGRESS' : 'BRING ONLINE', 'Fabrication', () => collectFabrication(), { variant: left > 0 ? 'disabled' : 'primary', size: 0.3 })
  } else if (!fab) {
    text(lowBag, low, 0, 0.05, 'Build pricing unavailable', 0.24, MUTED)
  } else {
    const inv: any[] = ctx.dashboard?.inventory || []
    const have = (r: string) => inv.find(x => x.resource_type === r)?.quantity ?? 0
    Object.entries(fab.resourceCosts as Record<string, number>).slice(0, 3).forEach(([r, need], i) => {
      const y = 0.36 - i * 0.2
      const ok = have(r) >= need
      text(lowBag, low, -0.7, y, titleCase(r), 0.22, WHITE, LEFT)
      text(lowBag, low, 0.7, y, `${have(r)} / ${need}`, 0.22, ok ? GREEN : RED, RIGHT)
    })
    text(lowBag, low, 0, -0.28, fab.instant ? 'INSTANT AT STATION' : `FABRICATOR: ${formatMinutes(fab.buildMinutes)}`, 0.2, DIM)
    if (pods.length >= capacity) button(lowBag, low, 0, -0.62, 1.5, 0.3, 'BAY FULL', 'Bay full', () => {}, { variant: 'disabled', size: 0.3 })
    else if (busyAction) button(lowBag, low, 0, -0.62, 1.5, 0.3, 'WORKING…', 'Working', () => {}, { variant: 'disabled', size: 0.3 })
    else if (fab.available) button(lowBag, low, 0, -0.62, 1.5, 0.3, 'BUILD POD', `Build ${bay.type} pod`, () => build(bay.type), { variant: 'primary', size: 0.32 })
    else button(lowBag, low, 0, -0.62, 1.5, 0.3, (fab.reason || 'UNAVAILABLE').toUpperCase(), fab.reason || 'Unavailable', () => {}, { variant: 'disabled', size: 0.22 })
  }

  // Right: bay status + emergency trade
  frame(lowBag, low, 1.85, -0.1, 1.75, 1.7)
  text(lowBag, low, 1.1, 0.62, 'BAY STATUS', 0.28, DIM, LEFT)
  text(lowBag, low, 1.1, 0.36, 'PODS ONLINE', 0.2, DIM, LEFT); text(lowBag, low, 2.6, 0.36, `${pods.length} / ${capacity}`, 0.24, WHITE, RIGHT)
  bar(lowBag, low, 1.85, 0.18, 1.5, capacity ? pods.length / capacity : 0, { h: 0.08 })
  text(lowBag, low, 1.1, -0.02, 'DEPLOYED', 0.2, DIM, LEFT); text(lowBag, low, 2.6, -0.02, `${deployed}`, 0.24, WHITE, RIGHT)
  text(lowBag, low, 1.1, -0.22, 'IDLE', 0.2, DIM, LEFT); text(lowBag, low, 2.6, -0.22, `${pods.length - deployed}`, 0.24, WHITE, RIGHT)
  const totalPods = (ctx.dashboard?.pods || []).filter((p: any) => !p.is_destroyed).length
  if (totalPods === 0) {
    const canAfford = (ship?.fuel_current ?? 0) >= EMERGENCY_POD_FUEL
    button(lowBag, low, 1.85, -0.62, 1.5, 0.3, `EMERGENCY POD  −${EMERGENCY_POD_FUEL} FUEL`, 'Trade fuel for a pod', () => emergency(bay.type), { variant: canAfford && !busyAction ? 'magenta' : 'disabled', size: 0.2 })
  } else {
    text(lowBag, low, 1.85, -0.62, 'EMERGENCY TRADE UNAVAILABLE\nWHILE ANY POD IS ONLINE', 0.16, MUTED)
  }
  button(lowBag, low, -2.05, -1.08, 1.4, 0.22, '‹ BACK TO OVERVIEW', 'Back to Overview', () => ctx.setView('overview'), { size: 0.22 })
}

async function withAction(label: string, run: () => Promise<string>): Promise<void> {
  const ctx = ctxRef
  if (!ctx || busyAction) return
  busyAction = true
  drawLow()
  try { ctx.notify(await ctx.busy(run()), GREEN) }
  catch (err: any) { ctx.notify(err?.message || `${label} failed`, RED) }
  busyAction = false
  await ctx.refresh()
}
function build(type: BayType): Promise<void> {
  return withAction('Build', async () => { const r = await api.buildPod(type); return r?.fabrication ? `${titleCase(type)} pod fabrication started` : `${titleCase(type)} pod built` })
}
function collectFabrication(): Promise<void> {
  return withAction('Fabrication', async () => { const r = await api.getFabricationStatus(); return r?.completed ? 'Pod online' : 'Fabrication still in progress' })
}
function emergency(type: BayType): Promise<void> {
  return withAction('Emergency trade', async () => { await api.emergencyPod(type); return `Emergency ${type} pod acquired` })
}

export const podOperationsView: ViewDefinition = {
  id: 'pods',
  async render(s: Screens, ctx: StationContext): Promise<void> {
    screens = s; ctxRef = ctx
    const { top } = s
    header(topBag, top, -2.6, 1.1, { title: 'POD OPERATIONS', subtitle: 'deploy // monitor // retrieve // maximize yield' })
    text(topBag, top, 2.6, 1.15, 'FURTHER REACH.', 0.24, MUTED, RIGHT)
    text(topBag, top, 2.6, 0.97, 'RICHER WORLDS.', 0.24, MUTED, RIGHT)
    if (!ctx.dashboard) throw new Error('no dashboard')
    drawBayCards()
    bodyNames = await renderSectorMap(mapBag, top, 1.4, -0.3, 2.6, 2.1, ctx, currentSystemId)
    drawLow()
  },
  clear(): void { clearBag(topBag); clearBag(cardBag); clearBag(mapBag); clearBag(lowBag); screens = null },
}
