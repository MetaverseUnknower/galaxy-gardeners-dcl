# Galaxy Gardeners DCL — Holographic Galaxy Map

## Overview

A Decentraland scene that renders an interactive 3D galaxy map as a holographic projection. Players authenticate via their Web3 wallet, view all star systems in their galaxy, select systems to see details, and initiate travel — all within a dedicated Decentraland world.

## Scene Layout

- **Projector base:** A cylindrical primitive (~3m diameter, ~0.3m tall) on the floor with emissive cyan material, acting as the hologram source.
- **Galaxy hologram:** Star system entities floating in a ~6m radius sphere, centered ~4m above the projector base (so the center of the galaxy is at eye level when standing nearby).
- **Zone rings:** Translucent cyan torus primitives at distance intervals (matching the iOS app's 100, 300, 600, 900 unit zones, scaled proportionally).
- **Environment:** Dark skybox/ambient to make emissive materials pop. The scene is deployed to a dedicated world with no parcel constraints.

## Architecture

### Source Files (DCL Scene)

| File | Responsibility |
|------|----------------|
| `src/auth.ts` | Get wallet address + display name from DCL SDK, call `POST /api/auth/dcl`, store session token |
| `src/api.ts` | HTTP client wrapping galaxy-gardeners-server endpoints, attaches auth token to requests |
| `src/galaxyMap.ts` | Fetches systems via API, creates sphere entities with emissive materials, positions them in 3D space above projector, creates zone rings and projector base |
| `src/interaction.ts` | Pointer events on star entities, selection state, hover highlights, selection ring (yellow torus) |
| `src/navigation.ts` | Travel initiation (POST /api/ships/travel), fuel cost display, route line rendering (thin cylinders between systems), travel progress interpolation, arrival detection |
| `src/ui.tsx` | React-based DCL UI panels: system info panel (name, type, distance, fuel cost, station/wormhole status), travel confirmation dialog, travel status indicator |
| `src/index.ts` | Entry point — orchestrates auth → fetch → render → interaction setup |

### Server Changes (galaxy-gardeners-server)

One new endpoint:

**`POST /api/auth/dcl`**
- Request body: `{ walletAddress: string, displayName: string }`
- Logic:
  1. Look up existing user by wallet address in a `dcl_users` table (or metadata field on existing users table)
  2. If not found, create a new Supabase auth user with the wallet address as identifier
  3. If found, retrieve existing user
  4. Generate and return a session token
- Response: `{ token: string, playerId: string, isNewPlayer: boolean }`
- If `isNewPlayer: true`, the DCL client will need to call `POST /api/galaxy/:id/join` to create a player in a galaxy

## Visual Design

### Star Rendering

| Element | Shape | Size | Material |
|---------|-------|------|----------|
| Current system | Sphere | 0.15m radius | Green emissive |
| Home system | Sphere | 0.12m radius | Magenta emissive |
| Station systems | Sphere | 0.08m radius | Cyan emissive |
| Regular systems | Sphere | 0.05m radius | White emissive |
| Selected system | Torus | 0.3m outer radius | Yellow emissive |
| Distress beacon | Torus | 0.25m outer radius | Red emissive, pulsing (scale animation) |
| Wormhole | Torus | 0.15m outer radius | Purple emissive |
| Zone rings | Torus | Proportional to zone distance | Cyan, alpha 0.15 |
| Route lines | Cylinder | 0.01m radius, length=distance | Cyan emissive, alpha 0.5 |
| Projector base | Cylinder | 1.5m radius, 0.3m height | Dark metal with cyan emissive trim |

### Hologram Aesthetic

- All star/route/ring materials use emissive properties (self-lit, no external lighting needed)
- Color palette: cyan (#00FFFF), magenta (#FF66FF), green (#00FF88), white, yellow, purple
- Dark scene ambient so emissive elements glow against black
- Projector base has a subtle upward "beam" effect (tall thin cylinder with very low alpha cyan)

## Coordinate Mapping

Server coordinates use Cartesian (coordX, coordY, coordZ) with values ranging up to ~900 units. To fit within a 6m radius hologram:

```
maxRadius = max distance of any system from origin across all axes
scale = 6.0 / maxRadius

DCL position:
  x = system.coordX * scale + projectorCenter.x
  y = system.coordZ * scale + projectorCenter.y   // server Z → DCL Y (up)
  z = system.coordY * scale + projectorCenter.z   // server Y → DCL Z (depth)
```

The projector center is positioned at `(8, 4, 8)` — center of scene, 4m up.

## Interaction Flow

1. **Scene loads** → `auth.ts` retrieves wallet address via `getUserData()` from `@dcl/sdk/identity` → calls `POST /api/auth/dcl` → stores token
2. **If new player** → calls `GET /api/galaxy/available` to get the least-populated galaxy, then `POST /api/galaxy/:id/join` to create the player there
3. **Fetch systems** → `GET /api/systems/:galaxyId` → `galaxyMap.ts` creates all entities
4. **Player looks at star** → pointer enter event → subtle scale-up on hover
5. **Player clicks star** → `interaction.ts` sets selection state → spawns yellow torus around star → `ui.tsx` shows info panel
6. **Info panel shows:** system name, star type, distance from current system, fuel cost (from `GET /api/ships/fuel-cost`), has station, has wormhole, discovered by
7. **Travel button** → confirmation with fuel cost → `POST /api/ships/travel` → panel shows "Traveling..." with ETA
8. **During travel** → green "current position" marker interpolates between origin and destination using travel progress
9. **On arrival** → `POST /api/ships/arrive` (polled or timer-based) → current system updates → map re-renders current position

## Data Flow

```
DCL SDK (wallet) → POST /api/auth/dcl → token
token → GET /api/galaxy/player/me → player info (galaxy_id, home_system_id, current_system_id)
galaxy_id → GET /api/systems/:galaxyId → [StarSystem] → render map
selection → GET /api/ships/fuel-cost?destination=X → display cost
travel → POST /api/ships/travel → travel initiated
polling → GET /api/ships/travel-status → progress updates
arrival → POST /api/ships/arrive → update current_system_id
```

## Authentication Details

The DCL endpoint trusts that if we can read a wallet address from the Decentraland SDK's `getUserData()`, the user is already authenticated by Decentraland's infrastructure. No signature required.

The server stores a mapping between wallet addresses and internal user IDs. On first connection, it creates a new user. On subsequent connections, it returns the existing user's token.

## Scope Boundaries

**In scope for v1:**
- Holographic projector + galaxy map rendering
- Wallet-based auth (new server endpoint)
- System selection with info panel
- Travel initiation and arrival
- Route visualization (line from current to selected)
- Nearest systems display
- Wormhole indicators
- Zone rings

**Out of scope for v1:**
- Ship 3D model
- System detail view (planets, asteroid belts)
- Station docking / chat
- Mining / expeditions
- iOS account linking
- Sound effects
- Procedural nebula background (the iOS spiral arms effect)
