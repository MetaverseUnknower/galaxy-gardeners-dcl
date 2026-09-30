// Wormholes in the system view: a portal just past the system's outermost orbit, lifted out of the orbital plane so
// it plainly doesn't belong. One for a black hole's linked wormhole (violet and cyan: permanent, cold) and one for
// an open wormhole event's target (magenta and gold: temporary, hot), on opposite sides when a system has both.
// The look: a mirrored ball warping space and time around it. Light bends into rings hugging it, ripples of warped
// space roll outward, and specks falling in slow down, stretch and freeze at its surface. It's all built once and
// animated by moving things only (a material re-set every frame wears the explorer down, see test/frameBudget.test.ts).
// A wormhole the Eld built (bought on the black market) also wears their rings: wheels within wheels of gold and
// ivory plates, studded with eyes, each turning on its own axis around the ball like the frame of a Dyson sphere.
// Clicking does what the star panel's button would (wormhole/actions.ts); where that offers nothing, it's only to look at.
import { engine, Entity, Transform, MeshRenderer, MeshCollider, Material, ColliderLayer, InputAction, pointerEventsSystem, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Color3, Color4, Vector3, Quaternion } from '@dcl/sdk/math'
import { wormholeEvent, closesAtText } from './state'
import { eventWormholeOffer, useEventWormhole, pressBlackHoleJump } from './actions'

export type PortalKind = 'blackHole' | 'event'
export type PortalLink = { targetId: string; targetName: string }

/** How far the portal reaches from its centre (the outermost ripple), and the gap between the outermost orbit and
 *  that centre, in the system root's units. */
export const PORTAL_SIZE = 0.85
export const PORTAL_CLEARANCE = 0.9

const PALETTES: Record<PortalKind, { near: Color3; far: Color3 }> = {
  blackHole: { near: Color3.create(0.75, 0.45, 1), far: Color3.create(0.3, 0.9, 1) },
  event: { near: Color3.create(1, 0.3, 0.8), far: Color3.create(1, 0.8, 0.25) },
}
const ANGLE_DEG: Record<PortalKind, number> = { blackHole: 35, event: 215 }   // opposite sides
const TILT_DEG = 35       // the specks' orbits lean this far out of the orbital plane
const LIFT = 0.35         // above the orbital plane
const BALL = 0.28         // the mirrored ball's radius
const LENS_RINGS = [{ r: 1.08, dashes: 28, speed: 22 }, { r: 1.22, dashes: 20, speed: -14 }]   // r: x BALL
const RIPPLES = 3
const RIPPLE_DOTS = 26
const RIPPLE_FROM = 1.35  // x BALL, where a ripple starts
const RIPPLE_TO = PORTAL_SIZE / BALL
const RIPPLE_SECONDS = 4.5
const SPECKS = 16
const SPECK_FROM = 2.6    // x BALL, where a speck starts falling
// The Eld's wheels: radius (x BALL), plates, eyes, and turning speed about each axis in degrees a second
const WHEELS = [
  { r: 1.7, plates: 16, eyes: 3, spin: [23, 0, 11] },
  { r: 2.05, plates: 20, eyes: 4, spin: [0, -17, 29] },
  { r: 2.4, plates: 24, eyes: 5, spin: [31, 13, 0] },
  { r: 2.75, plates: 28, eyes: 6, spin: [-9, 21, -15] },
]
const IVORY = Color3.create(1, 0.95, 0.82)
const GOLD = Color3.create(1, 0.72, 0.28)

type Spin = { pivot: Entity; speed: number }
type Wheel = { pivot: Entity; spin: number[]; phase: number }
type Ripple = { dots: Entity[]; offset: number }
type Speck = { entity: Entity; u: number; angle: number; lean: number; rate: number }
type Portal = {
  kind: PortalKind; eventId: string | null; eld: boolean; wheels: Wheel[]; root: Entity; ball: Entity; lens: Spin[]; ripples: Ripple[]; specks: Speck[]
  hit: Entity; entities: Entity[]; clickable: boolean; hoverText: string; press: () => void
}
type View = { root: Entity; systemId: string; here: boolean; radius: number; say: (text: string) => void }

let view: View | null = null
let portals: Portal[] = []
let time = 0

