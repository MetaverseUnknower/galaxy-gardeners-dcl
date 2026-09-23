# Landing Pad Booth Scene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone 1x2 Decentraland scene where the DaisyClass ship hovers over a landing pad and FERN, an AI concierge NPC wearing the user's 1/1 skin, registers players against the Galaxy Gardeners staging API and sends them to the main world.

**Architecture:** New sibling SDK7 project at `~/Git/galaxy-gardeners-landing` with a trimmed copy of the main scene's auth/api layer. FERN is an `AvatarShape` entity (clickable via an invisible child collider) using `dcl-npc-toolkit` dialogue UI. Registration is a soft gate: any API failure degrades to a "board anyway" path; travel uses `changeRealm` (world) or `teleportTo` (future Genesis coords), driven by config.

**Tech Stack:** Decentraland SDK7 (`@dcl/sdk`), `dcl-npc-toolkit`, TypeScript, ReactEcs UI.

**Spec:** `~/Git/galaxy-gardeners-dcl/docs/superpowers/specs/2026-07-06-landing-pad-scene-design.md`

## Global Constraints

- Scene footprint: 2 parcels (`0,0` + `0,1`) = 16m (x) × 32m (z); height limit ≈ 31.7m.
- Triangle budget: WAIVED by user decision (2026-07-13) — Genesis limits are not enforced in practice; the original 36,331-triangle ship GLB is used as-is. Do not flag triangle counts as an issue.
- Source repo (read-only reference & asset source): `/Users/unknower/Git/galaxy-gardeners-dcl`. New project: `/Users/unknower/Git/galaxy-gardeners-landing`.
- Prettier style from main repo: no semicolons, single quotes, print width 120 (`package.json` carries the config).
- Console log prefixes: `[auth]`, `[api]`, `[fern]` matching the main scene's `[api]` style.
- **Testing model:** DCL scenes have no unit-test infra. Every task's verification is `npm run build` (TypeScript compile via sdk-commands) plus manual preview checkpoints (`npm run start`) at Tasks 4, 6, and 7. Do not invent a test framework.
- Design note (refinement over spec wording): the branch new-vs-returning uses `hasPlayer` returned by `authenticate()` — identical semantics to the main scene's `src/index.ts:34-44` — instead of a separate `getPlayerMe()` call. `api.ts` therefore only needs `getAvailableGalaxies` and `joinGalaxy`.
- Two config values are intentionally user-supplied later and ship as documented placeholders in `config.ts` ONLY (never anywhere else): the main world name (`WORLD_NAME_TBD.dcl.eth`) and the FERN skin URN (`null` until provided).

---

### Task 1: Scaffold the project

