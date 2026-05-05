# Holographic Galaxy Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an interactive holographic galaxy map in Decentraland that authenticates players via wallet, renders ~500 star systems as a 3D projection, and lets players select systems and initiate travel.

**Architecture:** DCL SDK7 scene with 6 source modules (auth, api, galaxyMap, interaction, navigation, ui). One new server endpoint for wallet-based auth. All star systems rendered as emissive sphere entities positioned above a projector base. React-based UI panels for system info and travel controls.

**Tech Stack:** Decentraland SDK7 (ECS, React UI), TypeScript, Express.js (server), Supabase (auth/db)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Entry point — orchestrates auth → fetch → render flow |
| `src/auth.ts` | Get wallet/name from DCL SDK, call server for Supabase token |
| `src/api.ts` | HTTP client for galaxy-gardeners-server (all endpoints) |
| `src/galaxyMap.ts` | Create projector base, star entities, zone rings, coordinate mapping |
| `src/interaction.ts` | Pointer events on stars, selection state, hover/select visuals |
| `src/navigation.ts` | Travel API calls, route line rendering, travel progress system |
| `src/ui.tsx` | React UI panels: system info, travel confirmation, status |
| `src/types.ts` | Shared TypeScript interfaces for API responses |
| **Server** | |
| `galaxy-gardeners-server/src/routes/authDcl.ts` | `POST /api/auth/dcl` endpoint |
| `galaxy-gardeners-server/src/index.ts` | Register new route |

---

## Task 1: Type Definitions

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Create type definitions file**

```typescript
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
  has_station: boolean
  solar_recharge_rate: number
  has_wormhole: boolean
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
  token: string
  playerId: string | null
  isNewPlayer: boolean
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
}

export interface NearestSystem extends StarSystem {
  distance: number
  fuel_cost: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add TypeScript type definitions for API responses"
```

---

## Task 2: Server Auth Endpoint

**Files:**
- Create: `galaxy-gardeners-server/src/routes/authDcl.ts`
- Modify: `galaxy-gardeners-server/src/index.ts`

- [ ] **Step 1: Create the DCL auth route**

```typescript
// galaxy-gardeners-server/src/routes/authDcl.ts
import { Router, Request, Response } from 'express'
import { createClient } from '@supabase/supabase-js'

const authDclRouter = Router()

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

authDclRouter.post('/', async (req: Request, res: Response) => {
  const { walletAddress, displayName } = req.body

  if (!walletAddress || !displayName) {
    res.status(400).json({ error: 'walletAddress and displayName are required' })
    return
  }

  const email = `${walletAddress.toLowerCase()}@dcl.galaxy-gardeners.app`

  try {
    // Try to find existing user by email
    const { data: existingUsers } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingUsers?.users?.find(u => u.email === email)

    let userId: string

    if (existingUser) {
      userId = existingUser.id
    } else {
      // Create new user with wallet-derived email
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { wallet_address: walletAddress, display_name: displayName, platform: 'dcl' }
      })
      if (createError || !newUser.user) {
        res.status(500).json({ error: 'Failed to create user' })
        return
      }
      userId = newUser.user.id
    }

    // Generate a session token for this user
    const { data: session, error: sessionError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email
    })

    // Use admin to create a session directly
    const { data: sessionData, error: signInError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email
    })

    // For server-to-server, we'll generate a custom token approach:
    // Sign in on behalf of user using admin API
    const { data: tokenData, error: tokenError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email
    })

    if (tokenError) {
      res.status(500).json({ error: 'Failed to generate session' })
      return
    }

    // Exchange the magic link token for a session
    const token = tokenData.properties?.hashed_token
    if (!token) {
      res.status(500).json({ error: 'Failed to generate token' })
      return
    }

    // Verify OTP to get actual session
    const { data: verifyData, error: verifyError } = await supabaseAdmin.auth.verifyOtp({
      email,
      token: tokenData.properties.token,
      type: 'magiclink'
    })

    if (verifyError || !verifyData.session) {
      res.status(500).json({ error: 'Failed to verify session' })
      return
    }

    // Check if player exists
    const { data: player } = await supabaseAdmin
      .from('players')
      .select('id')
      .eq('supabase_auth_id', userId)
      .single()

    res.json({
      token: verifyData.session.access_token,
      refreshToken: verifyData.session.refresh_token,
      playerId: player?.id || null,
      isNewPlayer: !player
    })
  } catch (err) {
    console.error('DCL auth error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default authDclRouter
```