/** Opens the system's portals: the black hole's now, the event's as the event comes and goes (animateSystemPortals). */
export function openSystemPortals(root: Entity, opts: { systemId: string; here: boolean; radius: number; link: PortalLink | null; say: (text: string) => void }): void {
  clearSystemPortals()
  view = { root, systemId: opts.systemId, here: opts.here, radius: opts.radius, say: opts.say }
  const link = opts.link
  if (link) {
    const blackHole = { systemId: opts.systemId, targetId: link.targetId, targetName: link.targetName }
    portals.push(buildPortal('blackHole', null, false, `Wormhole to ${link.targetName}`, () => pressBlackHoleJump(blackHole, null, opts.say)))
    setClickable(portals[portals.length - 1], opts.here)   // the jump leaves from where the ship is
  }
  syncEventPortal()
}

export function clearSystemPortals(): void {
  for (const p of portals) removePortal(p)
  portals = []
  view = null
}

/** What's open, for tests and the curious. */
export function portalState(): { kind: PortalKind; clickable: boolean; hoverText: string; eld: boolean }[] {
  return portals.map(p => ({ kind: p.kind, clickable: p.clickable, hoverText: p.hoverText, eld: p.eld }))
}

/** A click on the portal (the pointer handler calls this too). */
export function pressPortal(kind: PortalKind): void {
  const p = portals.find(x => x.kind === kind)
  if (p?.clickable) p.press()
}

export function animateSystemPortals(dt: number): void {
  if (!view) return
  syncEventPortal()
  time += dt
  for (const p of portals) animatePortal(p, dt)
}

// The event's portal follows the event: opens with it, closes with it, and is clickable while there's an offer. It's
// rebuilt if the server changes its mind about who built it.
function syncEventPortal(): void {
  if (!view) return
  const ev = wormholeEvent()
  const wanted = ev && ev.targetSystemId === view.systemId ? ev : null
  let p = portals.find(x => x.kind === 'event')
  const eld = !!wanted?.eldBuilt
  if (p && (p.eventId !== (wanted?.id ?? null) || p.eld !== eld)) { removePortal(p); portals = portals.filter(x => x !== p); p = undefined }
  if (!wanted) return
  if (!p) {
    const systemId = view.systemId, here = view.here
    p = buildPortal('event', wanted.id, eld, `${eld ? 'Eld wormhole' : 'Wormhole'}, closes ${closesAtText()}`, () => {
      const offer = eventWormholeOffer(systemId, here)
      if (offer) useEventWormhole(offer)
    })
    portals.push(p)
  }
  const clickable = eventWormholeOffer(view.systemId, view.here) !== null
  if (clickable !== p.clickable) setClickable(p, clickable)
}

function setClickable(p: Portal, clickable: boolean): void {
  p.clickable = clickable
  if (clickable) {
    const kind = p.kind
    pointerEventsSystem.onPointerDown({ entity: p.hit, opts: { button: InputAction.IA_POINTER, hoverText: p.hoverText, maxDistance: 20 } }, () => pressPortal(kind))
  } else {
    pointerEventsSystem.removeOnPointerDown(p.hit)
  }
}

function lerp(a: Color3, b: Color3, t: number): Color3 {
  return Color3.create(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t)
}