**Files:**
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/package.json`
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/scene.json`
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/index.ts` (minimal, replaced in Task 7)
- Copy: `tsconfig.json`, `.gitignore`, `.dclignore` from the main repo; `assets/models/DaisyClass_Exterior.glb`

**Interfaces:**
- Produces: a building SDK7 project skeleton; `main()` export in `src/index.ts`; the ship GLB at `assets/models/DaisyClass_Exterior.glb`.

- [ ] **Step 1: Create folder structure and copy known-good config files from the main repo**

```bash
mkdir -p /Users/unknower/Git/galaxy-gardeners-landing/src /Users/unknower/Git/galaxy-gardeners-landing/assets/models
cd /Users/unknower/Git/galaxy-gardeners-landing
cp /Users/unknower/Git/galaxy-gardeners-dcl/tsconfig.json .
cp /Users/unknower/Git/galaxy-gardeners-dcl/.gitignore .
cp /Users/unknower/Git/galaxy-gardeners-dcl/.dclignore .
cp /Users/unknower/Git/galaxy-gardeners-dcl/assets/models/DaisyClass_Exterior.glb assets/models/
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "galaxy-gardeners-landing",
  "version": "1.0.0",
  "description": "Genesis City departure terminal for Galaxy Gardeners",
  "scripts": {
    "start": "sdk-commands start",
    "deploy": "sdk-commands deploy",
    "build": "sdk-commands build",
    "upgrade-sdk": "npm install --save-dev @dcl/sdk@latest"
  },
  "devDependencies": {
    "@dcl/js-runtime": "7.22.5",
    "@dcl/sdk": "latest"
  },
  "dependencies": {
    "dcl-npc-toolkit": "^1.3.0"
  },
  "engines": {
    "node": ">=16.0.0",
    "npm": ">=6.0.0"
  },
  "prettier": {
    "semi": false,
    "singleQuote": true,
    "printWidth": 120,
    "trailingComma": "none"
  }
}
```

- [ ] **Step 3: Write `scene.json`**

Parcels are placeholders until the real LAND coordinates are known (deploy-time edit, called out in spec).

```json
{
  "ecs7": true,
  "runtimeVersion": "7",
  "display": {
    "title": "Galaxy Gardeners — Departure Terminal",
    "description": "Register with FERN and board your DaisyClass vessel"
  },
  "main": "bin/index.js",
  "tags": ["space", "galaxy", "exploration"],
  "scene": {
    "parcels": ["0,0", "0,1"],
    "base": "0,0"
  },
  "spawnPoints": [
    {
      "name": "entrance",
      "default": true,
      "position": { "x": [6, 10], "y": [0, 0], "z": [1, 3] },
      "cameraTarget": { "x": 8, "y": 3, "z": 20 }
    }
  ],
  "requiredPermissions": ["USE_FETCH"],
  "featureToggles": {}
}
```

Note: `changeRealm`/`teleportTo` need no scene permission (the client shows the player a confirmation prompt). `USE_FETCH` covers `signedFetch` on deployed scenes; the main scene omits it because it hasn't deployed yet — include it here.

- [ ] **Step 4: Write minimal `src/index.ts`**

```typescript
export function main() {
  console.log('[scene] departure terminal booting')
}
```

- [ ] **Step 5: Install and build**

```bash
cd /Users/unknower/Git/galaxy-gardeners-landing
npm install
npm run build
```

Expected: install succeeds (dcl-npc-toolkit resolves; if `^1.3.0` has no match, run `npm install dcl-npc-toolkit@latest --save` and continue), build exits 0 producing `bin/index.js`.

- [ ] **Step 6: Check the ship GLB's triangle count against the 20k scene budget**

```bash
npx @gltf-transform/cli inspect assets/models/DaisyClass_Exterior.glb
```

Read the mesh/primitive table for total triangles. **If total > 18,000: STOP and report to the user that the ship needs a decimated export (state the count and the 18k target); do not continue to Task 2.** Otherwise record the count in the commit message.

- [ ] **Step 7: Init git and commit**

```bash
cd /Users/unknower/Git/galaxy-gardeners-landing
git init && git add -A && git commit -m "chore: scaffold departure terminal scene (SDK7 + dcl-npc-toolkit)"
```

---

### Task 2: Config module

**Files:**
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/config.ts`

**Interfaces:**
- Produces: `API_BASE: string`, `FERN_SKIN_URN: string | null`, `FERN_BODY_SHAPE: string`, `Destination` type, `MAIN_WORLD_DESTINATION: Destination`, layout constants `PAD_CENTER`, `SHIP_HOVER_HEIGHT`, `SHIP_SCALE`, `BOOTH_POSITION`.

- [ ] **Step 1: Write `src/config.ts`**

```typescript
import { Vector3 } from '@dcl/sdk/math'

// Same staging API the main scene talks to (src/api.ts in galaxy-gardeners-dcl)
export const API_BASE = 'http://localhost:3000'

// The user's 1-of-1 skin wearable URN. Rendered on FERN without ownership checks.
// Format: urn:decentraland:matic:collections-v2:0x<collection-contract>:<item-number>
// null = FERN falls back to a default avatar look until the URN is supplied.
export const FERN_SKIN_URN: string | null = null

export const FERN_BODY_SHAPE = 'urn:decentraland:off-chain:base-avatars:BaseFemale'

export type Destination = { mode: 'world'; worldName: string } | { mode: 'genesis'; coords: { x: number; y: number } }

// Where FERN sends players. World name supplied by the user before deploy.
export const MAIN_WORLD_DESTINATION: Destination = {
  mode: 'world',
  worldName: 'WORLD_NAME_TBD.dcl.eth'
}

// Scene layout (1x2 parcels: x 0-16, z 0-32; spawn at south end, pad at north)
export const PAD_CENTER = Vector3.create(8, 0, 22)
export const SHIP_HOVER_HEIGHT = 10
export const SHIP_SCALE = 1
export const BOOTH_POSITION = Vector3.create(8, 0, 7)
```

