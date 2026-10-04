// Distress calls in the ship. A captain who can't reach any other star sends a call to their galaxy; every other ship
// hears it (STEM announces it, the map rings the star) and can respond from afar, then send fuel or tow the stranded
// ship to the nearest station once in the same system. The server does the work (routes/distress.ts); this keeps
// the galaxy's calls, decides what each ship can do about them, and tells the rescued captain who helped.
import { engine } from '@dcl/sdk/ecs'
import * as api from './api'
import { getToken } from './auth'

type System = { id: string; name: string; coord_x: number; coord_y: number; coord_z: number; has_station: boolean; remnant_at?: string | null }
export type Help = 'respond' | 'responding' | 'help'

const FUEL_PER_GU = 1          // the server's BASE_FUEL_RATE
const TOW_MULTIPLIER = 2       // a tow costs the helper twice the trip, at base efficiency
const FUEL_CHOICES = [10, 25, 50]
const MESSAGE_MAX = 200        // the server keeps no more (routes/distress.ts)

/** Quick lines for the distress dialog: the server has one kind of call, so these are just the message. */
export const DISTRESS_PRESETS = [
  { label: 'NEED FUEL', text: "Out of fuel and can't reach the next star. Any fuel helps!" },
  { label: 'NEED A TOW', text: 'Stranded. Requesting a tow to the nearest station.' },
]
/** The message as sent: trimmed, left out when blank, cut to what the server keeps. */
export function distressMessage(text: string): string | undefined {
  const t = text.trim()
  return t ? t.slice(0, MESSAGE_MAX) : undefined
}
const POLL_SECONDS = 60

let calls: api.DistressCall[] = []
const announced = new Set<string>()
let mine: api.DistressCall | null = null
let cancelling = false          // our own call is closing because we cancelled it, not because someone helped
let handlers: { say?: (text: string) => void; shipChanged?: () => void; moved?: () => void; changed?: () => void } = {}

export function setDistressHandlers(h: typeof handlers): void { handlers = { ...handlers, ...h } }
export function distressCalls(): api.DistressCall[] { return calls }
/** Other captains' calls from a system (the star panel and the map). */
export function callsAt(systemId: string): api.DistressCall[] { return calls.filter(c => c.systemId === systemId && !c.isMe) }
export function myCall(): api.DistressCall | null { return mine }
/** Back to nothing heard, for tests. */
export function resetDistress(): void { calls = []; announced.clear(); mine = null; cancelling = false; handlers = {}; signature = ''; ship = null; systems = []; hereId = null }

// Where the ship is and what's in its tank: set by index.ts (the galaxy's systems) and the ship desk (the dashboard)
let systems: System[] = []
let hereId: string | null = null
let ship: { fuel: number; efficiency: number; stranded: boolean } | null = null
export function setDistressPlace(list: System[], currentSystemId: string | null): void { systems = list; hereId = currentSystemId }
export function setDistressShip(s: { fuel: number; efficiency: number; stranded: boolean } | null): void { ship = s }
export function distressPlace(): { systems: System[]; hereId: string | null; ship: typeof ship } { return { systems, hereId, ship } }
/** The fuel panel offers SEND DISTRESS CALL when the ship can't reach any other star. */
export function shouldOfferDistress(): boolean { return !!ship && !mine && needsHelp(ship, hereId, systems) }
let signature = ''

const dist = (a: System, b: System) => Math.hypot(a.coord_x - b.coord_x, a.coord_y - b.coord_y, a.coord_z - b.coord_z)
const reachable = (s: System) => !s.remnant_at

/** Stranded, or short of the fuel to reach even the nearest other star. */
export function needsHelp(ship: { fuel: number; efficiency: number; stranded: boolean }, hereId: string | null, systems: System[]): boolean {
  if (ship.stranded) return true
  const here = systems.find(s => s.id === hereId)
  if (!here) return false
  let nearest = Infinity
  for (const s of systems) if (s.id !== here.id && reachable(s)) nearest = Math.min(nearest, dist(here, s))
  return nearest !== Infinity && ship.fuel < (nearest * FUEL_PER_GU) / (ship.efficiency || 1)
}

