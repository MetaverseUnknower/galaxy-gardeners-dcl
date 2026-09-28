// Streamed soundtrack: a themed playlist from the API played through one AudioStream entity.
// Tracks are hosted in the public "music" bucket, so nothing ships with the scene. The theme follows
// the same rule as the iOS app: docked → space station; black hole star → black hole; otherwise by
// distance from the core (inner < 300, central < 600, else outer rim). The title theme plays until
// the player's system is known. Advances on the track's known duration (the explorer does not report
// stream end for static files).
import { engine, AudioStream, Entity, MediaState } from '@dcl/sdk/ecs'
import * as api from './api'
import { getPref, setPref } from './prefs'
import { StarSystem } from './types'

export type Track = { id: string; title: string; artist: string | null; url: string; theme: string | null; durationSeconds: number }
export type Theme = 'theme' | 'inner-galaxy' | 'central-ring' | 'outer-rim' | 'black-hole' | 'space-station'

const VOLUME = 0.5
// The explorer reports no "ended" state for streams, and a finished stream can start over. So the playing time
// is counted only while the stream reports PLAYING (loading/buffering don't count), and the next track starts
// just before the end, before a restart can happen.
const END_LEAD_SECONDS = 0.75
let wasPlaying = false
const MUTED_PREF = 'soundtrackMuted'

let tracks: Track[] = []
let queue: Track[] = []          // shuffled tracks of the active theme
let position = 0
let theme: Theme = 'theme'
let player: Entity | null = null
let elapsed = 0
let muted = false
let started = false
let duck = 1                    // 0..1 multiplier on the volume (the Hawking drift drains the music)
let listener: (() => void) | null = null
let holdSeconds = 0             // soundtrack paused while a fanfare plays

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
  AudioStream.createOrReplace(player, { url: queue[position].url, playing: !muted, volume: VOLUME * duck })
  elapsed = 0
  wasPlaying = false
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
  wasPlaying = false   // a deliberate pause, not the track finishing
  setPref(MUTED_PREF, on)
  if (player && AudioStream.has(player)) AudioStream.getMutable(player).playing = !on && holdSeconds <= 0
  listener?.()
}

export function toggleMuted(): void { setMuted(!muted) }

/** Scale the music's volume, 0..1 (1 = normal). The stream has no speed or pitch control, only volume. */
export function setSoundtrackDuck(f: number): void {
  const next = Math.max(0, Math.min(1, f))
  if (Math.abs(next - duck) < 0.005) return
  duck = next
  if (player && AudioStream.has(player)) AudioStream.getMutable(player).volume = VOLUME * duck
}

/** Pause the music for a fanfare and resume afterwards (the track picks up where it stopped). */
export function holdSoundtrack(seconds: number): void {
  holdSeconds = Math.max(holdSeconds, seconds)
  wasPlaying = false   // a deliberate pause, not the track finishing
  if (player && AudioStream.has(player)) AudioStream.getMutable(player).playing = false
}

function soundtrackSystem(dt: number): void {
  if (!started || muted || queue.length === 0) return
  if (holdSeconds > 0) {
    holdSeconds -= dt
    if (holdSeconds <= 0 && player && AudioStream.has(player)) AudioStream.getMutable(player).playing = true
    return
  }
  const state = player ? AudioStream.getAudioState(player)?.state : undefined
  const playing = state === undefined ? true : state === MediaState.MS_PLAYING   // no reports: fall back to wall time
  const duration = queue[position].durationSeconds
  if (playing) elapsed += dt
  // Backstop: the stream stopped by itself near the end (finished) — move on now rather than let it restart.
  if (wasPlaying && !playing && state !== MediaState.MS_BUFFERING && elapsed >= duration * 0.9) { wasPlaying = false; nextTrack(); return }
  wasPlaying = playing
  if (elapsed >= duration - END_LEAD_SECONDS) nextTrack()
}