- [ ] **Step 2: Build**

Run: `npm run build` — Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/config.ts && git commit -m "feat: scene config (API base, destination, skin URN, layout constants)"
```

---

### Task 3: Auth and trimmed API client

**Files:**
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/auth.ts`
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/api.ts`

**Interfaces:**
- Consumes: `API_BASE` from `./config`.
- Produces: `authenticate(): Promise<{ hasPlayer: boolean }>`, `getToken(): string | null`, `getDisplayName(): string` from `auth.ts`; `getAvailableGalaxies(): Promise<{ id: string }[]>`, `joinGalaxy(galaxyId: string, username: string): Promise<{ playerId: string; homeSystemId: string }>` from `api.ts`.

- [ ] **Step 1: Write `src/auth.ts`** (copied from the main scene's `src/auth.ts`, with two changes: `API_BASE` imported from config, and the display name cached and exported so `fern.ts` can greet/register with it)

```typescript
import { getUserData } from '~system/UserIdentity'
import { signedFetch } from '~system/SignedFetch'
import { API_BASE } from './config'

let authToken: string | null = null
let playerDisplayName = 'Explorer'

export function getToken(): string | null {
  return authToken
}

export function getDisplayName(): string {
  return playerDisplayName
}

export async function authenticate(): Promise<{ hasPlayer: boolean }> {
  const response = await getUserData({})
  const userData = response.data

  if (!userData) {
    throw new Error('Could not get player data from Decentraland')
  }

  const walletAddress = userData.publicKey || userData.userId
  playerDisplayName = userData.displayName || 'Explorer'

  const authResponse = await signedFetch({
    url: `${API_BASE}/api/auth/dcl`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ walletAddress, displayName: playerDisplayName })
    }
  })

  if (!authResponse.ok) {
    throw new Error(`Auth failed: ${authResponse.status} ${authResponse.body}`)
  }

  const data = JSON.parse(authResponse.body)
  authToken = data.accessToken

  return { hasPlayer: data.hasPlayer }
}
```

- [ ] **Step 2: Write `src/api.ts`** (the main scene's request plumbing, keeping only the two endpoints the booth needs)

```typescript
import { signedFetch } from '~system/SignedFetch'
import { getToken, authenticate } from './auth'
import { API_BASE } from './config'