- [ ] **Step 2: Register the route in index.ts**

Add to `galaxy-gardeners-server/src/index.ts` imports:
```typescript
import authDclRouter from './routes/authDcl'
```

Add to route registration (alongside other routes):
```typescript
app.use('/api/auth/dcl', authDclRouter)
```

- [ ] **Step 3: Test the endpoint manually**

```bash
cd ~/Git/galaxy-gardeners-server
npm run build
```

Verify no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
cd ~/Git/galaxy-gardeners-server
git add src/routes/authDcl.ts src/index.ts
git commit -m "feat: add DCL wallet-based auth endpoint"
```

---

## Task 3: DCL Auth Module

**Files:**
- Create: `src/auth.ts`

- [ ] **Step 1: Implement auth module**

```typescript
// src/auth.ts
import { getPlayerData } from '~system/Players'
import { signedFetch } from '~system/SignedFetch'

const API_BASE = 'https://staging.galaxygardeners.app'

let authToken: string | null = null
let currentPlayerId: string | null = null

export function getToken(): string | null {
  return authToken
}

export function getPlayerId(): string | null {
  return currentPlayerId
}

export async function authenticate(): Promise<{ isNewPlayer: boolean }> {
  // Get player data from DCL SDK
  const response = await getPlayerData({})
  const userData = response.data

  if (!userData) {
    throw new Error('Could not get player data from Decentraland')
  }

  const walletAddress = userData.publicKey || userData.userId
  const displayName = userData.displayName || 'Explorer'

  // Call our auth endpoint
  const authResponse = await signedFetch({
    url: `${API_BASE}/api/auth/dcl`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, displayName })
    }
  })

  if (!authResponse.ok) {
    throw new Error(`Auth failed: ${authResponse.status} ${authResponse.body}`)
  }

  const data = JSON.parse(authResponse.body)
  authToken = data.token
  currentPlayerId = data.playerId

  return { isNewPlayer: data.isNewPlayer }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/auth.ts
git commit -m "feat: add DCL auth module using wallet address"
```

---

## Task 4: API Client

**Files:**
- Create: `src/api.ts`

- [ ] **Step 1: Implement API client**

```typescript
// src/api.ts
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
```

- [ ] **Step 2: Commit**

```bash
git add src/api.ts
git commit -m "feat: add API client for galaxy-gardeners server"
```

---

## Task 5: Galaxy Map Rendering

**Files:**
- Create: `src/galaxyMap.ts`

- [ ] **Step 1: Implement galaxy map renderer**

```typescript
// src/galaxyMap.ts
import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { StarSystem } from './types'

// Map center position (world space)
const MAP_CENTER = Vector3.create(8, 4, 8)
const MAP_RADIUS = 6.0
const PROJECTOR_RADIUS = 1.5
const PROJECTOR_HEIGHT = 0.3

// Store entity references for interaction
export const starEntities: Map<Entity, StarSystem> = new Map()
let projectorEntity: Entity
let beamEntity: Entity
const zoneRingEntities: Entity[] = []

export function createProjectorBase(): void {
  // Main projector cylinder
  projectorEntity = engine.addEntity()
  Transform.create(projectorEntity, {
    position: Vector3.create(MAP_CENTER.x, PROJECTOR_HEIGHT / 2, MAP_CENTER.z),
    scale: Vector3.create(PROJECTOR_RADIUS * 2, PROJECTOR_HEIGHT, PROJECTOR_RADIUS * 2)
  })
  MeshRenderer.setCylinder(projectorEntity)
  Material.setPbrMaterial(projectorEntity, {
    albedoColor: Color4.create(0.05, 0.05, 0.1, 1),
    emissiveColor: Color3.create(0, 0.3, 0.4),
    emissiveIntensity: 2,
    metallic: 0.8,
    roughness: 0.3
  })

  // Upward beam effect (tall thin translucent cylinder)
  beamEntity = engine.addEntity()
  Transform.create(beamEntity, {
    position: Vector3.create(MAP_CENTER.x, MAP_CENTER.y / 2, MAP_CENTER.z),
    scale: Vector3.create(0.3, MAP_CENTER.y, 0.3)
  })
  MeshRenderer.setCylinder(beamEntity)
  Material.setPbrMaterial(beamEntity, {
    albedoColor: Color4.create(0, 1, 1, 0.05),
    emissiveColor: Color3.create(0, 0.5, 0.5),
    emissiveIntensity: 1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })
}