function buildPortal(kind: PortalKind, eventId: string | null, eld: boolean, hoverText: string, press: () => void): Portal {
  const v = view!
  const entities: Entity[] = []
  const add = (parent: Entity, t: { position?: Vector3; rotation?: Quaternion; scale?: Vector3 }): Entity => {
    const e = engine.addEntity()
    Transform.create(e, { position: t.position ?? Vector3.Zero(), rotation: t.rotation ?? Quaternion.Identity(), scale: t.scale ?? Vector3.One(), parent })
    entities.push(e)
    return e
  }
  const glowing = (e: Entity, c: Color3, intensity: number) =>
    Material.setPbrMaterial(e, { albedoColor: Color4.create(c.r, c.g, c.b, 1), emissiveColor: c, emissiveIntensity: intensity, castShadows: false })
  const a = (ANGLE_DEG[kind] * Math.PI) / 180
  const root = add(v.root, {
    position: Vector3.create(Math.cos(a) * v.radius, LIFT, Math.sin(a) * v.radius),
    rotation: Quaternion.fromEulerDegrees(-TILT_DEG, 90 - ANGLE_DEG[kind], 0),
  })
  const { near, far } = PALETTES[kind]

  // The mirrored ball: chrome, reflecting the room, with a faint tint so it holds its own in the hologram
  const ball = add(root, { scale: Vector3.create(BALL * 2, BALL * 2, BALL * 2) })
  MeshRenderer.setSphere(ball)
  Material.setPbrMaterial(ball, {
    albedoColor: Color4.create(0.95, 0.95, 1, 1), metallic: 1, roughness: 0.04, specularIntensity: 1,
    emissiveColor: near, emissiveIntensity: 0.25, castShadows: false,
  })

  // Light bent around it: rings that hug the ball and always turn to face the viewer
  const facing = add(root, {})
  Billboard.create(facing, { billboardMode: BillboardMode.BM_ALL })
  const lens: Spin[] = []
  LENS_RINGS.forEach((ring, i) => {
    const pivot = add(facing, {})
    const r = BALL * ring.r
    const arc = (2 * Math.PI * r) / ring.dashes
    const c = lerp(Color3.White(), i === 0 ? near : far, 0.35)
    for (let j = 0; j < ring.dashes; j++) {
      if (j % 7 === 6) continue   // gaps, so the turning shows
      const b = (j / ring.dashes) * Math.PI * 2
      const dash = add(pivot, {
        position: Vector3.create(Math.cos(b) * r, Math.sin(b) * r, 0),
        rotation: Quaternion.fromEulerDegrees(0, 0, (b * 180) / Math.PI + 90),
        scale: Vector3.create(arc * 0.85, 0.012 - i * 0.004, 0.004),
      })
      MeshRenderer.setBox(dash)
      glowing(dash, c, 6 - i * 2)
    }
    lens.push({ pivot, speed: ring.speed })
  })

  // Warped space rolling outward: rings of dots, also facing the viewer, placed every frame
  const ripples: Ripple[] = []
  for (let i = 0; i < RIPPLES; i++) {
    const dots: Entity[] = []
    const c = lerp(near, far, i / Math.max(1, RIPPLES - 1))
    for (let j = 0; j < RIPPLE_DOTS; j++) {
      const dot = add(facing, { scale: Vector3.Zero() })
      MeshRenderer.setSphere(dot)
      glowing(dot, c, 3)
      dots.push(dot)
    }
    ripples.push({ dots, offset: i / RIPPLES })
  }

  // Specks falling in, in orbits leaning every which way
  const specks: Speck[] = []
  for (let i = 0; i < SPECKS; i++) {
    const entity = add(root, { scale: Vector3.Zero() })
    MeshRenderer.setSphere(entity)
    glowing(entity, lerp(far, Color3.White(), 0.5), 6)
    specks.push({ entity, u: i / SPECKS, angle: Math.random() * Math.PI * 2, lean: (Math.random() - 0.5) * 140, rate: 0.1 + Math.random() * 0.08 })
  }

  const wheels = eld ? buildWheels(root, add, glowing) : []

  // What the pointer hits: an invisible ball a little bigger than the mirrored one
  const hit = add(root, { scale: Vector3.create(BALL * 3, BALL * 3, BALL * 3) })
  MeshCollider.setSphere(hit, ColliderLayer.CL_POINTER)

  return { kind, eventId, eld, wheels, root, ball, lens, ripples, specks, hit, entities, clickable: false, hoverText, press }
}

// Wheels within wheels: rims of flat plates (the plates' width runs along the wheel's axis, like a band), gaps between
// some, and eyes set into the rim looking outward. Each wheel is its own gimbal, tumbling on its own axes.
function buildWheels(root: Entity, add: (parent: Entity, t: { position?: Vector3; rotation?: Quaternion; scale?: Vector3 }) => Entity, glowing: (e: Entity, c: Color3, intensity: number) => void): Wheel[] {
  return WHEELS.map((w, i) => {
    const pivot = add(root, {})
    const r = BALL * w.r
    const arc = (2 * Math.PI * r) / w.plates
    const tone = i % 2 === 0 ? GOLD : IVORY
    for (let j = 0; j < w.plates; j++) {
      if (j % 5 === 4) continue
      const b = (j / w.plates) * Math.PI * 2
      const plate = add(pivot, {
        position: Vector3.create(Math.cos(b) * r, Math.sin(b) * r, 0),
        rotation: Quaternion.fromEulerDegrees(0, 0, (b * 180) / Math.PI + 90),
        scale: Vector3.create(arc * 0.72, 0.006, 0.05 + 0.012 * i),
      })
      MeshRenderer.setBox(plate)
      glowing(plate, tone, 1.6)
    }
    for (let k = 0; k < w.eyes; k++) {
      const b = ((k + 0.5 * (i % 2)) / w.eyes) * Math.PI * 2 + i
      const out = Vector3.create(Math.cos(b), Math.sin(b), 0)
      const eye = add(pivot, { position: Vector3.scale(out, r + 0.012), scale: Vector3.create(0.038, 0.038, 0.038) })
      MeshRenderer.setSphere(eye)
      glowing(eye, Color3.White(), 4)
      const pupil = add(pivot, { position: Vector3.scale(out, r + 0.03), scale: Vector3.create(0.018, 0.018, 0.018) })
      MeshRenderer.setSphere(pupil)
      Material.setPbrMaterial(pupil, { albedoColor: Color4.create(0, 0, 0, 1), emissiveColor: Color3.Black(), emissiveIntensity: 0, roughness: 0.2, castShadows: false })
    }
    return { pivot, spin: w.spin, phase: i * 47 }
  })
}

