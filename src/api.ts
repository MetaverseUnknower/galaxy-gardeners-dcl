import { signedFetch } from '~system/SignedFetch'
import { getToken, authenticate } from './auth'
import { StarSystem, PlayerInfo, TravelStatus, FuelCostResponse, NearestSystem } from './types'

const API_BASE = 'http://localhost:3000'

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

export async function getPlayerMe(): Promise<PlayerInfo> {
  return apiGet<PlayerInfo>('/api/galaxy/player/me')
}

export async function getAvailableGalaxies(): Promise<{ id: string }[]> {
  return apiGet<{ id: string }[]>('/api/galaxy/available')
}

export async function joinGalaxy(galaxyId: string, username: string): Promise<{ playerId: string; homeSystemId: string }> {
  return apiPost(`/api/galaxy/${galaxyId}/join`, { username })
}

export async function getSystems(galaxyId: string): Promise<StarSystem[]> {
  return apiGet<StarSystem[]>(`/api/systems/${galaxyId}`)
}

export async function getSystemDetail(systemId: string): Promise<any> {
  return apiGet<any>(`/api/systems/detail/${systemId}`)
}

export async function getNearestSystems(systemId: string, limit: number = 20): Promise<NearestSystem[]> {
  return apiGet<NearestSystem[]>(`/api/systems/nearest/${systemId}?limit=${limit}`)
}

export async function getFuelCost(destinationId: string): Promise<FuelCostResponse> {
  const raw = await apiGet<{ fuelCost: number; distance: number; currentFuel: number; canAfford: boolean }>(`/api/ships/fuel-cost?targetSystemId=${destinationId}`)
  return {
    fuel_cost: raw.fuelCost,
    distance: raw.distance,
    current_fuel: raw.currentFuel
  }
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