export function createZoneRings(maxCoordRadius: number): void {
  const zoneDistances = [100, 300, 600, 900]
  const scale = MAP_RADIUS / maxCoordRadius

  for (const dist of zoneDistances) {
    const ringRadius = dist * scale
    if (ringRadius > MAP_RADIUS) continue

    // Approximate a ring with 24 small spheres
    const segments = 24
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      const entity = engine.addEntity()
      Transform.create(entity, {
        position: Vector3.create(
          MAP_CENTER.x + Math.cos(angle) * ringRadius,
          MAP_CENTER.y,
          MAP_CENTER.z + Math.sin(angle) * ringRadius
        ),
        scale: Vector3.create(0.03, 0.03, 0.03)
      })
      MeshRenderer.setSphere(entity)
      Material.setPbrMaterial(entity, {
        albedoColor: Color4.create(0, 1, 1, 0.2),
        emissiveColor: Color3.create(0, 0.5, 0.5),
        emissiveIntensity: 1,
        transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
      })
      zoneRingEntities.push(entity)
    }
  }
}

function getStarColor(system: StarSystem, homeSystemId: string | null, currentSystemId: string | null): { color: Color4; emissive: Color3; size: number } {
  if (system.id === currentSystemId) {
    return { color: Color4.create(0, 1, 0.5, 1), emissive: Color3.create(0, 1, 0.5), size: 0.15 }
  }
  if (system.id === homeSystemId) {
    return { color: Color4.create(1, 0.4, 1, 1), emissive: Color3.create(1, 0.4, 1), size: 0.12 }
  }
  if (system.has_station) {
    return { color: Color4.create(0, 1, 1, 1), emissive: Color3.create(0, 1, 1), size: 0.08 }
  }
  if (system.has_wormhole) {
    return { color: Color4.create(0.6, 0.2, 1, 1), emissive: Color3.create(0.6, 0.2, 1), size: 0.07 }
  }
  return { color: Color4.create(1, 1, 1, 1), emissive: Color3.create(0.8, 0.8, 0.8), size: 0.05 }
}

export function renderStarSystems(
  systems: StarSystem[],
  homeSystemId: string | null,
  currentSystemId: string | null
): void {
  // Calculate max radius for scaling
  let maxRadius = 1
  for (const sys of systems) {
    const dist = Math.sqrt(sys.coord_x ** 2 + sys.coord_y ** 2 + sys.coord_z ** 2)
    if (dist > maxRadius) maxRadius = dist
  }

  const scale = MAP_RADIUS / maxRadius

  // Create zone rings based on actual coordinate scale
  createZoneRings(maxRadius)

  // Create star entities
  for (const system of systems) {
    const { color, emissive, size } = getStarColor(system, homeSystemId, currentSystemId)

    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(
        MAP_CENTER.x + system.coord_x * scale,
        MAP_CENTER.y + system.coord_z * scale,
        MAP_CENTER.z + system.coord_y * scale
      ),
      scale: Vector3.create(size, size, size)
    })
    MeshRenderer.setSphere(entity)
    MeshCollider.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: color,
      emissiveColor: emissive,
      emissiveIntensity: 3
    })

    starEntities.set(entity, system)
  }
}

export function clearMap(): void {
  for (const [entity] of starEntities) {
    engine.removeEntity(entity)
  }
  starEntities.clear()
  for (const entity of zoneRingEntities) {
    engine.removeEntity(entity)
  }
  zoneRingEntities.length = 0
}
```

- [ ] **Step 2: Commit**

```bash
git add src/galaxyMap.ts
git commit -m "feat: add galaxy map renderer with projector base and star entities"
```

---

## Task 6: Interaction System

**Files:**
- Create: `src/interaction.ts`

- [ ] **Step 1: Implement interaction system**

```typescript
// src/interaction.ts
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode, InputAction, pointerEventsSystem } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3 } from '@dcl/sdk/math'
import { starEntities } from './galaxyMap'
import { StarSystem } from './types'

