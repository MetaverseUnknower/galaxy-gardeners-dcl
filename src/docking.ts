// Docking at a station. Once docked the crew can board the station (the Stellar Station world, see boardStation),
// and the station's EVA crews service the ship through the
// external service ports, which is how upgrades get installed while docked.
import { Color4 } from '@dcl/sdk/math'
import { changeRealm } from '~system/RestrictedActions'
import * as api from './api'
import { showNotification } from './ui'
import { emitTourEvent } from './tour/events'

let docked = false
let stationName: string | null = null
const listeners: (() => void)[] = []

export function isDocked(): boolean { return docked }
export function dockedStationName(): string | null { return stationName }
export function onDockingChanged(fn: () => void): void { listeners.push(fn) }
function changed(): void { for (const fn of listeners) fn() }

/** Reads the docked state from the server (the dashboard carries it). */
export async function loadDockedStatus(): Promise<void> {
  try {
    const dash = await api.getShipDashboard()
    docked = !!dash?.isDocked
  } catch { /* keep current */ }
  changed()
}

export async function dockAt(stationId: string, name: string): Promise<void> {
  try {
    await api.dockAtStation(stationId)
  } catch (err: any) {
    const msg = /Already docked/i.test(err?.message ?? '') ? null : (err?.message ?? 'Docking failed')
    if (msg) { showNotification(`Docking refused: ${cleanError(msg)}`, Color4.create(1, 0.4, 0.4, 1), 6); return }
  }
  docked = true
  stationName = name
  api.invalidateFuelCosts()
  showNotification(
    `Clamps locked, Captain. We're docked at ${name}. The airlock is open: press BOARD STATION on the Stellar Navigation console to go aboard. ${name}'s EVA crews can reach us through the external service ports too, so open Ship Systems and they'll install any upgrade we can pay for.`,
    Color4.create(0, 1, 0.8, 1), 12)
  emitTourEvent('docked')
  changed()
}

export async function undock(quiet: boolean = false): Promise<void> {
  try { await api.undockFromStation() } catch (err: any) {
    showNotification(`Couldn't release the clamps: ${cleanError(err?.message ?? 'unknown error')}`, Color4.create(1, 0.4, 0.4, 1), 6)
    return
  }
  const from = stationName
  docked = false
  stationName = null
  if (!quiet) showNotification(`Clamps released${from ? `. Clear of ${from}` : ''}, Captain. Service crews are back inside.`, Color4.create(0, 0.9, 1, 1), 6)
  changed()
}

const STATION_WORLD = 'stellarstation.dcl.eth'

/** Moves the player to the Stellar Station world. The station scene reads which station from the server. */
export function boardStation(): void {
  if (!docked) return
  void changeRealm({ realm: STATION_WORLD, message: `Board ${stationName ?? 'the station'}? Your ship stays docked while you're aboard.` })
    .catch((err) => console.log('[docking] changeRealm failed', err))
}

/** "API error 400: {"error":"Station is full"}" → "Station is full" */
function cleanError(msg: string): string {
  const m = /^API error \d+: (.*)$/s.exec(msg)
  if (m) { try { return JSON.parse(m[1]).error ?? msg } catch { return msg } }
  return msg
}