/** What this ship can do about a call: respond from afar, it already has, or help in person. Nothing in flight. */
export function helpFor(call: api.DistressCall, hereId: string | null, traveling: boolean): Help | null {
  if (call.isMe || traveling) return null
  if (call.systemId === hereId) return 'help'
  return call.iAccepted ? 'responding' : 'respond'
}

/** The fuel amounts this ship can spare (the server tops their tank up to full at most). */
export function fuelChoices(myFuel: number): number[] { return FUEL_CHOICES.filter(n => n <= myFuel) }

/** The nearest station system other than this one: a tow's safe harbour. */
export function nearestStation(hereId: string, systems: System[]): System | null {
  const here = systems.find(s => s.id === hereId)
  if (!here) return null
  let best: System | null = null
  for (const s of systems) {
    if (s.id === here.id || !s.has_station || !reachable(s)) continue
    if (!best || dist(here, s) < dist(here, best)) best = s
  }
  return best
}

export function towCost(fromId: string, toId: string, systems: System[]): number {
  const a = systems.find(s => s.id === fromId), b = systems.find(s => s.id === toId)
  return a && b ? Math.ceil(dist(a, b) * FUEL_PER_GU * TOW_MULTIPLIER) : 0
}

/** "API error 400: {"error":"..."}" → the server's own words */
function serverMessage(err: any, fallback: string): string {
  const m = /^API error \d+: (.*)$/s.exec(String(err?.message ?? ''))
  if (m) { try { return JSON.parse(m[1]).error ?? fallback } catch { return fallback } }
  return err?.message || fallback
}
async function call<T>(p: () => Promise<T>, fallback: string): Promise<T> {
  try { return await p() } catch (err) { throw new Error(serverMessage(err, fallback)) }
}

/** The galaxy's calls from the server: announces new ones, and notices our own closing. */
export async function refreshDistress(): Promise<void> {
  let next: api.DistressCall[]
  try { next = await api.getActiveDistressCalls() } catch { return }
  const hadMine = mine
  calls = next
  mine = next.find(c => c.isMe) ?? null
  for (const c of next) {
    if (c.isMe || announced.has(c.id)) continue
    announced.add(c.id)
    handlers.say?.(`Distress call, Captain: ${c.username} is stranded at ${c.systemName}.${c.message ? ` "${c.message}"` : ''} Select the star to respond.`)
  }
  if (hadMine && !mine) {
    if (!cancelling) {
      // Fuel from a helper, a tow, or the star's own recharge: all three close the call
      handlers.say?.("Our distress call has closed, Captain. We can move again.")
      handlers.moved?.()   // a tow moves the ship; fuel shows on the desks either way
    }
    cancelling = false
  }
  // Redraw the map and desks only when something changed (the poll runs every minute)
  const sig = JSON.stringify(next.map(c => [c.id, c.acceptorCount, c.iAccepted]))
  if (sig !== signature) { signature = sig; handlers.changed?.() }
}

export async function sendDistress(message?: string): Promise<void> {
  await call(() => api.sendDistressCall(message), 'The distress beacon failed to transmit')
  await refreshDistress()
}

export async function cancelDistress(): Promise<void> {
  if (!mine) return
  cancelling = true
  await call(() => api.cancelDistressCall(mine!.id), "Couldn't cancel the distress call")
  await refreshDistress()
}

export async function respondTo(id: string): Promise<void> {
  await call(() => api.acceptDistressCall(id), "Couldn't respond to the call")
  await refreshDistress()
}

export async function sendFuelTo(id: string, amount: number): Promise<number> {
  const r = await call(() => api.transferDistressFuel(id, amount), 'The fuel transfer failed')
  handlers.shipChanged?.()
  await refreshDistress()
  return r.fuelTransferred
}

export async function towToSafety(id: string, destinationId: string): Promise<void> {
  await call(() => api.towDistressShip(id, destinationId), 'The tow failed')
  handlers.moved?.()   // both ships are at the destination now
  await refreshDistress()
}

/** Poll once a minute once signed in (the first soon after). */
export function startDistressWatch(): void {
  let acc = POLL_SECONDS - 5
  engine.addSystem((dt: number) => {
    acc += dt
    if (acc < POLL_SECONDS || !getToken()) return
    acc = 0
    void refreshDistress()
  })
}
