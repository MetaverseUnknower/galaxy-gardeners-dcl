// Per-player preferences. Kept in memory for the session and mirrored to the server when the
// preferences route exists; a missing route or failed call never blocks the scene.
import * as api from './api'

let prefs: Record<string, any> = {}
let loaded = false

export async function loadPrefs(): Promise<void> {
  try { prefs = (await api.getPreferences()) || {} } catch { prefs = {} }
  loaded = true
}

export function getPref<T>(key: string, fallback: T): T {
  const v = prefs[key]
  return v === undefined || v === null ? fallback : (v as T)
}

export function setPref(key: string, value: string | number | boolean | null): void {
  if (value === null) delete prefs[key]; else prefs[key] = value
  if (loaded) api.savePreferences({ [key]: value }).catch(() => { /* server route may not exist yet; session copy stands */ })
}
