// Bundled fanfares (assets/audio, under 1 MB total) played as global, non-positional clips.
// Same triggers as the iOS app: game start, mining success (extreme variant for high/extreme belts),
// specimen found, pod destroyed. Muting the soundtrack mutes these too.
import { engine, AudioSource, Entity } from '@dcl/sdk/ecs'
import * as api from './api'
import { isMuted, holdSoundtrack } from './soundtrack'

export type Sfx = 'game_start' | 'mining' | 'extreme_mining' | 'specimen' | 'pod_destroyed'

const CLIPS: Record<Sfx, string> = {
  game_start: 'assets/audio/fanfare_game_start.mp3',
  mining: 'assets/audio/fanfare_mining.mp3',
  extreme_mining: 'assets/audio/fanfare_extreme_mining.mp3',
  specimen: 'assets/audio/fanfare_specimen.mp3',
  pod_destroyed: 'assets/audio/fanfare_pod_destroyed.mp3',
}
const GAME_START_SECONDS = 28   // the soundtrack waits this long so the opening fanfare plays clean
const VOLUME = 0.8

let speaker: Entity | null = null
let systemId: string | null = null

export function setSfxSystemId(id: string | null): void { systemId = id }

export function playSfx(name: Sfx): void {
  if (isMuted()) return
  if (!speaker) speaker = engine.addEntity()
  // Replacing the component starts a fresh instance even when the same clip is already playing.
  AudioSource.createOrReplace(speaker, { audioClipUrl: CLIPS[name], playing: true, loop: false, volume: VOLUME, global: true })
  if (name === 'game_start') holdSoundtrack(GAME_START_SECONDS)
}

/** Mining success: the extreme fanfare for high/extreme belts, looked up in the current system's detail. */
export async function playMiningFanfare(beltId: string | null | undefined): Promise<void> {
  let extreme = false
  if (beltId && systemId) {
    try {
      const detail = await api.getSystemDetail(systemId)
      const belt = (detail?.asteroidBelts || []).find((b: any) => b.id === beltId)
      extreme = belt?.risk_level === 'extreme' || belt?.risk_level === 'high'
    } catch { /* unknown belt: regular fanfare */ }
  }
  playSfx(extreme ? 'extreme_mining' : 'mining')
}
