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

async function apiGet<T>(path: string): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await makeRequest(`${API_BASE}${path}`, { method: 'GET', headers })

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.body}`)
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
    throw new Error(`API error ${response.status}: ${response.body}`)
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
    throw new Error(`API error ${response.status}: ${response.body}`)
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

export async function getShipDashboard(): Promise<any> {
  return apiGet<any>('/api/ships')
}

export async function getExpeditions(): Promise<any[]> {
  return apiGet<any[]>('/api/expeditions')
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

export async function getAvailableUpgrades(): Promise<any[]> {
  return apiGet<any[]>('/api/ships/upgrades')
}

export async function applyUpgrade(category: string): Promise<any> {
  return apiPost<any>('/api/ships/upgrade', { category })
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

export async function getFabricationStatus(): Promise<any> {
  return apiGet('/api/ship/fabrication-status')
}

export async function emergencyPod(podType: 'mining' | 'exploration'): Promise<any> {
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