let selectedSystem: StarSystem | null = null
let selectionRingEntities: Entity[] = []
let onSelectionChange: ((system: StarSystem | null) => void) | null = null

export function getSelectedSystem(): StarSystem | null {
  return selectedSystem
}

export function setSelectionCallback(callback: (system: StarSystem | null) => void): void {
  onSelectionChange = callback
}

function createSelectionRing(position: Vector3): void {
  clearSelectionRing()

  // Ring made of 16 small spheres
  const ringRadius = 0.25
  const segments = 16
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    const entity = engine.addEntity()
    Transform.create(entity, {
      position: Vector3.create(
        position.x + Math.cos(angle) * ringRadius,
        position.y,
        position.z + Math.sin(angle) * ringRadius
      ),
      scale: Vector3.create(0.025, 0.025, 0.025)
    })
    MeshRenderer.setSphere(entity)
    Material.setPbrMaterial(entity, {
      albedoColor: Color4.create(1, 1, 0, 1),
      emissiveColor: Color3.create(1, 1, 0),
      emissiveIntensity: 5
    })
    selectionRingEntities.push(entity)
  }
}

function clearSelectionRing(): void {
  for (const entity of selectionRingEntities) {
    engine.removeEntity(entity)
  }
  selectionRingEntities = []
}

export function selectSystem(system: StarSystem | null, entity?: Entity): void {
  selectedSystem = system

  if (system && entity) {
    const transform = Transform.get(entity)
    createSelectionRing(transform.position)
  } else {
    clearSelectionRing()
  }

  if (onSelectionChange) {
    onSelectionChange(system)
  }
}

export function setupInteraction(): void {
  for (const [entity, system] of starEntities) {
    pointerEventsSystem.onPointerDown(
      {
        entity,
        opts: {
          button: InputAction.IA_POINTER,
          hoverText: system.name,
          maxDistance: 20
        }
      },
      () => {
        selectSystem(system, entity)
      }
    )
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/interaction.ts
git commit -m "feat: add pointer-based star selection with visual ring"
```

---

## Task 7: Navigation System

**Files:**
- Create: `src/navigation.ts`

- [ ] **Step 1: Implement navigation system**

```typescript
// src/navigation.ts
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import * as api from './api'
import { TravelStatus } from './types'
import { starEntities } from './galaxyMap'

let routeLineEntities: Entity[] = []
let travelMarkerEntity: Entity | null = null
let isTraveling = false
let travelStartTime = 0
let travelEndTime = 0
let originPosition: Vector3 | null = null
let destinationPosition: Vector3 | null = null

export function isCurrentlyTraveling(): boolean {
  return isTraveling
}

export function drawRouteLine(fromPos: Vector3, toPos: Vector3): void {
  clearRouteLines()

  // Calculate midpoint, length, and rotation
  const midpoint = Vector3.create(
    (fromPos.x + toPos.x) / 2,
    (fromPos.y + toPos.y) / 2,
    (fromPos.z + toPos.z) / 2
  )

  const dx = toPos.x - fromPos.x
  const dy = toPos.y - fromPos.y
  const dz = toPos.z - fromPos.z
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz)

  // Create a thin cylinder as route line
  const entity = engine.addEntity()

  // Calculate rotation to point from origin to destination
  const direction = Vector3.normalize(Vector3.create(dx, dy, dz))
  const up = Vector3.create(0, 1, 0)
  const rotation = Quaternion.fromLookAt(fromPos, toPos)

  Transform.create(entity, {
    position: midpoint,
    scale: Vector3.create(0.015, length / 2, 0.015),
    rotation: Quaternion.multiply(rotation, Quaternion.fromEulerDegrees(90, 0, 0))
  })
  MeshRenderer.setCylinder(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(0, 1, 1, 0.4),
    emissiveColor: Color3.create(0, 0.8, 0.8),
    emissiveIntensity: 2,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND
  })

  routeLineEntities.push(entity)
}

export function clearRouteLines(): void {
  for (const entity of routeLineEntities) {
    engine.removeEntity(entity)
  }
  routeLineEntities = []
}

