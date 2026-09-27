// Which star systems the player has visited and fully explored (every living planet and moon's flora cataloged).
// The galaxy map draws rings from this and the star panel shows it; refreshed on load, on arrival and after a scan.
import * as api from './api'

let progress = new Map<string, api.SystemProgress>()
const listeners: (() => void)[] = []

export function systemProgress(systemId: string): api.SystemProgress | null { return progress.get(systemId) ?? null }
export function onSystemProgressChanged(fn: () => void): void { listeners.push(fn) }

export async function refreshSystemProgress(): Promise<void> {
  try {
    const list = await api.getSystemsProgress()
    progress = new Map(list.map(p => [p.systemId, p]))
  } catch (err) { console.log('[systemProgress] load failed', err); return }
  for (const fn of listeners) fn()
}

/** One line for the star panel, or null when the player hasn't been there or cataloged anything in it. */
export function progressLabel(systemId: string): string | null {
  const p = progress.get(systemId)
  if (!p) return null
  if (p.explored) return p.lifeBodies > 0 ? `FULLY EXPLORED  ·  FLORA ${p.cataloged} / ${p.lifeBodies}` : 'FULLY EXPLORED  ·  NO LIFE'
  return `${p.visited ? 'VISITED' : 'NOT VISITED'}  ·  FLORA CATALOGED ${p.cataloged} / ${p.lifeBodies}`
}