function removePortal(p: Portal): void {
  if (p.clickable) pointerEventsSystem.removeOnPointerDown(p.hit)
  for (let i = p.entities.length - 1; i >= 0; i--) engine.removeEntity(p.entities[i])
  p.entities.length = 0
}

function animatePortal(p: Portal, dt: number): void {
  const t = time + (p.kind === 'event' ? 3.1 : 0)   // the two don't breathe in step
  // The ball won't quite hold round
  const d = BALL * 2
  Transform.getMutable(p.ball).scale = Vector3.create(d * (1 + 0.05 * Math.sin(t * 1.9)), d * (1 + 0.05 * Math.sin(t * 1.9 + 2.1)), d * (1 + 0.05 * Math.sin(t * 1.9 + 4.2)))
  for (const ring of p.lens) Transform.getMutable(ring.pivot).rotation = Quaternion.fromEulerDegrees(0, 0, t * ring.speed)
  for (const w of p.wheels) {
    Transform.getMutable(w.pivot).rotation = Quaternion.fromEulerDegrees(w.phase + t * w.spin[0], w.phase * 0.5 + t * w.spin[1], t * w.spin[2])
  }

  // Each ripple rolls out from the ball, its outline warped by a wave that turns as it goes, thinning as it spreads
  for (const ripple of p.ripples) {
    const k = (t / RIPPLE_SECONDS + ripple.offset) % 1
    const r = BALL * (RIPPLE_FROM + (RIPPLE_TO - RIPPLE_FROM) * k)
    const size = 0.022 * (1 - k) + 0.002
    for (let j = 0; j < ripple.dots.length; j++) {
      const b = (j / ripple.dots.length) * Math.PI * 2
      const warp = 1 + 0.14 * Math.sin(3 * b + t * 1.4) + 0.06 * Math.sin(5 * b - t * 2.3)
      const tr = Transform.getMutable(ripple.dots[j])
      tr.position = Vector3.create(Math.cos(b) * r * warp, Math.sin(b) * r * warp, 0)
      tr.scale = Vector3.create(size, size, size)
    }
  }

  // Time slows near the ball: a speck falling in crawls, stretches along its path, and freezes at the surface
  for (const s of p.specks) {
    s.u += dt * s.rate * (1.4 - s.u * 1.2)
    if (s.u >= 1) { s.u -= 1; s.angle = Math.random() * Math.PI * 2; s.lean = (Math.random() - 0.5) * 140 }
    const r = BALL * (SPECK_FROM - (SPECK_FROM - 1.02) * Math.sqrt(s.u))
    s.angle += dt * 2.2 * (1 - s.u) * (1 - s.u)
    const lean = Quaternion.fromEulerDegrees(s.lean, 0, 0)
    const flat = Vector3.create(Math.cos(s.angle) * r, 0, Math.sin(s.angle) * r)
    const tr = Transform.getMutable(s.entity)
    tr.position = Vector3.rotate(flat, lean)
    tr.rotation = Quaternion.multiply(lean, Quaternion.fromEulerDegrees(0, -(s.angle * 180) / Math.PI, 0))
    const size = 0.022 * (1 - 0.5 * s.u)
    tr.scale = Vector3.create(size, size, size * (1 + 5 * s.u * s.u))   // smeared along its path near the surface
  }
}
