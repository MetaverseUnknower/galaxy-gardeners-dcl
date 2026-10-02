// Hyperspace outside the bridge window while the ship travels. At departure the stars ahead stretch from points into
// long streaks racing at the glass, with a flash as the drive kicks in. Then it settles into a calmer cruise: slower,
// shorter, sparser streaks (trips can last hours) in a tunnel that turns slowly around the destination star. On
// arrival the streaks shrink back to nothing. Joining a trip already under way goes straight to the cruise.
// Everything is built once per trip and animated by moving and stretching only (frameBudget.test.ts). The streaks
// hang off one root that the top-down view hides, since they're rescaled every frame.
import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { isCurrentlyTraveling, getTravelElapsedMs } from './navigation'
import { hideInTopView } from './topViewHide'

// Outside the south window (glass at z 111..114, x 119..137, y 37..52); the view looks toward -z. The root sits on
// the window's axis at z 0, so a child's z is its world z, and turning the root turns the tunnel about that axis.
const AXIS = Vector3.create(128, 45, 0)
const Z_FAR = 25          // where streaks come from: beyond the destination star (z 78), inside the skybox
const Z_NEAR = 106        // where they pass the window and start again far out
const RADIUS = [3, 18]    // distance from the axis
const STREAKS = 70
const CRUISE_STREAKS = 30 // the rest retire as they pass the window once the cruise sets in
const WIDTH = 0.07

type Look = { speed: number; length: number }   // metres a second toward the window; streak length in metres
const STILL: Look = { speed: 0, length: 0.3 }   // a star: a point
const JUMP: Look = { speed: 150, length: 16 }
const CRUISE: Look = { speed: 45, length: 6 }
const JUMP_SECONDS = 3
const SETTLE_SECONDS = 2   // from the jump's pace to the cruise's
const DROP_SECONDS = 2
const JOIN_GRACE_MS = 6000 // a trip younger than this still gets its jump
const TWIST_DEG_PER_S = 6
const FLASH = { z: 100, at: 2.2, seconds: 0.6, size: 46 }

const BLUE_WHITE = Color3.create(0.75, 0.86, 1)
const VIOLET = Color3.create(0.72, 0.5, 1)

export type HyperspacePhase = 'off' | 'jump' | 'cruise' | 'drop'
type Streak = { entity: Entity; angle: number; r: number; z: number; keep: boolean; active: boolean }

let phase: HyperspacePhase = 'off'
let phaseTime = 0
let fromJump = false   // the cruise eases in from the jump's pace; joined mid-trip, it starts at cruise pace
let twist = 0
let root: Entity | null = null
let flash: Entity | null = null
let streaks: Streak[] = []

export function hyperspaceState(): { phase: HyperspacePhase; streaks: number } {
  return { phase, streaks: streaks.filter(s => s.active).length }
}
/** The root the streaks hang from (the top-down view hides it). */
export function hyperspaceRoot(): Entity | null { return root }
/** Back to nothing at all, for tests. */
export function resetHyperspace(): void { teardown(); phase = 'off'; phaseTime = 0 }

function place(s: Streak, z: number): void {
  s.angle = Math.random() * Math.PI * 2
  s.r = RADIUS[0] + Math.random() * (RADIUS[1] - RADIUS[0])
  s.z = z
}

function build(): void {
  root = engine.addEntity()
  Transform.create(root, { position: AXIS })
  hideInTopView(root)
  for (let i = 0; i < STREAKS; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, { parent: root, scale: Vector3.Zero() })
    MeshRenderer.setBox(entity)
    const c = i % 5 === 0 ? VIOLET : BLUE_WHITE
    Material.setPbrMaterial(entity, { albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: c, emissiveIntensity: 5, castShadows: false })
    const s: Streak = { entity, angle: 0, r: 0, z: 0, keep: i < CRUISE_STREAKS, active: true }
    place(s, Z_FAR + Math.random() * (Z_NEAR - Z_FAR))   // a full tunnel of stars from the start
    streaks.push(s)
  }
  flash = engine.addEntity()
  Transform.create(flash, { parent: root, position: Vector3.create(0, 0, FLASH.z), scale: Vector3.Zero() })
  MeshRenderer.setPlane(flash)
  Material.setPbrMaterial(flash, {
    albedoColor: Color4.create(0.85, 0.92, 1, 0.55), emissiveColor: Color3.create(0.85, 0.92, 1), emissiveIntensity: 3,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false,
  })
}

function teardown(): void {
  for (const s of streaks) engine.removeEntity(s.entity)
  streaks = []
  if (flash) { engine.removeEntity(flash); flash = null }
  if (root) { engine.removeEntity(root); root = null }
}

function enter(next: HyperspacePhase): void { phase = next; phaseTime = 0 }

const ease = (k: number) => k * k * (3 - 2 * k)
const mix = (a: Look, b: Look, k: number): Look => ({ speed: a.speed + (b.speed - a.speed) * k, length: a.length + (b.length - a.length) * k })

export function hyperspaceSystem(dt: number): void {
  const traveling = isCurrentlyTraveling()
  if (phase === 'off') {
    if (!traveling) return
    build()
    fromJump = getTravelElapsedMs() < JOIN_GRACE_MS
    enter(fromJump ? 'jump' : 'cruise')
  } else if (!traveling && phase !== 'drop') {
    enter('drop')
  } else if (traveling && phase === 'drop') {
    enter('jump'); fromJump = true   // off again before the last trip's streaks were gone
  }
  phaseTime += dt

  let look: Look, size = 1
  if (phase === 'jump') {
    look = mix(STILL, JUMP, ease(Math.min(1, phaseTime / JUMP_SECONDS)))
    if (phaseTime >= JUMP_SECONDS) enter('cruise')
  } else if (phase === 'cruise') {
    look = fromJump ? mix(JUMP, CRUISE, ease(Math.min(1, phaseTime / SETTLE_SECONDS))) : CRUISE
  } else {
    const k = 1 - Math.min(1, phaseTime / DROP_SECONDS)
    look = mix(STILL, CRUISE, ease(k))
    size = k
    if (k <= 0) { teardown(); enter('off'); return }
  }

  twist = (twist + TWIST_DEG_PER_S * dt) % 360
  if (root) Transform.getMutable(root).rotation = Quaternion.fromEulerDegrees(0, 0, twist)

  for (const s of streaks) {
    s.z += look.speed * dt
    if (s.z > Z_NEAR) {
      if (phase === 'cruise' && !s.keep) s.active = false   // thinning out for the long haul
      place(s, Z_FAR + Math.random() * 8)
    }
    const tr = Transform.getMutable(s.entity)
    if (!s.active) { tr.scale = Vector3.Zero(); continue }
    tr.position = Vector3.create(Math.cos(s.angle) * s.r, Math.sin(s.angle) * s.r, s.z - look.length / 2)
    tr.scale = Vector3.create(WIDTH * size, WIDTH * size, look.length * size)
  }

  // The drive kicking in: one bright flash across the window near the end of the jump
  if (flash) {
    const u = phase === 'jump' ? (phaseTime - FLASH.at) / FLASH.seconds : -1
    const s = u > 0 && u < 1 ? Math.sin(Math.PI * u) * FLASH.size : 0
    Transform.getMutable(flash).scale = Vector3.create(s, s, 1)
  }
}