function createTravelMarker(position: Vector3): void {
  if (travelMarkerEntity) {
    engine.removeEntity(travelMarkerEntity)
  }

  travelMarkerEntity = engine.addEntity()
  Transform.create(travelMarkerEntity, {
    position,
    scale: Vector3.create(0.18, 0.18, 0.18)
  })
  MeshRenderer.setSphere(travelMarkerEntity)
  Material.setPbrMaterial(travelMarkerEntity, {
    albedoColor: Color4.create(0, 1, 0.5, 1),
    emissiveColor: Color3.create(0, 1, 0.5),
    emissiveIntensity: 5
  })
}

export async function startTravel(destinationId: string): Promise<void> {
  await api.travel(destinationId)
  await updateTravelState()
}

export async function updateTravelState(): Promise<void> {
  const status = await api.getTravelStatus()

  if (!status.is_traveling) {
    isTraveling = false
    if (travelMarkerEntity) {
      engine.removeEntity(travelMarkerEntity)
      travelMarkerEntity = null
    }
    clearRouteLines()
    return
  }

  isTraveling = true
  travelStartTime = new Date(status.departure_time!).getTime()
  travelEndTime = new Date(status.arrival_time!).getTime()

  // Find positions of origin and destination in the map
  for (const [entity, system] of starEntities) {
    if (system.id === status.origin_system_id) {
      originPosition = Transform.get(entity).position
    }
    if (system.id === status.destination_system_id) {
      destinationPosition = Transform.get(entity).position
    }
  }

  if (originPosition && destinationPosition) {
    drawRouteLine(originPosition, destinationPosition)
    createTravelMarker(originPosition)
  }
}

export async function checkArrival(): Promise<boolean> {
  if (!isTraveling) return false

  const now = Date.now()
  if (now >= travelEndTime) {
    try {
      await api.arrive()
      isTraveling = false
      if (travelMarkerEntity) {
        engine.removeEntity(travelMarkerEntity)
        travelMarkerEntity = null
      }
      clearRouteLines()
      return true
    } catch {
      return false
    }
  }
  return false
}

