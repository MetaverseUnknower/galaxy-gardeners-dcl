import { signedFetch } from '~system/SignedFetch'
import { getToken, authenticate } from './auth'
import { StarSystem, PlayerInfo, TravelStatus, FuelCostResponse, NearestSystem } from './types'

const API_BASE = 'https://galaxygardeners.app'

async function makeRequest(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; body: string }> {
  const response = await signedFetch({ url, init })

  if (response.status === 401) {
    console.log('[api] Token expired, re-authenticating...')
    await authenticate()
    const newToken = getToken()
    if (newToken) {
      init.headers['Authorization'] = `Bearer ${newToken}`
    }
    return await signedFetch({ url, init })
  }

  return response
}

// On an error reply the Decentraland client unwraps our JSON itself and hands the scene only its `error` string
// (unity-explorer SignedFetchWrap.cs, the UnityWebRequestException catch). Wrap it back so every caller reads
// "API error N: {"error": ...}" as before; a body that is still JSON (other clients) passes through.
export function errorBody(body: string): string {
  try { const v = JSON.parse(body); if (v && typeof v === 'object') return body } catch { /* the bare message */ }
  return JSON.stringify({ error: body || 'Request failed' })
}

async function apiGet<T>(path: string): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await makeRequest(`${API_BASE}${path}`, { method: 'GET', headers })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${errorBody(response.body)}`)
  }

  return JSON.parse(response.body) as T
}

async function apiPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await makeRequest(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${errorBody(response.body)}`)
  }

  if (!response.body) return undefined as T
  return JSON.parse(response.body) as T
}

