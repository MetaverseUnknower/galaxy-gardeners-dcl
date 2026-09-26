// Docking at a station. Lore: the airlock seal failed its integrity check and engineering still hasn't cleared it,
// so nobody can board the station. Clamped on, though, the station's EVA crews service the ship through the
// external service ports, which is how upgrades get installed while docked.
import { Color4 } from '@dcl/sdk/math'
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
    `Clamps locked, Captain. We're docked at ${name}. The airlock seal still hasn't cleared engineering's integrity check, so no one's going aboard, but ${name}'s EVA crews can reach us through the external service ports. Open Ship Systems and they'll install any upgrade we can pay for.`,
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

/** "API error 400: {"error":"Station is full"}" → "Station is full" */
function cleanError(msg: string): string {
  const m = /^API error \d+: (.*)$/s.exec(msg)
  if (m) { try { return JSON.parse(m[1]).error ?? msg } catch { return msg } }
  return msg
}
