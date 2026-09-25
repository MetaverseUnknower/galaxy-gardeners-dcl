// Sleep mode: a full-screen 2D composite of a bedroom window looking out on the current system, drifting
// slowly as if the ship were turning in orbit. Purely visual; the HUD hides while asleep.
import { engine } from '@dcl/sdk/ecs'
import { getPref, setPref } from './prefs'
import { StarSystem } from './types'
import { getTravelDestination, getTravelFraction } from './navigation'

// Bedrooms are used at their native size and aspect: the overlay fits them to the screen height ("contain")
// and pans slowly when the fitted image is wider than the screen.
export const SLEEP_VIEWS: { src: string; aspect: number }[] = [
  { src: 'assets/images/DaisyClass-SleepView1.png', aspect: 1647 / 955 },
  { src: 'assets/images/DaisyClass-SleepView2.png', aspect: 1644 / 957 },
  { src: 'assets/images/DaisyClass-SleepView3.png', aspect: 1644 / 957 },
  { src: 'assets/images/DaisyClass-SleepView4.png', aspect: 1672 / 940 },
]
const PAN_PERIOD_SECONDS = 300   // one full left-right-left sweep
/** The galaxy band: faint, huge, behind everything, crossing the window once per cycle like a very slow orbit. */
// The farthest layer, so it moves the slowest of anything: starts centred and takes the better part of an hour to leave.
export const MILKY_WAY = { src: 'assets/images/MilkyWay_Nebula.png', aspect: 1672 / 941, width: 75, alpha: 0.22, speed: 0.03, wrap: 300, start: 12 }

/** Star-field backdrop (transparent, native 16:9), tiled small over the galaxy band. StarTexture2 is opaque and unused. */
export const BACKDROPS: { src: string; aspect: number; alpha: number; speed: number }[] = [
  { src: 'assets/images/StarTexture1.png', aspect: 1672 / 941, alpha: 1, speed: 0.05 },
]
/** Backdrop tiles are drawn at this fraction of the room height (smaller = finer, more distant-looking stars) and tiled to cover. */
export const BACKDROP_SCALE = 0.28

/** Celestial atlas: a 4x4 grid of galaxies, clusters and nebulae. Cells are scattered small over the backdrop so they read
 *  as distant stars with the odd galaxy among them. Cell UVs: bottom-left first, clockwise (protocol order). */
export const ATLAS = { src: 'assets/images/Celestials_Atlas.png', cols: 4, rows: 4, cellAspect: 384 / 256 }
export type Celestial = { cell: number; x: number; y: number; size: number; depth: number; alpha: number }
const CELESTIAL_COUNT = 26
export function atlasUvs(cell: number): number[] {
  const c = cell % ATLAS.cols, r = Math.floor(cell / ATLAS.cols)
  const u0 = c / ATLAS.cols, u1 = (c + 1) / ATLAS.cols
  const vTop = 1 - r / ATLAS.rows, vBottom = 1 - (r + 1) / ATLAS.rows
  return [u0, vBottom, u0, vTop, u1, vTop, u1, vBottom]
}

/** Sparse nebula patches: each is a modest cloud that drifts across once per WRAP percent, so most of the time the window is just stars. */
export const NEBULAE: { src: string; width: number; height: number; top: number; alpha: number }[] = [
  { src: 'assets/images/Stars_Nebula2.png', width: 70, height: 45, top: 8, alpha: 0.55 },
  { src: 'assets/images/Stars_Nebula3.png', width: 60, height: 40, top: 30, alpha: 0.45 },
]
export const NEBULA_WRAP = 320   // % of width a patch travels before coming back around

/** Star sprite per star type, with a size (fraction of screen width) and tint. Red giants reuse the dwarf, larger and warmer. */
export const STAR_SPRITES: Record<string, { src: string; size: number; tint: [number, number, number] }> = {
  black_hole: { src: 'assets/images/Stars_BlackHole.png', size: 0.34, tint: [1, 1, 1] },
  blue_giant: { src: 'assets/images/Stars_BlueGiant.png', size: 0.26, tint: [1, 1, 1] },
  neutron_star: { src: 'assets/images/Stars_NeutronStar.png', size: 0.2, tint: [1, 1, 1] },
  red_dwarf: { src: 'assets/images/Stars_RedDwarf.png', size: 0.18, tint: [1, 1, 1] },
  red_giant: { src: 'assets/images/Stars_RedDwarf.png', size: 0.3, tint: [1, 0.75, 0.6] },
  yellow_star: { src: 'assets/images/Stars_YellowStar.png', size: 0.22, tint: [1, 1, 1] },
}
const DEFAULT_STAR = STAR_SPRITES.yellow_star

/** A dense field of distant stars behind everything. Positions are fixed per sleep session; the field drifts slowly. */
export type Speck = { src: string; x: number; y: number; size: number; depth: number; alpha: number }
const SPECK_SPRITES = ['assets/images/Stars_WhiteStar.png', 'assets/images/Stars_BlueGiant.png', 'assets/images/Stars_YellowStar.png', 'assets/images/Stars_RedDwarf.png', 'assets/images/Stars_WhiteStar.png', 'assets/images/Stars_YellowStar.png']
const STAR_COUNT = 30   // bright near-field stars over the textured backdrops

const VIEW_PREF = 'sleepView'
const DRIFT = [0.18, 0.25]           // % of width per second per nebula patch
const SPECK_DRIFT = 0.12             // the star field creeps

let active = false
let viewIndex = 0
let time = 0
let system: StarSystem | null = null
let specks: Speck[] = []
let celestials: Celestial[] = []

