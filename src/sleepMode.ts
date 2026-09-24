// Sleep mode: a full-screen 2D composite of a bedroom window looking out on the current system, drifting
// slowly as if the ship were turning in orbit. Purely visual; the HUD hides while asleep.
import { engine } from '@dcl/sdk/ecs'
import { getPref, setPref } from './prefs'
import { StarSystem } from './types'

// Bedrooms are used at their native size and aspect: the overlay fits them to the screen height ("contain")
// and pans slowly when the fitted image is wider than the screen.
export const SLEEP_VIEWS: { src: string; aspect: number }[] = [
  { src: 'assets/images/DaisyClass-SleepView1.png', aspect: 1647 / 955 },
  { src: 'assets/images/DaisyClass-SleepView2.png', aspect: 1644 / 957 },
  { src: 'assets/images/DaisyClass-SleepView3.png', aspect: 1644 / 957 },
  { src: 'assets/images/DaisyClass-SleepView4.png', aspect: 1672 / 940 },
]
const PAN_PERIOD_SECONDS = 300   // one full left-right-left sweep
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
const STAR_COUNT = 160

const VIEW_PREF = 'sleepView'
const DRIFT = [0.18, 0.25]           // % of width per second per nebula patch
const SPECK_DRIFT = 0.12             // the star field creeps

let active = false
let viewIndex = 0
let time = 0
let system: StarSystem | null = null
let specks: Speck[] = []

export function isSleeping(): boolean { return active }
export function sleepView(): { src: string; aspect: number } { return SLEEP_VIEWS[viewIndex] ?? SLEEP_VIEWS[0] }
/** 0..1 position along the pan, starting centred and easing back and forth. */
export function panFraction(): number { return 0.5 + 0.5 * Math.sin((time / PAN_PERIOD_SECONDS) * Math.PI * 2) }
export function sleepViewIndex(): number { return viewIndex }
export function sleepTime(): number { return time }
export function sleepSpecks(): Speck[] { return specks }
export function setSleepSystem(s: StarSystem | null): void { system = s }

export function starSprite(): { src: string; size: number; tint: [number, number, number] } {
  return STAR_SPRITES[system?.star_type ?? ''] ?? DEFAULT_STAR
}

export function enterSleepMode(): void {
  if (active) return
  viewIndex = Math.min(Math.max(0, getPref<number>(VIEW_PREF, 0)), SLEEP_VIEWS.length - 1)
  time = 0
  specks = makeSpecks(STAR_COUNT)
  active = true
}

export function wake(): void { active = false }

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

engine.addSystem((dt: number) => { if (active) time += dt })