async function apiPut<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await makeRequest(`${API_BASE}${path}`, {
    method: 'PUT',
    headers,
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${errorBody(response.body)}`)
  }

  if (!response.body) return undefined as T
  return JSON.parse(response.body) as T
}

export async function getPlayerMe(): Promise<PlayerInfo> {
  return apiGet<PlayerInfo>('/api/galaxy/player/me')
}

export async function getAvailableGalaxies(): Promise<{ id: string }[]> {
  return apiGet<{ id: string }[]>('/api/galaxy/available')
}

export async function joinGalaxy(galaxyId: string, username: string): Promise<{ playerId: string; homeSystemId: string }> {
  return apiPost(`/api/galaxy/${galaxyId}/join`, { username })
}

/** Players seen in the last 24 hours, counted by the system their ship is in. */
export async function getSystemPopulation(galaxyId: string): Promise<{ windowHours: number; systems: { systemId: string; players: number }[] }> {
  return apiGet(`/api/systems/${galaxyId}/population`)
}

export async function getSystems(galaxyId: string): Promise<StarSystem[]> {
  return apiGet<StarSystem[]>(`/api/systems/${galaxyId}`)
}

// --- Short-lived caches so revisiting a star or system is instant ---
type Cached<T> = { value: T; at: number }
const SYSTEM_DETAIL_TTL_MS = 2 * 60 * 1000
const FUEL_COST_TTL_MS = 30 * 1000
const systemDetailCache = new Map<string, Cached<any>>()
const systemDetailInFlight = new Map<string, Promise<any>>()
const fuelCostCache = new Map<string, Cached<FuelCostResponse>>()

/** Planets, belts and station for a system. Cached for two minutes; concurrent callers share one request. */
export async function getSystemDetail(systemId: string): Promise<any> {
  const hit = systemDetailCache.get(systemId)
  if (hit && Date.now() - hit.at < SYSTEM_DETAIL_TTL_MS) return hit.value
  const pending = systemDetailInFlight.get(systemId)
  if (pending) return pending
  const req = apiGet<any>(`/api/systems/detail/${systemId}`)
    .then(value => { systemDetailCache.set(systemId, { value, at: Date.now() }); return value })
    .finally(() => { systemDetailInFlight.delete(systemId) })
  systemDetailInFlight.set(systemId, req)
  return req
}

export function invalidateSystemDetail(systemId?: string): void {
  if (systemId) systemDetailCache.delete(systemId); else systemDetailCache.clear()
}

/** Last fuel quote for a destination, if any, and whether it is still fresh (under 30 seconds old). */
export function peekFuelCost(destinationId: string): { value: FuelCostResponse; fresh: boolean } | null {
  const hit = fuelCostCache.get(destinationId)
  return hit ? { value: hit.value, fresh: Date.now() - hit.at < FUEL_COST_TTL_MS } : null
}

/** Fuel quotes depend on where the ship is and how much fuel it has: clear them when either changes. */
export function invalidateFuelCosts(): void { fuelCostCache.clear() }

export async function getNearestSystems(systemId: string, limit: number = 20): Promise<NearestSystem[]> {
  return apiGet<NearestSystem[]>(`/api/systems/nearest/${systemId}?limit=${limit}`)
}

export async function getFuelCost(destinationId: string): Promise<FuelCostResponse> {
  const raw = await apiGet<{ fuelCost: number; distance: number; currentFuel: number; canAfford: boolean; travelMinutes: number }>(`/api/ships/fuel-cost?targetSystemId=${destinationId}`)
  const value: FuelCostResponse = {
    fuel_cost: raw.fuelCost,
    distance: raw.distance,
    current_fuel: raw.currentFuel,
    travel_minutes: raw.travelMinutes
  }
  fuelCostCache.set(destinationId, { value, at: Date.now() })
  return value
}

export async function travel(destinationId: string): Promise<void> {
  await apiPost('/api/ships/travel', { targetSystemId: destinationId })
}

export async function getTravelStatus(): Promise<TravelStatus> {
  return apiGet<TravelStatus>('/api/ships/travel-status')
}

export async function arrive(): Promise<void> {
  await apiPost('/api/ships/arrive')
}

export async function solarRecharge(): Promise<any> {
  return apiPost<any>('/api/ships/recharge')
}

/** Full ship state: ship (with effective fuel), inventory, samples, pods, docked flag, and the active fabrication,
 *  installation, expeditions and discovery. (The older /api/ships route lacks everything after pods.) */
export async function getShipDashboard(): Promise<any> {
  return apiGet<any>('/api/ship/dashboard')
}

export async function getExpeditions(): Promise<any[]> {
  return apiGet<any[]>('/api/expeditions')
}

export type RecallPreview = { allowed: boolean; reason?: string; phase: string; recallMinutes: number; waitMinutes: number; lossChance: number; share: number }

/** What recalling this pod now would do (server-computed, nothing rolled yet). */
export async function getRecallPreview(expeditionId: string): Promise<RecallPreview> {
  return apiGet<RecallPreview>(`/api/expeditions/${expeditionId}/recall-preview`)
}

/** Call the pod home early. The outcome is rolled now and revealed on collection. */
export async function recallExpedition(expeditionId: string): Promise<{ completesAt: string; recallMinutes: number }> {
  return apiPost(`/api/expeditions/${expeditionId}/recall`)
}

export async function completeExpedition(expeditionId: string): Promise<any> {
  return apiPost<any>(`/api/expeditions/complete/${expeditionId}`)
}

export async function collectExpedition(expeditionId: string): Promise<any> {
  return apiPost<any>(`/api/expeditions/collect/${expeditionId}`)
}

export async function getDiscoveryOptions(): Promise<any[]> {
  return apiGet<any[]>('/api/expeditions/discovery-options')
}

export async function getActiveDiscovery(): Promise<any> {
  return apiGet<any>('/api/expeditions/active-discovery')
}

export async function startDiscovery(direction: string): Promise<any> {
  return apiPost<any>('/api/expeditions/discover', { direction })
}

export async function completeDiscovery(discoveryId: string): Promise<any> {
  return apiPost<any>(`/api/expeditions/complete-discovery/${discoveryId}`)
}

export async function getCatalog(): Promise<any[]> {
  return apiGet<any[]>('/api/catalog')
}

export async function getCatalogDetail(speciesId: string): Promise<any> {
  return apiGet<any>(`/api/catalog/detail/${speciesId}`)
}

/** Next tier per category with docked-aware pricing: instant when docked, a timed field install otherwise. */
export async function getAvailableUpgrades(): Promise<any[]> {
  const pricing = await getOperationsPricing()
  return pricing?.upgrades ?? []
}

/** Docked: installs at once. In the field: starts a timed installation (returned as `installation`). */
export async function applyUpgrade(category: string, tier: number): Promise<any> {
  return apiPost<any>('/api/ship/upgrade', { category, tier })
}

/** Finishes a field installation whose timer has run out ({ completed: true }), or reports it still running. */
export async function getInstallationStatus(): Promise<any> {
  return apiGet<any>('/api/ship/installation-status')
}

export async function deployMiningPod(beltId: string): Promise<any> {
  return apiPost('/api/expeditions/mine', { beltId })
}

export async function deployExplorationPod(planetId: string): Promise<any> {
  return apiPost('/api/expeditions/explore', { planetId })
}

export async function deployExplorationPodToMoon(moonId: string): Promise<any> {
  return apiPost('/api/expeditions/explore-moon', { moonId })
}

/** Redeem a Polygon MANA payment. 202/pending while the chain has not confirmed it; ok once credited. */
export async function purchaseFuelCellsMana(tier: string, txHash: string): Promise<{ status: 'ok' | 'pending'; fuelCells?: number }> {
  return apiPost('/api/store/purchase-fuel-cells-mana', { tier, txHash })
}

export async function refineFuel(resourceType: string, quantity: number = 1): Promise<{ fuelGained: number; fuelCurrent: number; resourceRemaining: number }> {
  return apiPost('/api/ship/refine', { resource_type: resourceType, quantity })
}

export async function buildPod(podType: 'mining' | 'exploration'): Promise<any> {
  return apiPost('/api/ship/repair-pod', { pod_type: podType })
}

/** Docked-aware pricing: `podRepair` (per pod type) and `upgrades`, with instant/available/reason flags. */
export async function getOperationsPricing(): Promise<any> {
  return apiGet('/api/ship/operations-pricing')
}

export async function dockAtStation(stationId: string): Promise<{ docked: boolean }> {
  return apiPost('/api/stations/dock', { stationId })
}

export async function undockFromStation(): Promise<{ undocked: boolean }> {
  return apiPost('/api/stations/undock')
}

export async function getFabricationStatus(): Promise<any> {
  return apiGet('/api/ship/fabrication-status')
}

/** Instant at a station ({ podId }); elsewhere flown in from the nearest station ({ deliveryId, arrivesAt, station }). */
export async function emergencyPod(podType: 'mining' | 'exploration'): Promise<{ podId?: string; deliveryId?: string; arrivesAt?: string; station?: string }> {
  return apiPost('/api/ships/emergency-pod', { podType })
}

/** Streamed soundtrack playlist (public route). */
export async function getSoundtrack(): Promise<{ tracks: import('./soundtrack').Track[] }> {
  return apiGet('/api/soundtrack')
}

export async function getPreferences(): Promise<Record<string, any>> {
  return apiGet('/api/galaxy/player/me/preferences')
}

export async function savePreferences(patch: Record<string, string | number | boolean | null>): Promise<Record<string, any>> {
  return apiPut('/api/galaxy/player/me/preferences', patch)
}

// STEM, the ship's assistant. 'escalate' means the templates had no answer (the iOS app hands those to an on-device model).
export type StemReply = {
  type: 'response' | 'escalate' | 'command'
  text?: string
  command?: { action: string; confirmText: string; canExecute: boolean; blockedReason?: string }
  warnings: { triggerId: string; tier: number; text: string }[]
}

export async function askStem(message: string, history: { role: 'user' | 'stem'; text: string }[]): Promise<StemReply> {
  return apiPost<StemReply>('/api/stem/query', { message, history, client: 'dcl' })
}

// Walkthrough (the STEM ship tour). Progress and per-scene data live on the server.
export type WalkthroughState = { walkthroughScene: number; walkthroughCompleted: boolean; walkthroughSkipped: boolean }

export async function getWalkthroughState(): Promise<WalkthroughState> {
  return apiGet<WalkthroughState>('/api/walkthrough/state')
}

export async function walkthroughProgress(action: 'advance' | 'skip' | 'complete' | 'restart', scene?: number): Promise<void> {
  await apiPost('/api/walkthrough/progress', scene === undefined ? { action } : { action, scene })
}

export async function getWalkthroughSceneData(scene: number): Promise<Record<string, any>> {
  return apiGet<Record<string, any>>(`/api/walkthrough/scene-data/${scene}?at=current`)   // the tour runs wherever the ship is
}

// Star systems the player has visited, and how fully each one's flora is cataloged.
export type SystemProgress = { systemId: string; visited: boolean; lifeBodies: number; cataloged: number; explored: boolean }

export async function getSystemsProgress(): Promise<SystemProgress[]> {
  return apiGet<SystemProgress[]>('/api/galaxy/player/me/systems-progress')
}

// Long-range scan of a system: exact counts when visited or with a T3 Discovery Array, ranges at T2, words at T1.
export type ScanReading = { exact: number } | { min: number; max: number } | { word: 'no' | 'a few' | 'several' | 'many' } | null
export type SystemScan = { systemId: string; visited: boolean; tier: number; planets: ScanReading; moons: ScanReading; belts: ScanReading }

export async function getSystemScan(systemId: string): Promise<SystemScan> {
  return apiGet<SystemScan>(`/api/galaxy/systems/${systemId}/scan`)
}

/** The guide reveal WebSocket for the signed-in player (same host as the API). */
export function guideSocketUrl(token: string): string {
  return `${API_BASE.replace(/^http/, 'ws')}/ws?token=${encodeURIComponent(token)}`
}

/** Discards one specimen sample to free vault space; the species stays in the Flora Catalog. */
export async function discardSpecimen(sampleId: string): Promise<void> {
  await apiPost('/api/ship/discard-jar', { sample_id: sampleId })
}

/** Hawking drift (staring into the black hole hologram): the level wears off over 3 days; see the server's hawkingDrift.ts. */
export type HawkingDrift = { level: number; recent: number; lifetime: number; lastAt: string | null }
export async function getHawkingDrift(): Promise<HawkingDrift> {
  return apiGet<HawkingDrift>('/api/ship/hawking-drift')
}
export async function recordHawkingDrift(): Promise<HawkingDrift & { recorded: boolean }> {
  return apiPost<HawkingDrift & { recorded: boolean }>('/api/ship/hawking-drift')
}

// Wormhole events: admin-opened temporary wormholes to one system (server services/events/wormhole.ts)
export type WormholeStatus = {
  id: string; targetSystemId: string; targetName: string; startsAt: string; endsAt: string
  trip: { originSystemId: string; originName: string } | null
  podsOut: number; canJump: boolean; jumpBlockedReason: string | null; canReturn: boolean
  eldBuilt?: boolean   // bought from the Eld on the black market (older servers leave it out)
}
export async function getWormholeEvent(): Promise<WormholeStatus | null> { return apiGet<WormholeStatus | null>('/api/events/wormhole') }
export async function wormholeJump(): Promise<{ systemId: string; systemName: string }> { return apiPost('/api/events/wormhole/jump') }
export async function wormholeReturn(): Promise<{ systemId: string; systemName: string }> { return apiPost('/api/events/wormhole/return') }
/** Through the black hole's own wormhole to the black hole it's linked to (instant and free). */
export async function travelThroughBlackHole(): Promise<{ traveled: boolean; fromSystem: string; toSystem: string; toSystemId: string }> {
  return apiPost('/api/ships/wormhole')
}

// Station construction: build a station in the ship's system (24 hours, paid in resources at the start)
export type ConstructionRow = { id: string; system_id: string; station_name: string; started_at: string; duration_minutes: number; completes_at: string; status: string }
export async function getConstructionCosts(): Promise<Record<string, number>> { return apiGet('/api/construction/costs') }
export async function getActiveConstruction(): Promise<ConstructionRow | null> { return apiGet('/api/construction/active') }
export async function startConstruction(stationName: string): Promise<{ constructionId: string; completesAt: string }> {
  return apiPost('/api/construction/start', { stationName })
}
export async function completeConstruction(constructionId: string): Promise<{ stationId: string; stationName: string }> {
  return apiPost(`/api/construction/complete/${constructionId}`)
}

// Distress calls: a stranded ship broadcasts to its galaxy; anyone can respond, then send fuel or tow it once there
export type DistressCall = {
  id: string; playerId: string; username: string; message: string | null; systemId: string; systemName: string
  coordX: number; coordY: number; coordZ: number; acceptorCount: number; iAccepted: boolean; isMe: boolean; createdAt: string
}
export async function getActiveDistressCalls(): Promise<DistressCall[]> { return apiGet('/api/distress/active') }
export async function sendDistressCall(message?: string): Promise<{ id: string }> { return apiPost('/api/distress', message ? { message } : {}) }
export async function cancelDistressCall(id: string): Promise<unknown> { return apiPost(`/api/distress/cancel/${id}`) }
export async function acceptDistressCall(id: string): Promise<{ accepted: boolean }> { return apiPost(`/api/distress/accept/${id}`) }
export async function transferDistressFuel(id: string, fuelAmount: number): Promise<{ status: string; fuelTransferred: number }> {
  return apiPost(`/api/distress/transfer-fuel/${id}`, { fuelAmount })
}
export async function towDistressShip(id: string, destinationSystemId: string): Promise<{ status: string; destinationSystemId: string; towFuelCost: number }> {
  return apiPost(`/api/distress/tow/${id}`, { destinationSystemId })
}