async function makeRequest(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string }
): Promise<{ ok: boolean; status: number; body: string }> {
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

export async function getAvailableGalaxies(): Promise<{ id: string }[]> {
  return apiGet<{ id: string }[]>('/api/galaxy/available')
}

export async function joinGalaxy(galaxyId: string, username: string): Promise<{ playerId: string; homeSystemId: string }> {
  return apiPost(`/api/galaxy/${galaxyId}/join`, { username })
}
```

- [ ] **Step 3: Build**

Run: `npm run build` — Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/auth.ts src/api.ts && git commit -m "feat: wallet auth + trimmed API client (galaxies, join)"
```

---

### Task 4: Environment — pad, ship, booth

**Files:**
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/environment.ts`

**Interfaces:**
- Consumes: `PAD_CENTER`, `SHIP_HOVER_HEIGHT`, `SHIP_SCALE`, `BOOTH_POSITION` from `./config`.
- Produces: `setupEnvironment(): void` (creates all static scenery and starts the ship hover system).

- [ ] **Step 1: Write `src/environment.ts`**

```typescript
import { engine, Transform, GltfContainer, MeshRenderer, MeshCollider, Material, TextShape } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { PAD_CENTER, SHIP_HOVER_HEIGHT, SHIP_SCALE, BOOTH_POSITION } from './config'

const PAD_RADIUS = 6

export function setupEnvironment() {
  createGround()
  createLandingPad()
  createShip()
  createBooth()
}

function createGround() {
  const ground = engine.addEntity()
  Transform.create(ground, {
    position: Vector3.create(8, 0.01, 16),
    scale: Vector3.create(16, 32, 1),
    rotation: Quaternion.fromEulerDegrees(90, 0, 0)
  })
  MeshRenderer.setPlane(ground)
  Material.setPbrMaterial(ground, {
    albedoColor: Color4.create(0.05, 0.06, 0.09, 1),
    metallic: 0.2,
    roughness: 0.9
  })
}

function createLandingPad() {
  const pad = engine.addEntity()
  Transform.create(pad, {
    position: Vector3.create(PAD_CENTER.x, 0.15, PAD_CENTER.z),
    scale: Vector3.create(PAD_RADIUS * 2, 0.3, PAD_RADIUS * 2)
  })
  MeshRenderer.setCylinder(pad)
  MeshCollider.setCylinder(pad)
  Material.setPbrMaterial(pad, {
    albedoColor: Color4.create(0.12, 0.13, 0.16, 1),
    metallic: 0.8,
    roughness: 0.35
  })

  // Emissive edge ring, same glow language as the main scene's platform
  const edgeSegments = 32
  for (let i = 0; i < edgeSegments; i++) {
    const angle = (i / edgeSegments) * Math.PI * 2
    const dot = engine.addEntity()
    Transform.create(dot, {
      position: Vector3.create(
        PAD_CENTER.x + Math.cos(angle) * PAD_RADIUS,
        0.33,
        PAD_CENTER.z + Math.sin(angle) * PAD_RADIUS
      ),
      scale: Vector3.create(0.12, 0.04, 0.12)
    })
    MeshRenderer.setSphere(dot)
    Material.setPbrMaterial(dot, {
      albedoColor: Color4.create(0, 0.5, 0.8, 0.8),
      emissiveColor: Color3.create(0, 0.6, 0.9),
      emissiveIntensity: 2
    })
  }
}

function createShip() {
  const ship = engine.addEntity()
  Transform.create(ship, {
    position: Vector3.create(PAD_CENTER.x, SHIP_HOVER_HEIGHT, PAD_CENTER.z),
    scale: Vector3.create(SHIP_SCALE, SHIP_SCALE, SHIP_SCALE)
  })
  GltfContainer.create(ship, { src: 'assets/models/DaisyClass_Exterior.glb' })

  // Station-keeping: gentle bob + slow yaw
  let elapsed = 0
  engine.addSystem((dt: number) => {
    elapsed += dt
    const tf = Transform.getMutable(ship)
    tf.position = Vector3.create(PAD_CENTER.x, SHIP_HOVER_HEIGHT + Math.sin(elapsed * 0.5) * 0.5, PAD_CENTER.z)
    tf.rotation = Quaternion.fromEulerDegrees(0, (elapsed * 3) % 360, 0)
  })
}

function createBooth() {
  // Counter
  const counter = engine.addEntity()
  Transform.create(counter, {
    position: Vector3.create(BOOTH_POSITION.x, 0.55, BOOTH_POSITION.z),
    scale: Vector3.create(2.6, 1.1, 0.9)
  })
  MeshRenderer.setBox(counter)
  MeshCollider.setBox(counter)
  Material.setPbrMaterial(counter, {
    albedoColor: Color4.create(0.1, 0.12, 0.15, 1),
    metallic: 0.7,
    roughness: 0.3
  })

  // Canopy posts
  for (const dx of [-1.2, 1.2]) {
    const post = engine.addEntity()
    Transform.create(post, {
      position: Vector3.create(BOOTH_POSITION.x + dx, 1.5, BOOTH_POSITION.z + 0.8),
      scale: Vector3.create(0.1, 3, 0.1)
    })
    MeshRenderer.setBox(post)
    Material.setPbrMaterial(post, { albedoColor: Color4.create(0.15, 0.17, 0.2, 1), metallic: 0.8, roughness: 0.3 })
  }

  // Canopy
  const canopy = engine.addEntity()
  Transform.create(canopy, {
    position: Vector3.create(BOOTH_POSITION.x, 3.05, BOOTH_POSITION.z + 0.4),
    scale: Vector3.create(3, 0.1, 1.8)
  })
  MeshRenderer.setBox(canopy)
  Material.setPbrMaterial(canopy, {
    albedoColor: Color4.create(0.1, 0.12, 0.15, 1),
    emissiveColor: Color3.create(0, 0.3, 0.45),
    emissiveIntensity: 0.5,
    metallic: 0.7,
    roughness: 0.3
  })

  // Holographic signage
  const sign = engine.addEntity()
  Transform.create(sign, {
    position: Vector3.create(BOOTH_POSITION.x, 3.6, BOOTH_POSITION.z + 0.4),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0)
  })
  TextShape.create(sign, {
    text: 'DAISY-CLASS EXPERIENCES',
    fontSize: 3,
    textColor: Color4.create(0.2, 0.9, 1, 1)
  })
}
```

Note the sign's 180° Y rotation: `TextShape` faces -Z by default; the booth faces the south spawn, so the text must face -Z toward players walking in — verify readability in the preview step and flip if mirrored.

- [ ] **Step 2: Build**

Run: `npm run build` — Expected: exit 0.

- [ ] **Step 3: Wire into `src/index.ts` temporarily and preview**

Replace `src/index.ts` content with:

```typescript
import { setupEnvironment } from './environment'

