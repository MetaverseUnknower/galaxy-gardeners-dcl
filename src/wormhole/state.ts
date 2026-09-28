// Wormhole events in the ship: the open event (if any) from the server, jumping and returning, and STEM's pod
// warnings. The server decides everything (services/events/wormhole.ts); this polls it every minute once signed in,
// and after every jump or return. index.ts wires the notifications, the map reload and the cutscenes.
import { engine } from '@dcl/sdk/ecs'
import * as api from '../api'
import { getToken } from '../auth'

export type CutsceneKind = 'open' | 'jump' | 'close'
type Listener = (prev: api.WormholeStatus | null, next: api.WormholeStatus | null) => void

let current: api.WormholeStatus | null = null
let busy = false
const listeners: Listener[] = []
const warned = new Set<string>()   // `${eventId}:${mark}` warnings already given
let notify: ((text: string, warning: boolean) => void) | null = null
let arrived: (() => Promise<void>) | null = null
let cutscene: ((kind: CutsceneKind, midpoint?: () => Promise<void>) => Promise<void>) | null = null

export function wormholeEvent(): api.WormholeStatus | null { return current }
export function isWormholeBusy(): boolean { return busy }
export function onWormholeChanged(fn: Listener): void { listeners.push(fn) }
export function setWormholeNotify(fn: (text: string, warning: boolean) => void): void { notify = fn }
export function setWormholeArrivedCallback(fn: () => Promise<void>): void { arrived = fn }
export function setWormholeCutscenePlayer(fn: (kind: CutsceneKind, midpoint?: () => Promise<void>) => Promise<void>): void { cutscene = fn }
/** Plays a cutscene if one is set up; `midpoint` runs at its fully covered moment (or straight away without one). */
export async function playWormholeCutscene(kind: CutsceneKind, midpoint?: () => Promise<void>): Promise<void> {
  if (cutscene) await cutscene(kind, midpoint)
  else if (midpoint) await midpoint()
}

export function podWord(n: number): string { return `${n} ${n === 1 ? 'pod' : 'pods'}` }
export function podWarning(n: number): string { return `Captain, we have to get back to the wormhole or we'll lose contact with ${podWord(n)}!` }

function msLeft(): number { return current ? Date.parse(current.endsAt) - Date.now() : 0 }

/** H:MM:SS until the wormhole closes. */
export function closesInText(): string {
  const s = Math.max(0, Math.floor(msLeft() / 1000))
  const two = (n: number) => (n < 10 ? `0${n}` : `${n}`)
  return `${Math.floor(s / 3600)}:${two(Math.floor(s % 3600 / 60))}:${two(s % 60)}`
}

/** The closing time in the player's local time, e.g. 9:05 PM. */
export function closesAtText(): string {
  if (!current) return ''
  const d = new Date(current.endsAt)
  const h = d.getHours(), m = d.getMinutes()
  return `${h % 12 === 0 ? 12 : h % 12}:${m < 10 ? `0${m}` : m} ${h < 12 ? 'AM' : 'PM'}`
}

export async function refreshWormhole(): Promise<void> {
  let next: api.WormholeStatus | null
  try { next = await api.getWormholeEvent() } catch { return }
  const prev = current
  current = next
  if ((prev?.id ?? null) !== (next?.id ?? null)) for (const fn of listeners) fn(prev, next)
  checkWarnings()
}

// STEM warns at 15 and 2 minutes before closing while the player jumped, hasn't come back through, and has pods out
// (flying off elsewhere doesn't count: only the wormhole keeps contact with the pods)
function checkWarnings(): void {
  if (!current || !current.trip || current.podsOut <= 0) return
  const left = msLeft()
  for (const [mark, ms] of [['15', 15 * 60_000], ['2', 2 * 60_000]] as const) {
    const key = `${current.id}:${mark}`
    if (left > 0 && left <= ms && !warned.has(key)) { warned.add(key); notify?.(podWarning(current.podsOut), true) }
  }
}

function serverError(err: any): string {
  const m = /^API error \d+: (.*)$/s.exec(String(err?.message ?? ''))
  if (m) { try { return JSON.parse(m[1]).error ?? 'The wormhole is unstable, Captain. Try again.' } catch { /* fall through */ } }
  return 'The wormhole is unstable, Captain. Try again.'
}

async function travel(call: () => Promise<{ systemId: string; systemName: string }>, isJump: boolean): Promise<void> {
  if (busy) return
  busy = true
  try {
    await call()
  } catch (err) {
    notify?.(serverError(err), false)
    busy = false
    return
  }
  await playWormholeCutscene('jump', async () => { await arrived?.() })   // the map and window swap while the screen is white
  await refreshWormhole()
  if (isJump && current?.trip && current.podsOut > 0) {
    warned.add(`${current.id}:arrive`)
    notify?.(podWarning(current.podsOut), true)
  }
  busy = false
}

export function jumpThroughWormhole(): Promise<void> { return travel(api.wormholeJump, true) }
export function returnThroughWormhole(): Promise<void> { return travel(api.wormholeReturn, false) }

// Poll once a minute (the first poll soon after sign-in); tick the closing warnings every second
let acc = 0
let sinceLastPoll = 55
engine.addSystem((dt: number) => {
  acc += dt
  if (acc < 1) return
  acc = 0
  checkWarnings()
  if (++sinceLastPoll >= 60 && getToken()) { sinceLastPoll = 0; void refreshWormhole() }
})
