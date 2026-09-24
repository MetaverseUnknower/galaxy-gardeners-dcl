// Streamed soundtrack: a playlist from the API played through one AudioStream entity.
// Tracks are hosted in the public "music" bucket, so nothing ships with the scene. Advances on the
// track's known duration (the explorer does not report stream end for static files).
import { engine, AudioStream, Entity } from '@dcl/sdk/ecs'
import * as api from './api'
import { getPref, setPref } from './prefs'

export type Track = { id: string; title: string; artist: string | null; url: string; durationSeconds: number }

const VOLUME = 0.5
const TRACK_GAP_SECONDS = 2     // slack for buffering before moving on
const MUTED_PREF = 'soundtrackMuted'

let tracks: Track[] = []
let index = 0
let player: Entity | null = null
let elapsed = 0
let muted = false
let started = false
let listener: (() => void) | null = null

export function isMuted(): boolean { return muted }
export function currentTrack(): Track | null { return started && tracks.length ? tracks[index] : null }
export function setSoundtrackChangedListener(fn: (() => void) | null): void { listener = fn }

/** Fetches the playlist and starts playing; silent no-op if there are no tracks or the fetch fails. */
export async function startSoundtrack(): Promise<void> {
  muted = getPref<boolean>(MUTED_PREF, false)
  try { tracks = (await api.getSoundtrack()).tracks ?? [] } catch { tracks = [] }
  if (tracks.length === 0) return
  player = engine.addEntity()
  index = 0
  started = true
  play()
  engine.addSystem(soundtrackSystem)
}

function play(): void {
  if (!player) return
  AudioStream.createOrReplace(player, { url: tracks[index].url, playing: !muted, volume: VOLUME })
  elapsed = 0
  listener?.()
}

export function nextTrack(): void {
  if (!started) return
  index = (index + 1) % tracks.length
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
  if (!started || muted) return
  elapsed += dt
  if (elapsed >= tracks[index].durationSeconds + TRACK_GAP_SECONDS) nextTrack()
}