export function main() {
  setupEnvironment()
}
```

Run: `npm run start` — Expected in the browser preview:
- Dark ground covering the full 1x2 footprint; circular pad with glowing teal edge ring at the north half.
- DaisyClass ship hovering ~10m above the pad, bobbing gently and rotating slowly.
- Booth kiosk near spawn with legible glowing signage.
- **Adjust `SHIP_SCALE` / `SHIP_HOVER_HEIGHT` in `config.ts` now** if the model reads too large/small for the parcel (unknown authored scale — this is the checkpoint for it). Ship must stay inside the ~31.7m height limit.

- [ ] **Step 4: Commit**

```bash
git add src/environment.ts src/index.ts src/config.ts && git commit -m "feat: landing pad, hovering DaisyClass ship, FERN booth"
```

---

### Task 5: Toolkit dialogue UI mount

**Files:**
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/ui.tsx`

**Interfaces:**
- Produces: `setupUi(): void` — mounts `NpcUtilsUi` so `openDialogWindow` renders.

- [ ] **Step 1: Write `src/ui.tsx`**

```tsx
import ReactEcs, { ReactEcsRenderer, UiEntity } from '@dcl/sdk/react-ecs'
import { NpcUtilsUi } from 'dcl-npc-toolkit'

export function setupUi() {
  ReactEcsRenderer.setUiRenderer(() => (
    <UiEntity uiTransform={{ width: '100%', height: '100%', positionType: 'absolute' }}>
      <NpcUtilsUi />
    </UiEntity>
  ))
}
```

- [ ] **Step 2: Build**

