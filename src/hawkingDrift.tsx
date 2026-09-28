// Hawking drift: what staring into the black hole hologram does to the captain (systemView.ts runs the stare).
// While staring, a dark violet veil throbs over the view, faster the longer it goes on; then the drift itself: a
// blackout, the move (midpoint), and an uneven flicker back to sight, like lost time.
// Sound: a low drone swells in and slides down in pitch, like time stretching, and the music stops at the blackout
// and picks up again afterwards. The drone's swell and slide are baked into the clip (played once, like the
// fanfares): in testing, changing a playing clip's volume and pitch did nothing audible, and ramping the music
// stream's volume made it crackle, so nothing here changes audio while it plays.
import ReactEcs, { UiEntity } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, AudioSource, Entity, Transform } from '@dcl/sdk/ecs'
import { isMuted, holdSoundtrack } from './soundtrack'

const DRONE_CLIP = 'assets/audio/hawking_drone.mp3'   // 5.3 s, generated: 80 Hz → 40 Hz beating pair + overtones
let drone: Entity | null = null
let droneOn = false

function startDrone(): void {
  if (droneOn || isMuted()) return
  if (!drone) {
    drone = engine.addEntity()
    Transform.create(drone, { parent: engine.CameraEntity })   // at the listener, like the fanfares
  }
  AudioSource.createOrReplace(drone, { audioClipUrl: DRONE_CLIP, playing: true, loop: false, volume: 1, global: true })
  droneOn = true
}

function stopDrone(): void {
  if (!drone || !droneOn) return
  AudioSource.deleteFrom(drone)
  droneOn = false
}

const VEIL_START = 3        // seconds of staring before the veil appears
const VEIL_MAX = 0.6        // veil opacity just before the drift
// Drift timeline: [seconds, opacity] keyframes, linear between them; the move happens at MIDPOINT (fully dark)
const DRIFT: [number, number][] = [
  [0, 0.6], [0.3, 1], [1.1, 1], [1.2, 0.15], [1.3, 0.9], [1.45, 0.05], [1.55, 0.8], [1.9, 0.75], [2.0, 0.1], [2.1, 0.5], [2.8, 0],
]
const MIDPOINT = 0.6
const DURATION = DRIFT[DRIFT.length - 1][0]

let stare: number | null = null   // seconds of staring so far, or null when not staring
let veil = 0
let driftT = -1
let midpoint: (() => void) | null = null
let done: (() => void) | null = null

/** Seconds the player has been staring, or null once they look away. */
export function setStareTime(t: number | null): void { stare = t }

/** Plays the drift: `onMidpoint` runs while the screen is dark, `onDone` once the view is back. */
export function playHawkingDrift(onMidpoint: () => void, onDone: () => void): void {
  driftT = 0
  midpoint = onMidpoint
  done = onDone
}

function keyframe(t: number): number {
  for (let i = 1; i < DRIFT.length; i++) {
    const [t1, a1] = DRIFT[i]
    if (t <= t1) {
      const [t0, a0] = DRIFT[i - 1]
      return a0 + (a1 - a0) * ((t - t0) / (t1 - t0))
    }
  }
  return 0
}

let pulse = 0
engine.addSystem((dt: number) => {
  if (driftT >= 0) {
    const before = driftT
    driftT += dt
    if (before === 0) holdSoundtrack(DURATION + 0.5)   // the music stops for the blackout and resumes after
    if (before < DRIFT[1][0] && driftT >= DRIFT[1][0]) stopDrone()   // silence at full dark
    if (before < MIDPOINT && driftT >= MIDPOINT && midpoint) { const fn = midpoint; midpoint = null; fn() }
    if (driftT >= DURATION) { driftT = -1; veil = 0; const fn = done; done = null; fn?.() }
    else veil = keyframe(driftT)
    return
  }
  if (stare !== null && stare > VEIL_START) {
    const k = Math.min(1, (stare - VEIL_START) / 5)
    pulse += dt * (2 + 10 * k)   // the throb quickens
    veil = VEIL_MAX * k * (0.7 + 0.3 * Math.sin(pulse))
    startDrone()   // once per stare; the clip's own 5.3 s swell lines up with the veil
  } else {
    if (veil > 0) veil = Math.max(0, veil - dt * 1.5)   // looked away: the veil lifts
    stopDrone()
  }
})

export const HawkingOverlay = () => {
  if (veil <= 0.001) return null
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: '100%', positionType: 'absolute', position: { top: 0, left: 0 }, pointerFilter: 'none' }}
      uiBackground={{ color: Color4.create(0.04, 0, 0.08, veil) }}
    />
  )
}