// System that updates travel marker position each frame
export function travelUpdateSystem(dt: number): void {
  if (!isTraveling || !travelMarkerEntity || !originPosition || !destinationPosition) return

  const now = Date.now()
  const totalDuration = travelEndTime - travelStartTime
  const elapsed = now - travelStartTime
  const progress = Math.min(elapsed / totalDuration, 1.0)

  const pos = Vector3.create(
    originPosition.x + (destinationPosition.x - originPosition.x) * progress,
    originPosition.y + (destinationPosition.y - originPosition.y) * progress,
    originPosition.z + (destinationPosition.z - originPosition.z) * progress
  )

  Transform.createOrReplace(travelMarkerEntity, {
    position: pos,
    scale: Vector3.create(0.18, 0.18, 0.18)
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/navigation.ts
git commit -m "feat: add navigation system with travel and route rendering"
```

---

## Task 8: UI Panels

**Files:**
- Modify: `src/ui.tsx`

- [ ] **Step 1: Implement React UI panels**

```typescript
// src/ui.tsx
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { StarSystem, FuelCostResponse } from './types'

// UI State
let selectedSystem: StarSystem | null = null
let fuelInfo: FuelCostResponse | null = null
let travelingTo: string | null = null
let statusMessage: string | null = null
let onTravelConfirm: (() => void) | null = null
let showTravelConfirm = false

export function setSelectedSystemUI(system: StarSystem | null, fuel: FuelCostResponse | null): void {
  selectedSystem = system
  fuelInfo = fuel
  showTravelConfirm = false
}

export function setTravelingStatus(systemName: string | null): void {
  travelingTo = systemName
}

export function setStatusMessage(msg: string | null): void {
  statusMessage = msg
}

export function setTravelConfirmCallback(callback: () => void): void {
  onTravelConfirm = callback
}

export function showTravelConfirmation(): void {
  showTravelConfirm = true
}

const SystemInfoPanel = () => {
  if (!selectedSystem) return null

  return (
    <UiEntity
      uiTransform={{
        width: 320,
        height: 'auto',
        positionType: 'absolute',
        position: { right: 20, top: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.9) }}
    >
      <UiEntity uiTransform={{ padding: 16, flexDirection: 'column' }}>
        {/* System Name */}
        <UiEntity
          uiTransform={{ margin: { bottom: 8 } }}
          uiText={{ value: selectedSystem.name, fontSize: 20, color: Color4.create(0, 1, 1, 1) }}
        />

        {/* Star Type */}
        <UiEntity
          uiTransform={{ margin: { bottom: 4 } }}
          uiText={{
            value: `Star: ${selectedSystem.star_type || 'Unknown'}`,
            fontSize: 14,
            color: Color4.create(0.7, 0.7, 0.7, 1)
          }}
        />

        {/* Station */}
        {selectedSystem.has_station && (
          <UiEntity
            uiTransform={{ margin: { bottom: 4 } }}
            uiText={{ value: '⬡ Has Station', fontSize: 14, color: Color4.create(0, 1, 1, 1) }}
          />
        )}

        {/* Wormhole */}
        {selectedSystem.has_wormhole && (
          <UiEntity
            uiTransform={{ margin: { bottom: 4 } }}
            uiText={{ value: '◉ Has Wormhole', fontSize: 14, color: Color4.create(0.6, 0.2, 1, 1) }}
          />
        )}

        {/* Fuel Cost */}
        {fuelInfo && (
          <UiEntity uiTransform={{ margin: { top: 8 }, flexDirection: 'column' }}>
            <UiEntity
              uiText={{
                value: `Distance: ${fuelInfo.distance.toFixed(1)} | Fuel: ${fuelInfo.fuel_cost.toFixed(1)}`,
                fontSize: 13,
                color: Color4.create(0.8, 0.8, 0.8, 1)
              }}
            />
            <UiEntity
              uiText={{
                value: `Current fuel: ${fuelInfo.current_fuel.toFixed(1)}`,
                fontSize: 13,
                color: fuelInfo.current_fuel >= fuelInfo.fuel_cost
                  ? Color4.create(0, 1, 0.5, 1)
                  : Color4.create(1, 0.3, 0.3, 1)
              }}
            />
          </UiEntity>
        )}

        {/* Travel Button */}
        {fuelInfo && !showTravelConfirm && (
          <UiEntity
            uiTransform={{ margin: { top: 12 }, width: '100%', height: 36, alignItems: 'center', justifyContent: 'center' }}
            uiBackground={{ color: Color4.create(0, 0.4, 0.5, 1) }}
            uiText={{ value: 'TRAVEL', fontSize: 16, color: Color4.White() }}
            onMouseDown={() => { showTravelConfirm = true }}
          />
        )}

        {/* Confirm Dialog */}
        {showTravelConfirm && (
          <UiEntity uiTransform={{ margin: { top: 12 }, flexDirection: 'column' }}>
            <UiEntity
              uiText={{
                value: `Travel to ${selectedSystem.name}?`,
                fontSize: 14,
                color: Color4.create(1, 1, 0, 1)
              }}
            />
            <UiEntity uiTransform={{ flexDirection: 'row', margin: { top: 8 } }}>
              <UiEntity
                uiTransform={{ width: 100, height: 32, margin: { right: 8 }, alignItems: 'center', justifyContent: 'center' }}
                uiBackground={{ color: Color4.create(0, 0.6, 0.3, 1) }}
                uiText={{ value: 'CONFIRM', fontSize: 14, color: Color4.White() }}
                onMouseDown={() => { if (onTravelConfirm) onTravelConfirm() }}
              />
              <UiEntity
                uiTransform={{ width: 100, height: 32, alignItems: 'center', justifyContent: 'center' }}
                uiBackground={{ color: Color4.create(0.4, 0.1, 0.1, 1) }}
                uiText={{ value: 'CANCEL', fontSize: 14, color: Color4.White() }}
                onMouseDown={() => { showTravelConfirm = false }}
              />
            </UiEntity>
          </UiEntity>
        )}
      </UiEntity>
    </UiEntity>
  )
}

const TravelStatusPanel = () => {
  if (!travelingTo) return null

  return (
    <UiEntity
      uiTransform={{
        width: 280,
        height: 'auto',
        positionType: 'absolute',
        position: { right: 20, bottom: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.9) }}
    >
      <UiEntity uiTransform={{ padding: 12 }}>
        <UiEntity
          uiText={{
            value: `Traveling to ${travelingTo}...`,
            fontSize: 14,
            color: Color4.create(0, 1, 0.5, 1)
          }}
        />
      </UiEntity>
    </UiEntity>
  )
}

const StatusBar = () => {
  if (!statusMessage) return null

  return (
    <UiEntity
      uiTransform={{
        width: 400,
        height: 'auto',
        positionType: 'absolute',
        position: { left: '50%', top: 20 }
      }}
      uiBackground={{ color: Color4.create(0.02, 0.02, 0.08, 0.8) }}
    >
      <UiEntity uiTransform={{ padding: 8 }}>
        <UiEntity
          uiText={{ value: statusMessage, fontSize: 14, color: Color4.create(0.8, 0.8, 0.8, 1) }}
        />
      </UiEntity>
    </UiEntity>
  )
}

const uiComponent = () => (
  <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
    <SystemInfoPanel />
    <TravelStatusPanel />
    <StatusBar />
  </UiEntity>
)

export function setupUi(): void {
  ReactEcsRenderer.setUiRenderer(uiComponent)
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ui.tsx
git commit -m "feat: add React UI panels for system info and travel controls"
```

---

## Task 9: Main Entry Point — Wire Everything Together

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Implement the main orchestration**

```typescript
// src/index.ts
import { engine } from '@dcl/sdk/ecs'
import { authenticate } from './auth'
import * as api from './api'
import { createProjectorBase, renderStarSystems, clearMap, starEntities } from './galaxyMap'
import { setupInteraction, setSelectionCallback, getSelectedSystem } from './interaction'
import { startTravel, updateTravelState, checkArrival, travelUpdateSystem, isCurrentlyTraveling, drawRouteLine } from './navigation'
import { setupUi, setSelectedSystemUI, setTravelingStatus, setStatusMessage, setTravelConfirmCallback } from './ui'
import { StarSystem, PlayerInfo } from './types'
import { Transform } from '@dcl/sdk/ecs'

let playerInfo: PlayerInfo | null = null
let systems: StarSystem[] = []
let arrivalCheckTimer = 0

export async function main() {
  // Set up UI immediately
  setupUi()
  setStatusMessage('Connecting...')

  // Create the projector base (visible while loading)
  createProjectorBase()

  try {
    // Authenticate
    setStatusMessage('Authenticating...')
    const { isNewPlayer } = await authenticate()

    if (isNewPlayer) {
      // Join first available galaxy
      setStatusMessage('Finding galaxy...')
      const galaxies = await api.getAvailableGalaxies()
      if (galaxies.length === 0) {
        setStatusMessage('No galaxies available')
        return
      }

      // Use wallet address as username for now
      const { getPlayerData } = await import('~system/Players')
      const userData = await getPlayerData({})
      const username = userData.data?.displayName || 'Explorer'

      await api.joinGalaxy(galaxies[0].id, username)
    }

    // Get player info
    setStatusMessage('Loading player data...')
    playerInfo = await api.getPlayerMe()

    // Fetch star systems
    setStatusMessage('Loading galaxy map...')
    systems = await api.getSystems(playerInfo.galaxy_id)

    // Render the map
    renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)

    // Set up pointer interactions on star entities
    setupInteraction()

    // Handle selection changes
    setSelectionCallback(async (system: StarSystem | null) => {
      if (!system) {
        setSelectedSystemUI(null, null)
        return
      }

      // Draw route line from current system to selected
      if (playerInfo?.current_system_id) {
        for (const [entity, sys] of starEntities) {
          if (sys.id === playerInfo.current_system_id) {
            const fromPos = Transform.get(entity).position
            for (const [destEntity, destSys] of starEntities) {
              if (destSys.id === system.id) {
                const toPos = Transform.get(destEntity).position
                drawRouteLine(fromPos, toPos)
                break
              }
            }
            break
          }
        }
      }

      // Fetch fuel cost (uses current system → selected system distance)
      try {
        const fuelInfo = await api.getFuelCost(system.id)
        setSelectedSystemUI(system, fuelInfo)
      } catch {
        setSelectedSystemUI(system, null)
      }

      // Highlight nearest systems from selected (visual feedback)
      // Future enhancement: render connecting lines to N nearest systems
    })

    // Handle travel confirmation
    setTravelConfirmCallback(async () => {
      const selected = getSelectedSystem()
      if (!selected) return

      try {
        setStatusMessage('Initiating travel...')
        await startTravel(selected.id)
        setTravelingStatus(selected.name)
        setSelectedSystemUI(null, null)
        setStatusMessage(null)
      } catch (err: any) {
        setStatusMessage(`Travel failed: ${err.message}`)
        setTimeout(() => setStatusMessage(null), 3000)
      }
    })

    // Check if already traveling
    await updateTravelState()
    if (isCurrentlyTraveling()) {
      const status = await api.getTravelStatus()
      const destSystem = systems.find(s => s.id === status.destination_system_id)
      if (destSystem) {
        setTravelingStatus(destSystem.name)
      }
    }

    setStatusMessage(null)
  } catch (err: any) {
    setStatusMessage(`Error: ${err.message}`)
    console.error('Galaxy Gardeners init error:', err)
  }

  // Register travel update system (runs every frame)
  engine.addSystem(travelUpdateSystem)

  // Register arrival check system (polls every 5 seconds)
  engine.addSystem((dt: number) => {
    arrivalCheckTimer += dt
    if (arrivalCheckTimer >= 5) {
      arrivalCheckTimer = 0
      if (isCurrentlyTraveling()) {
        checkArrival().then(arrived => {
          if (arrived) {
            setTravelingStatus(null)
            setStatusMessage('Arrived!')
            // Reload map with updated current system
            reloadMap()
            setTimeout(() => setStatusMessage(null), 3000)
          }
        })
      }
    }
  })
}

async function reloadMap(): Promise<void> {
  clearMap()
  playerInfo = await api.getPlayerMe()
  systems = await api.getSystems(playerInfo.galaxy_id)
  renderStarSystems(systems, playerInfo.home_system_id, playerInfo.current_system_id)
  setupInteraction()
}
```

- [ ] **Step 2: Verify build**

```bash
cd ~/Git/galaxy-gardeners-dcl
npm run build
```

Fix any TypeScript errors that arise.

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire up auth, galaxy map, interaction, navigation, and UI"
```

---

## Task 10: Scene Configuration

**Files:**
- Modify: `scene.json`

- [ ] **Step 1: Update scene.json for dedicated world**

Update the scene metadata to reflect Galaxy Gardeners and expand parcels:

```json
{
  "ecs7": true,
  "runtimeVersion": "7",
  "display": {
    "title": "Galaxy Gardeners",
    "description": "Explore the galaxy, mine asteroids, and discover alien flora",
    "favicon": "favicon_asset",
    "navmapThumbnail": ""
  },
  "owner": "",
  "contact": {
    "name": "Galaxy Gardeners",
    "email": ""
  },
  "main": "bin/index.js",
  "tags": ["space", "exploration", "galaxy"],
  "scene": {
    "parcels": [
      "0,0", "0,1", "1,0", "1,1"
    ],
    "base": "0,0"
  },
  "spawnPoints": [
    {
      "name": "Bridge",
      "default": true,
      "position": {
        "x": [7, 9],
        "y": [0, 0],
        "z": [14, 15]
      },
      "cameraTarget": {
        "x": 8,
        "y": 4,
        "z": 8
      }
    }
  ],
  "requiredPermissions": [
    "ALLOW_TO_TRIGGER_AVATAR_EMOTE",
    "ALLOW_TO_MOVE_PLAYER_INSIDE_SCENE",
    "ALLOW_MEDIA_HOSTNAMES"
  ],
  "allowedMediaHostnames": [
    "staging.galaxygardeners.app"
  ],
  "featureToggles": {
    "voiceChat": "enabled",
    "portableExperiences": "enabled",
    "nearbyVoiceChat": "enabled"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add scene.json
git commit -m "feat: update scene config for Galaxy Gardeners dedicated world"
```

---

## Task 11: Build & Smoke Test

- [ ] **Step 1: Install any missing dependencies and build**

```bash
cd ~/Git/galaxy-gardeners-dcl
npm install
npm run build
```

- [ ] **Step 2: Fix any build errors**

Address TypeScript errors iteratively until `npm run build` succeeds.

- [ ] **Step 3: Run the scene locally**

```bash
npm run start
```

Verify in browser:
- Projector base renders at center of scene
- Stars appear as glowing spheres above projector (will need API running)
- Clicking a star shows the info panel
- No console errors

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve build issues and verify scene runs"
```