Run: `npm run build` — Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/ui.tsx && git commit -m "feat: mount npc-toolkit dialog UI"
```

---

### Task 6: FERN — NPC, dialogue tree, registration, travel

**Files:**
- Create: `/Users/unknower/Git/galaxy-gardeners-landing/src/fern.ts`

**Interfaces:**
- Consumes: `authenticate`, `getDisplayName` from `./auth`; `getAvailableGalaxies`, `joinGalaxy` from `./api`; `FERN_SKIN_URN`, `FERN_BODY_SHAPE`, `MAIN_WORLD_DESTINATION`, `BOOTH_POSITION` from `./config`.
- Produces: `createFern(): void` (spawns the NPC and starts background auth).

- [ ] **Step 1: Write `src/fern.ts`**

The `npcDataComponent.set` block and `addDialog` call follow the documented crash-avoidance pattern for opening toolkit dialogs on hand-made entities (see `dclcontext/npc.mdc` "Toolkit Dialog UI vs Bubble UI" in the main repo). AvatarShape entities don't receive pointer events, so a transparent child collider box handles clicks.

```typescript
import { engine, Transform, AvatarShape, MeshCollider, ColliderLayer, pointerEventsSystem, InputAction, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'
import { openDialogWindow, Dialog } from 'dcl-npc-toolkit'
import { addDialog } from 'dcl-npc-toolkit/dist/dialog'
import { npcDataComponent } from 'dcl-npc-toolkit/dist/npc'
import { changeRealm, teleportTo } from '~system/RestrictedActions'
import { authenticate, getDisplayName } from './auth'
import { getAvailableGalaxies, joinGalaxy } from './api'
import { FERN_SKIN_URN, FERN_BODY_SHAPE, MAIN_WORLD_DESTINATION, BOOTH_POSITION } from './config'

type PlayerStatus = 'unknown' | 'new' | 'returning'

let playerStatus: PlayerStatus = 'unknown'
let fern: Entity

// Dialog indexes — keep in sync with the array in buildDialogs()
const GREET_NEW = 0
const LORE_1 = 1
const LORE_2 = 2
const FAREWELL = 3
const REGISTER_WAIT = 4
const REGISTER_SUCCESS = 5
const OFFLINE = 6
const GREET_RETURNING = 7
const BON_VOYAGE = 8

function buildDialogs(): Dialog[] {
  const name = getDisplayName()
  return [
    {
      text: "Welcome to the Daisy-Class Departure Terminal. I'm FERN — Field Exploration and Resource Navigator. That vessel above us? One exactly like it is waiting for you, in a galaxy very far from here.",
      isQuestion: true,
      buttons: [
        { label: 'Tell me more', goToDialog: LORE_1 },
        { label: 'Sign me up', goToDialog: REGISTER_WAIT, triggeredActions: () => void startRegistration() },
        { label: 'Just looking', goToDialog: FAREWELL }
      ]
    } as unknown as Dialog,
    {
      text: 'The Daisy-Class experience is a remote consciousness-link to your own vessel stationed among unexplored worlds. From its bridge, you survey planets no one else has touched.'
    } as Dialog,
    {
      text: 'Every world grows its own flora — living species found nowhere else in the universe. Collect samples, trade with fellow gardeners, build a catalog no one can replicate. No dangers. No rivals. Only the quiet luxury of discovery. Shall I register you?',
      isQuestion: true,
      buttons: [
        { label: 'Sign me up', goToDialog: REGISTER_WAIT, triggeredActions: () => void startRegistration() },
        { label: 'Maybe later', goToDialog: FAREWELL }
      ]
    } as unknown as Dialog,
    { text: 'Of course. The stars are patient, and so am I.', isEndOfDialog: true } as Dialog,
    { text: 'One moment — inscribing you into the fleet registry...', isEndOfDialog: true } as Dialog,
    {
      text: `Registration complete, Commander ${name}. Your vessel is ready and your gardens await. Shall I open the link?`,
      isQuestion: true,
      buttons: [
        { label: 'Board now', goToDialog: BON_VOYAGE, triggeredActions: goTravel },
        { label: 'Not yet', goToDialog: FAREWELL }
      ]
    } as unknown as Dialog,
    {
      text: "Hm. The registry uplink is down at the moment — how embarrassing. Board anyway; we'll sort your paperwork once you're aboard.",
      isQuestion: true,
      buttons: [
        { label: 'Board anyway', goToDialog: BON_VOYAGE, triggeredActions: goTravel },
        { label: 'Maybe later', goToDialog: FAREWELL }
      ]
    } as unknown as Dialog,
    {
      text: `Welcome back, Commander ${name}. Your vessel has kept your seat warm. Ready to board?`,
      isQuestion: true,
      buttons: [
        { label: 'Board now', goToDialog: BON_VOYAGE, triggeredActions: goTravel },
        { label: 'Not today', goToDialog: FAREWELL }
      ]
    } as unknown as Dialog,
    { text: 'Safe travels, Commander. May your gardens grow strange and wonderful.', isEndOfDialog: true } as Dialog
  ]
}

export function createFern() {
  fern = engine.addEntity()
  AvatarShape.create(fern, {
    id: 'fern',
    name: 'FERN',
    bodyShape: FERN_BODY_SHAPE,
    wearables: FERN_SKIN_URN ? [FERN_SKIN_URN] : [],
    emotes: []
  })
  Transform.create(fern, {
    position: Vector3.create(BOOTH_POSITION.x, 0.05, BOOTH_POSITION.z + 0.9),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0) // face the south spawn
  })

  // AvatarShape gets no pointer events — invisible collider child handles clicks
  const clickTarget = engine.addEntity()
  Transform.create(clickTarget, {
    parent: fern,
    position: Vector3.create(0, 1, 0),
    scale: Vector3.create(0.9, 2, 0.9)
  })
  MeshCollider.setBox(clickTarget, ColliderLayer.CL_POINTER)

  addDialog(fern)
  ensureNpcToolkitData(fern)

  pointerEventsSystem.onPointerDown(
    { entity: clickTarget, opts: { button: InputAction.IA_POINTER, hoverText: 'Talk to FERN' } },
    openFernDialog
  )

  void initFernState()
}

