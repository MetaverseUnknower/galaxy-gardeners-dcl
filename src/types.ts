// src/types.ts

export interface StarSystem {
  id: string
  name: string
  coord_r: number
  coord_theta: number
  coord_x: number
  coord_y: number
  coord_z: number
  origin: boolean
  discovered_by: string | null
  discovered_by_name: string | null
  has_station: boolean
  solar_recharge_rate: number
  has_wormhole: boolean
  wormhole_target_id?: string | null   // the black hole its wormhole leads to; null while unlinked
  star_type: string | null
  created_at: string
}

export interface PlayerInfo {
  id: string
  galaxy_id: string
  username: string
  friend_code: string
  home_system_id: string | null
  current_system_id: string | null
  dev_mode: boolean
  is_admin: boolean
}

export interface AuthResponse {
  accessToken: string
  refreshToken: string
  hasPlayer: boolean
}

export interface TravelStatus {
  is_traveling: boolean
  origin_system_id: string | null
  destination_system_id: string | null
  departure_time: string | null
  arrival_time: string | null
}

export interface FuelCostResponse {
  fuel_cost: number
  distance: number
  current_fuel: number
  travel_minutes: number
}

export interface NearestSystem extends StarSystem {
  distance: number
  fuel_cost: number
}
