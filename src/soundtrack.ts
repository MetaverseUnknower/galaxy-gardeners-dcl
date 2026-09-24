// Streamed soundtrack: a themed playlist from the API played through one AudioStream entity.
// Tracks are hosted in the public "music" bucket, so nothing ships with the scene. The theme follows
// the same rule as the iOS app: docked → space station; black hole star → black hole; otherwise by
// distance from the core (inner < 300, central < 600, else outer rim). The title theme plays until
// the player's system is known. Advances on the track's known duration (the explorer does not report
// stream end for static files).
import { engine, AudioStream, Entity } from '@dcl/sdk/ecs'
import * as api from './api'
import { getPref, setPref } from './prefs'
import { StarSystem } from './types'

export type Track = { id: string; title: string; artist: string | null; url: string; theme: string | null; durationSeconds: number }
export type Theme = 'theme' | 'inner-galaxy' | 'central-ring' | 'outer-rim' | 'black-hole' | 'space-station'

const VOLUME = 0.5
const TRACK_GAP_SECONDS = 2     // slack for buffering before moving on
const MUTED_PREF = 'soundtrackMuted'

let tracks: Track[] = []
let queue: Track[] = []          // shuffled tracks of the active theme
let position = 0
let theme: Theme = 'theme'
let player: Entity | null = null
let elapsed = 0
let muted = false
let started = false
let listener: (() => void) | null = null

export function isMuted(): boolean { return muted }
export function currentTrack(): Track | null { return started && queue.length ? queue[position] : null }
export function currentTheme(): Theme { return theme }
export function setSoundtrackChangedListener(fn: (() => void) | null): void { listener = fn }

export function themeFor(docked: boolean, system: StarSystem | null): Theme {
  if (docked) return 'space-station'
  if (!system) return 'central-ring'
  if (system.star_type === 'black_hole') return 'black-hole'
  if (system.coord_r < 300) return 'inner-galaxy'
  if (system.coord_r < 600) return 'central-ring'
  return 'outer-rim'
}

/** Fetches the playlist and starts the title theme; silent no-op if there are no tracks or the fetch fails. */
export async function startSoundtrack(): Promise<void> {
  muted = getPref<boolean>(MUTED_PREF, false)
  try { tracks = (await api.getSoundtrack()).tracks ?? [] } catch { tracks = [] }
  if (tracks.length === 0) return
  player = engine.addEntity()
  started = true
  engine.addSystem(soundtrackSystem)
  applyTheme(theme, true)
}

/** Call whenever the player's situation changes; only a theme change interrupts the current track. */
export function setSoundtrackContext(ctx: { docked: boolean; system: StarSystem | null }): void {
  const next = themeFor(ctx.docked, ctx.system)
  if (next === theme && started && queue.length) return
  theme = next
  if (started) applyTheme(next, false)
}

function applyTheme(t: Theme, force: boolean): void {
  let pool = tracks.filter(x => x.theme === t)
  if (pool.length === 0) pool = tracks.filter(x => x.theme !== 'theme')   // theme has no tracks yet: anything but the title song
  if (pool.length === 0) pool = tracks
  queue = shuffle(pool)
  position = 0
  if (force || currentTrack()) play()
}

function shuffle<T>(xs: T[]): T[] {
  const a = xs.slice()
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

function play(): void {
  if (!player || queue.length === 0) return
  AudioStream.createOrReplace(player, { url: queue[position].url, playing: !muted, volume: VOLUME })
  elapsed = 0
  listener?.()
}

export function nextTrack(): void {
  if (!started || queue.length === 0) return
  position = (position + 1) % queue.length
  if (position === 0) queue = shuffle(queue)   // reshuffle each time the theme's pool wraps around
  play()
}

export function setMuted(on: boolean): void {
  muted = on
  setPref(MUTED_PREF, on)
  if (player && AudioStream.has(player)) AudioStream.getMutable(player).playing = !on
  listener?.()
}

export function toggleMuted(): void { setMuted(!muted) }

function soundtrackSystem(dt: number): void {
  if (!started || muted || queue.length === 0) return
  elapsed += dt
  if (elapsed >= queue[position].durationSeconds + TRACK_GAP_SECONDS) nextTrack()
}