async function initFernState() {
  try {
    const { hasPlayer } = await authenticate()
    playerStatus = hasPlayer ? 'returning' : 'new'
    console.log(`[fern] player status: ${playerStatus}`)
  } catch (e) {
    playerStatus = 'unknown'
    console.log('[fern] auth failed, registry offline path active:', e)
  }
}

function openFernDialog() {
  const startIndex = playerStatus === 'returning' ? GREET_RETURNING : GREET_NEW
  openDialogWindow(fern, buildDialogs(), startIndex)
}

async function startRegistration() {
  try {
    if (playerStatus === 'unknown') {
      await initFernState()
      if (playerStatus === 'unknown') throw new Error('auth unavailable')
    }
    if (playerStatus === 'returning') {
      openDialogWindow(fern, buildDialogs(), REGISTER_SUCCESS)
      return
    }
    const galaxies = await getAvailableGalaxies()
    if (galaxies.length === 0) throw new Error('no galaxies available')
    await joinGalaxy(galaxies[0].id, getDisplayName())
    playerStatus = 'returning'
    console.log('[fern] registration complete')
    openDialogWindow(fern, buildDialogs(), REGISTER_SUCCESS)
  } catch (e) {
    console.log('[fern] registration failed:', e)
    openDialogWindow(fern, buildDialogs(), OFFLINE)
  }
}

function goTravel() {
  if (MAIN_WORLD_DESTINATION.mode === 'world') {
    console.log(`[fern] changing realm to ${MAIN_WORLD_DESTINATION.worldName}`)
    void changeRealm({ realm: MAIN_WORLD_DESTINATION.worldName })
  } else {
    console.log(`[fern] teleporting to ${MAIN_WORLD_DESTINATION.coords.x},${MAIN_WORLD_DESTINATION.coords.y}`)
    void teleportTo({ worldCoordinates: MAIN_WORLD_DESTINATION.coords })
  }
}

