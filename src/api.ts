import { signedFetch } from '~system/SignedFetch'
import { getToken } from './auth'
import { StarSystem, PlayerInfo, TravelStatus, FuelCostResponse, NearestSystem } from './types'

const API_BASE = 'https://staging.galaxygardeners.app'

async function apiGet<T>(path: string): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await signedFetch({
    url: `${API_BASE}${path}`,
    init: { method: 'GET', headers }
  })

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

  const response = await signedFetch({
    url: `${API_BASE}${path}`,
    init: {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined
    }
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

export async function getNearestSystems(systemId: string, limit: number = 20): Promise<NearestSystem[]> {
  return apiGet<NearestSystem[]>(`/api/systems/nearest/${systemId}?limit=${limit}`)
}

export async function getFuelCost(destinationId: string): Promise<FuelCostResponse> {
  return apiGet<FuelCostResponse>(`/api/ships/fuel-cost?destination=${destinationId}`)
}

export async function travel(destinationId: string): Promise<void> {
  await apiPost('/api/ships/travel', { systemId: destinationId })
}

export async function getTravelStatus(): Promise<TravelStatus> {
  return apiGet<TravelStatus>('/api/ships/travel-status')
}

export async function arrive(): Promise<void> {
  await apiPost('/api/ships/arrive')
}
