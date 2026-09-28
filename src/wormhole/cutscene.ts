// Wormhole cutscenes, seen out of the front window: a vortex of glowing ring segments and inward-spiralling streaks
// placed between the window (glass at z≈112) and the window star (z 78).
//   open  (7 s): the vortex spins up with a pulse of light, holds, then fades.
//   jump  (6 s): it rushes at the ship, streaks stretch, white-out; `midpoint` (the map / window swap) runs while
//                fully white; the white clears as the vortex collapses behind.
//   close (5 s): it shrinks, spinning faster, and snaps shut with a flash; `midpoint` runs at the snap.
// A click skips to the end (the midpoint still runs). Built only from pieces proven in this scene.
import { engine, Entity, Transform, MeshRenderer, Material } from '@dcl/sdk/ecs'
import { Vector3, Quaternion, Color3, Color4 } from '@dcl/sdk/math'
import { applyShot, releaseShot } from '../tour/shots'
import type { CutsceneKind } from './state'

const VORTEX_POS = Vector3.create(128, 46, 84)
const DURATION: Record<CutsceneKind, number> = { open: 7, jump: 6, close: 5 }
const MIDPOINT_AT: Record<CutsceneKind, number> = { open: Infinity, jump: 2.5, close: 3.2 }
const RINGS = [
  { r: 3, speed: 90, color: Color3.create(1, 0.95, 1) },
  { r: 5.5, speed: -60, color: Color3.create(1, 0.3, 0.85) },
  { r: 8, speed: 35, color: Color3.create(0.6, 0.35, 1) },
]
const SEGMENTS = 24
const STREAKS = 24

type Ring = { pivot: Entity; speed: number; angle: number }
type Streak = { e: Entity; a: number; r: number }
type Playing = { kind: CutsceneKind; t: number; midpoint?: () => Promise<void>; midpointState: 'pending' | 'running' | 'done'; resolve: () => void }

let root: Entity | null = null
const parts: Entity[] = []
let rings: Ring[] = []
let streaks: Streak[] = []
let playing: Playing | null = null
let flash = 0

export function flashAlpha(): number { return flash }
export function isCutscenePlaying(): boolean { return playing !== null }
export function skipCutscene(): void { if (playing) playing.t = Math.max(playing.t, DURATION[playing.kind]) }

function glow(e: Entity, c: Color3, intensity: number): void {
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, { albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: c, emissiveIntensity: intensity, castShadows: false })
}

function buildVortex(): void {
  root = engine.addEntity()
  Transform.create(root, { position: VORTEX_POS, scale: Vector3.Zero() })
  parts.push(root)
  rings = RINGS.map(spec => {
    const pivot = engine.addEntity()
    Transform.create(pivot, { parent: root! })
    parts.push(pivot)
    const arc = (2 * Math.PI * spec.r) / SEGMENTS
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2
      const seg = engine.addEntity()
      Transform.create(seg, {
        position: Vector3.create(Math.cos(a) * spec.r, Math.sin(a) * spec.r, 0),
        rotation: Quaternion.fromEulerDegrees(0, 0, (a * 180) / Math.PI + 90),
        scale: Vector3.create(arc * 0.8, 0.12, 0.05),
        parent: pivot,
      })
      glow(seg, spec.color, 3)
      parts.push(seg)
    }
    return { pivot, speed: spec.speed, angle: 0 }
  })
  streaks = []
  for (let i = 0; i < STREAKS; i++) {
    const e = engine.addEntity()
    const a = (i / STREAKS) * Math.PI * 2
    Transform.create(e, { parent: root })
    glow(e, Color3.create(0.85, 0.7, 1), 4)
    parts.push(e)
    streaks.push({ e, a, r: 2 + ((i * 7) % 8) })
  }
}

function destroyVortex(): void {
  for (const e of parts) engine.removeEntity(e)
  parts.length = 0
  rings = []
  streaks = []
  root = null
}

const easeOut = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3)
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/** Plays one cutscene; resolves when it has finished (or immediately if another is running). */
export function playCutscene(kind: CutsceneKind, midpoint?: () => Promise<void>): Promise<void> {
  if (playing) return midpoint ? midpoint() : Promise.resolve()
  buildVortex()
  applyShot('window')
  return new Promise<void>(resolve => { playing = { kind, t: 0, midpoint, midpointState: midpoint ? 'pending' : 'done', resolve } })
}

engine.addSystem((dt: number) => {
  if (!playing) { if (flash > 0) flash = Math.max(0, flash - dt * 2); return }
  const p = playing
  if (p.midpointState === 'running') { flash = 1; return }   // hold on white until the swap is done
  p.t += dt
  const t = p.t
  let scale = 1, z = VORTEX_POS.z, spinBoost = 1, stretch = 1

  if (p.kind === 'open') {
    scale = easeOut(t / 2.5) * (t > 6 ? clamp01(7 - t) : 1)
    flash = t > 2.3 && t < 3.3 ? 0.35 * (1 - Math.abs(t - 2.8) / 0.5) : 0
  } else if (p.kind === 'jump') {
    if (t < 2.5) {
      const k = easeOut(t / 2.5)
      scale = 1 + 2 * k
      z = VORTEX_POS.z + 16 * k      // toward the ship
      stretch = 1 + 3 * k
      flash = clamp01((t - 1.8) / 0.7)
    } else {
      const k = clamp01((t - 2.5) / 2.5)
      scale = 1 - k                  // collapsing behind
      z = VORTEX_POS.z - 14
      flash = clamp01(1 - (t - 2.5) / 1.5)
    }
  } else {
    const k = clamp01(t / 3)
    scale = t < 3.2 ? 1 - 0.85 * k * k : 0
    spinBoost = 1 + 4 * k
    flash = t > 3.1 && t < 3.9 ? 0.6 * (1 - Math.abs(t - 3.2) / 0.7) : 0
  }

  if (p.midpointState === 'pending' && t >= MIDPOINT_AT[p.kind]) {
    p.midpointState = 'running'
    flash = p.kind === 'jump' ? 1 : flash
    p.midpoint!().catch(err => console.log('[wormhole] cutscene midpoint failed', err)).finally(() => { p.midpointState = 'done' })
    return
  }

  if (root) {
    const tr = Transform.getMutable(root)
    tr.scale = Vector3.create(scale, scale, scale)
    tr.position = Vector3.create(VORTEX_POS.x, VORTEX_POS.y, z)
  }
  for (const ring of rings) {
    ring.angle = (ring.angle + ring.speed * spinBoost * dt) % 360
    Transform.getMutable(ring.pivot).rotation = Quaternion.fromEulerDegrees(0, 0, ring.angle)
  }
  for (const s of streaks) {
    s.r -= dt * 4 * spinBoost
    s.a += dt * 1.2 * spinBoost
    if (s.r < 1.2) s.r = 9
    const tr = Transform.getMutable(s.e)
    tr.position = Vector3.create(Math.cos(s.a) * s.r, Math.sin(s.a) * s.r, 0)
    tr.rotation = Quaternion.fromEulerDegrees(0, 0, (s.a * 180) / Math.PI)
    tr.scale = Vector3.create(1.6 * stretch, 0.08, 0.05)
  }

  if (t >= DURATION[p.kind]) {
    if (p.midpointState === 'pending') { p.midpointState = 'running'; p.midpoint!().finally(() => { p.midpointState = 'done' }); return }   // skipped before the midpoint
    destroyVortex()
    releaseShot()
    playing = null
    p.resolve()
  }
})
