// Sleep mode: a full-screen 2D composite of a bedroom window looking out on the current system, drifting
// slowly as if the ship were turning in orbit. Purely visual; the HUD hides while asleep.
import { engine } from '@dcl/sdk/ecs'
import { getPref, setPref } from './prefs'
import { StarSystem } from './types'

export const SLEEP_VIEWS = [
  'assets/images/DaisyClass-SleepView2.png',
  'assets/images/DaisyClass-SleepView3.png',
  'assets/images/DaisyClass-SleepView4.png',
  // SleepView1 is exported without an alpha channel (checkerboard window); add it here once re-exported.
]
export const NEBULAE = ['assets/images/Stars_Nebula.png', 'assets/images/Stars_Nebula2.png', 'assets/images/Stars_Nebula3.png']

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

/** Distant specks sprinkled behind the nebulae until a celestial atlas lands. Positions are fixed per session. */
export type Speck = { src: string; x: number; y: number; size: number; depth: number }
const SPECK_SPRITES = ['assets/images/Stars_WhiteStar.png', 'assets/images/Stars_BlueGiant.png', 'assets/images/Stars_YellowStar.png', 'assets/images/Stars_RedDwarf.png']

const VIEW_PREF = 'sleepView'
const DRIFT = [0.55, 0.9, 1.35]      // % of screen width per second per nebula layer, back to front
const STAR_DRIFT = 0.25              // the star is farthest away: barely moves
const SPECK_DRIFT = 0.4

let active = false
let viewIndex = 0
let time = 0
let system: StarSystem | null = null
let specks: Speck[] = []

export function isSleeping(): boolean { return active }
export function sleepView(): string { return SLEEP_VIEWS[viewIndex] ?? SLEEP_VIEWS[0] }
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
  specks = makeSpecks(28)
  active = true
}

export function wake(): void { active = false }

export function setSleepView(i: number): void {
  viewIndex = ((i % SLEEP_VIEWS.length) + SLEEP_VIEWS.length) % SLEEP_VIEWS.length
  setPref(VIEW_PREF, viewIndex)
}

/** Horizontal offset in % for a layer that is 200% wide, wrapping so two copies always cover the screen. */
export function layerOffset(speed: number): number { return (time * speed) % 200 }
export function starOffset(): { x: number; y: number; scale: number } {
  return { x: Math.sin(time * 0.05) * 4 + Math.sin(time * 0.013) * 3, y: Math.cos(time * 0.037) * 2, scale: 1 + Math.sin(time * 0.2) * 0.015 }
}
export const driftSpeeds = { nebula: DRIFT, star: STAR_DRIFT, speck: SPECK_DRIFT }

function makeSpecks(n: number): Speck[] {
  const out: Speck[] = []
  for (let i = 0; i < n; i++) {
    out.push({ src: SPECK_SPRITES[Math.floor(Math.random() * SPECK_SPRITES.length)], x: Math.random() * 200, y: Math.random() * 100, size: 0.6 + Math.random() * 1.6, depth: 0.5 + Math.random() })
  }
  return out
}

engine.addSystem((dt: number) => { if (active) time += dt })