// Fade: world → black → room on the way in; room → black → world on the way out.
type Phase = 'off' | 'dimming' | 'revealing' | 'asleep' | 'closing' | 'waking'
const FADE_SECONDS: Record<Phase, number> = { off: 0, dimming: 1.2, revealing: 2.2, asleep: 0, closing: 1.5, waking: 1.2 }
let phase: Phase = 'off'
let phaseT = 0

/** True from the first frame of the fade-in until the fade-out has finished (the HUD stays hidden throughout). */
export function isSleeping(): boolean { return phase !== 'off' }
/** Whether the bedroom composite is drawn (false while the world is fading to or from black). */
export function sleepSceneVisible(): boolean { return phase === 'revealing' || phase === 'asleep' || phase === 'closing' }
/** Opacity of the black curtain over everything, 0..1. */
export function sleepCurtain(): number {
  const k = FADE_SECONDS[phase] > 0 ? Math.min(1, phaseT / FADE_SECONDS[phase]) : 1
  const ease = k * k * (3 - 2 * k)
  switch (phase) {
    case 'dimming': return ease
    case 'revealing': return 1 - ease
    case 'closing': return ease
    case 'waking': return 1 - ease
    default: return 0
  }
}
export function sleepView(): { src: string; aspect: number } { return SLEEP_VIEWS[viewIndex] ?? SLEEP_VIEWS[0] }
/** 0..1 position along the pan, starting centred and easing back and forth. */
export function panFraction(): number { return 0.5 + 0.5 * Math.sin((time / PAN_PERIOD_SECONDS) * Math.PI * 2) }
export function sleepViewIndex(): number { return viewIndex }
export function sleepTime(): number { return time }
export function sleepSpecks(): Speck[] { return specks }
export function sleepCelestials(): Celestial[] { return celestials }
export function setSleepSystem(s: StarSystem | null): void { system = s }

/** Where the local star sits in the window, as % of room height. */
export const STAR_Y = 26
/** Vertical offset of the galactic plane from the local star, in % of room height: above the plane (positive
 *  coord_z) you look down on the band, so it sits below the star; below the plane it rises above. Systems are
 *  mostly within ±20 of the plane (never past ±50), so ±25 maps to the full ±28% swing. */
export function galacticPlaneOffset(): number {
  const z = system?.coord_z ?? 0
  return Math.max(-1, Math.min(1, z / 25)) * 28
}

const MIN_TRAVEL_FRACTION = 0.06   // same as the bridge window: a findable speck at departure

/** The local star; in transit, the destination star grown in proportion to the distance covered (as the window does). */
export function starSprite(): { src: string; size: number; tint: [number, number, number] } {
  const dest = getTravelDestination()
  const sprite = STAR_SPRITES[(dest ?? system)?.star_type ?? ''] ?? DEFAULT_STAR
  if (!dest) return sprite
  return { ...sprite, size: sprite.size * Math.max(MIN_TRAVEL_FRACTION, getTravelFraction()) }
}

export function enterSleepMode(): void {
  if (phase !== 'off') return
  viewIndex = Math.min(Math.max(0, getPref<number>(VIEW_PREF, 0)), SLEEP_VIEWS.length - 1)
  time = 0
  specks = makeSpecks(STAR_COUNT)
  celestials = makeCelestials(CELESTIAL_COUNT)
  active = true
  phase = 'dimming'; phaseT = 0
}

export function wake(): void {
  if (phase === 'off' || phase === 'closing' || phase === 'waking') return
  // Waking mid fade-in starts the close from the current darkness so there's no jump.
  if (phase === 'dimming') { phase = 'waking'; phaseT = FADE_SECONDS.waking * (1 - sleepCurtain()); return }
  const c = sleepCurtain()
  phase = 'closing'; phaseT = FADE_SECONDS.closing * c
}

export function setSleepView(i: number): void {
  viewIndex = ((i % SLEEP_VIEWS.length) + SLEEP_VIEWS.length) % SLEEP_VIEWS.length
  setPref(VIEW_PREF, viewIndex)
}

/** Horizontal travel in % for a drifting layer, wrapping every `wrap` percent. */
export function layerOffset(speed: number, wrap: number): number { return (time * speed) % wrap }
/** The local star holds its place in the window; only a faint breathing in scale. */
export function starOffset(): { scale: number } { return { scale: 1 + Math.sin(time * 0.2) * 0.012 } }
export const driftSpeeds = { nebula: DRIFT, speck: SPECK_DRIFT }

function makeSpecks(n: number): Speck[] {
  const out: Speck[] = []
  for (let i = 0; i < n; i++) {
    const bright = Math.random()
    out.push({ src: SPECK_SPRITES[Math.floor(Math.random() * SPECK_SPRITES.length)], x: Math.random() * 200, y: Math.random() * 100, size: 0.25 + bright * bright * 1.4, depth: 0.4 + Math.random() * 0.8, alpha: 0.45 + bright * 0.55 })
  }
  return out
}

function makeCelestials(n: number): Celestial[] {
  const out: Celestial[] = []
  for (let i = 0; i < n; i++) {
    const far = Math.random()
    out.push({ cell: Math.floor(Math.random() * ATLAS.cols * ATLAS.rows), x: Math.random() * 200, y: Math.random() * 100, size: 1.2 + (1 - far) * 2.6, depth: 0.3 + far * 0.5, alpha: 0.5 + (1 - far) * 0.4 })
  }
  return out
}

engine.addSystem((dt: number) => {
  if (phase === 'off') return
  if (sleepSceneVisible()) time += dt
  phaseT += dt
  if (FADE_SECONDS[phase] > 0 && phaseT >= FADE_SECONDS[phase]) {
    phaseT = 0
    if (phase === 'dimming') phase = 'revealing'
    else if (phase === 'revealing') phase = 'asleep'
    else if (phase === 'closing') phase = 'waking'
    else if (phase === 'waking') { phase = 'off'; active = false }
  }
})