function ensureNpcToolkitData(entity: Entity) {
  if (npcDataComponent.has(entity)) return
  npcDataComponent.set(entity as any, {
    introduced: false,
    inCooldown: false,
    coolDownDuration: 5,
    faceUser: undefined,
    walkingSpeed: 2,
    walkingAnim: undefined,
    pathData: undefined,
    currentPathData: [],
    manualStop: false,
    pathIndex: 0,
    state: 'STANDING',
    idleAnim: 'Idle',
    hasBubble: false,
    turnSpeed: 2,
    theme: 'https://decentraland.org/images/ui/light-atlas-v3.png',
    bubbleXOffset: 0,
    bubbleYOffset: 0,
    lastPlayedAnim: 'Idle'
  })
}
```

Implementation notes for this task:
- If `npcDataComponent` exposes a `.set(entity, data)`/`Map` API mismatch at compile time, check the installed toolkit version's `dist/npc.d.ts` and adapt the call — the goal is only that per-NPC data exists before `openDialogWindow`.
- If the toolkit's `Dialog` type accepts `buttons` without casting, drop the `as unknown as Dialog` casts.
- Dialog at `LORE_1` intentionally has no buttons/end flag: the toolkit advances to the next array index on click.

- [ ] **Step 2: Build**

Run: `npm run build` — Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/fern.ts && git commit -m "feat: FERN NPC with dialogue tree, soft-gated registration, travel"
```

---

### Task 7: Scene assembly and full manual verification

**Files:**
- Modify: `/Users/unknower/Git/galaxy-gardeners-landing/src/index.ts`

**Interfaces:**
- Consumes: `setupEnvironment` from `./environment`, `createFern` from `./fern`, `setupUi` from `./ui`.

- [ ] **Step 1: Write final `src/index.ts`**

```typescript
import { setupEnvironment } from './environment'
import { createFern } from './fern'
import { setupUi } from './ui'

export function main() {
  setupEnvironment()
  createFern()
  setupUi()
}
```

- [ ] **Step 2: Build**

Run: `npm run build` — Expected: exit 0.

- [ ] **Step 3: Manual verification pass (staging API running)**

Start the staging backend locally (same as the main scene expects at `http://localhost:3000`), then `npm run start`. Verify:

1. FERN stands behind the booth counter facing spawn; hover text "Talk to FERN" appears on mouseover.
2. Console shows `[fern] player status: new` or `returning`.
3. **New-player path:** click FERN → greeting with 3 buttons → "Tell me more" walks both lore dialogs and re-offers signup → "Sign me up" shows the registry line, then the success dialog addressing you as Commander <your DCL name>; console shows `[fern] registration complete`.
4. **Returning path:** talk to FERN again (or reload) → "Welcome back, Commander" greeting straight to the travel offer.
5. **Board now** → client shows the change-realm confirmation prompt (destination will be the `WORLD_NAME_TBD.dcl.eth` placeholder — the prompt appearing is the pass criterion; actual arrival is verified after the user supplies the world name).

- [ ] **Step 4: Manual verification pass (staging API stopped)**

Stop the backend, reload the preview. Verify:

1. Console shows `[fern] auth failed, registry offline path active`.
2. Click FERN → new-player greeting → "Sign me up" → OFFLINE dialog ("registry uplink is down") → "Board anyway" still triggers the realm-change prompt. No dead ends: every dialog path reaches an end or a travel action.

- [ ] **Step 5: Fix anything the passes surfaced, then commit**

```bash
git add -A && git commit -m "feat: assemble departure terminal scene"
```

- [ ] **Step 6: Report remaining user-supplied values**

Remind the user of the three deploy-time blanks: real LAND parcels in `scene.json`, `MAIN_WORLD_DESTINATION.worldName`, and `FERN_SKIN_URN` in `src/config.ts`.

---

## Self-Review Notes

- **Spec coverage:** project structure (T1-2), auth/api slice (T3), pad + hovering ship + booth + signage (T4), toolkit UI (T5), FERN AvatarShape + skin URN + dialogue + soft-gated registration + config-driven travel (T6), assembly + both API-up/API-down test passes (T7). Triangle-budget risk from the spec is T1 Step 6. No gaps found.
- **Known unknowns, stated:** ship model authored scale (checkpoint T4 Step 3), toolkit version API drift (notes in T6), world name / skin URN / parcels (Global Constraints + T7 Step 6).
- **Type consistency:** `authenticate()` → `{ hasPlayer: boolean }` used in T6; `getDisplayName(): string` produced in T3, consumed in T6; `Destination` union produced in T2, narrowed via `.mode` in T6's `goTravel()`; config constants named identically across T2/T4/T6.
