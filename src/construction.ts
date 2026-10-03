// Building a space station from the ship. The server does the work (routes/construction.ts): a build in the ship's
// system costs resources up front and takes 24 hours, then the player opens the station. This keeps the player's
// build in progress, decides what the nav console's station card shows, and checks the build dialog's costs.
import * as api from './api'

export type Build = { id: string; systemId: string; stationName: string; startedAt: number; completesAt: number }
export type CostRow = { resource: string; label: string; need: number; have: number; short: boolean }
export type StationCard =
  | { kind: 'available' }
  | { kind: 'building'; build: Build; progress: number; left: string }
  | { kind: 'ready'; build: Build }
  | { kind: 'elsewhere'; build: Build }

const LABELS: Record<string, string> = {
  titanium: 'Titanium', quantum_alloy: 'Quantum Alloy', dark_matter: 'Dark Matter', void_essence: 'Void Essence',
}
const label = (resource: string) => LABELS[resource] ?? resource.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const MIN_NAME = 3   // the server's rule too

let active: Build | null = null
let costs: Record<string, number> = { titanium: 50, quantum_alloy: 30, dark_matter: 15, void_essence: 5 }   // until the server says
const listeners: (() => void)[] = []
let opened: ((s: { systemId: string; stationId: string; stationName: string }) => void) | null = null

export function activeBuild(): Build | null { return active }
export function constructionCosts(): Record<string, number> { return costs }
export function onConstructionChanged(fn: () => void): void { listeners.push(fn) }
/** Told when a station opens, so the map, the console and the system view can show it. */
export function setStationOpenedCallback(fn: (s: { systemId: string; stationId: string; stationName: string }) => void): void { opened = fn }
/** Back to no build and the default costs, for tests. */
export function resetConstruction(): void { active = null; listeners.length = 0; opened = null }

function changed(): void { for (const fn of listeners) fn() }

function fromRow(r: api.ConstructionRow): Build {
  return { id: r.id, systemId: r.system_id, stationName: r.station_name, startedAt: Date.parse(r.started_at), completesAt: Date.parse(r.completes_at) }
}

/** "API error 400: {"error":"..."}" → the server's own words */
function serverMessage(err: any): string {
  const m = /^API error \d+: (.*)$/s.exec(String(err?.message ?? ''))
  if (m) { try { return JSON.parse(m[1]).error ?? 'Construction failed' } catch { return 'Construction failed' } }
  return err?.message || 'Construction failed'
}

/** The player's build in progress (and the costs), from the server. */
export async function loadConstruction(): Promise<void> {
  const [row, c] = await Promise.all([api.getActiveConstruction().catch(() => null), api.getConstructionCosts().catch(() => null)])
  if (c && Object.keys(c).length) costs = c
  active = row ? fromRow(row) : null
  changed()
}

/** Each cost against the hold, in the server's order. */
export function costRows(c: Record<string, number>, inventory: { resource_type: string; quantity: number }[]): CostRow[] {
  return Object.entries(c).map(([resource, need]) => {
    const have = inventory.find(i => i.resource_type === resource)?.quantity ?? 0
    return { resource, label: label(resource), need, have, short: have < need }
  })
}

export function canBegin(rows: CostRow[], name: string): { ok: true } | { ok: false; reason: string } {
  const short = rows.filter(r => r.short).map(r => r.label)
  if (short.length) return { ok: false, reason: `Not enough ${short.join(' or ')}` }
  if (name.trim().length < MIN_NAME) return { ok: false, reason: `Name the station (${MIN_NAME} characters or more)` }
  return { ok: true }
}

export function timeLeftText(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'under a minute'
  const h = Math.floor(minutes / 60)
  return h > 0 ? `${h}h ${minutes % 60}m` : `${minutes}m`
}

/** What the console's station card shows in a system without a station. */
export function stationCard(systemId: string | null, build: Build | null, now: number = Date.now()): StationCard {
  if (!build) return { kind: 'available' }
  if (build.systemId !== systemId) return { kind: 'elsewhere', build }   // the server allows one build per player
  if (now >= build.completesAt) return { kind: 'ready', build }
  const progress = Math.min(1, Math.max(0, (now - build.startedAt) / (build.completesAt - build.startedAt)))
  return { kind: 'building', build, progress, left: timeLeftText(build.completesAt - now) }
}

/** Start building in the ship's system. Throws the server's reason when it refuses. */
export async function beginConstruction(systemId: string, name: string): Promise<void> {
  const stationName = name.trim()
  let r: { constructionId: string; completesAt: string }
  try { r = await api.startConstruction(stationName) } catch (err) { throw new Error(serverMessage(err)) }
  active = { id: r.constructionId, systemId, stationName, startedAt: Date.now(), completesAt: Date.parse(r.completesAt) }
  changed()
}

/** The build is done: open the station. Throws the server's reason when it refuses. */
export async function openStation(): Promise<void> {
  const build = active
  if (!build) return
  let r: { stationId: string; stationName: string }
  try { r = await api.completeConstruction(build.id) } catch (err) { throw new Error(serverMessage(err)) }
  active = null
  api.invalidateSystemDetail(build.systemId)   // the cached detail still says there's no station
  changed()
  opened?.({ systemId: build.systemId, stationId: r.stationId, stationName: r.stationName })
}
