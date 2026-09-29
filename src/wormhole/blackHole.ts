// Black hole wormholes: every black hole has one, linked to another black hole in the galaxy once a second is found
// (the server links them). From a linked black hole the ship can jump to the other, instantly and free; the star
// panel offers it and asks once, since there's no solar recharge on the far side. The jump itself is state.ts's.
import * as api from '../api'
import { StarSystem } from '../types'

export type BlackHoleLink = { systemId: string; targetId: string; targetName: string }
export const ARM_SECONDS = 8   // how long the confirm stays up after the first press

let link: BlackHoleLink | null = null
let armedAt = -Infinity

/** Where this system's wormhole leads, if it's a black hole whose wormhole is linked. */
export function blackHoleLink(systemId: string): BlackHoleLink | null { return link && link.systemId === systemId ? link : null }

/** Looks up the system's wormhole (only asks the server about systems that have one). */
export async function loadBlackHoleLink(system: StarSystem | null): Promise<void> {
  if (!system?.has_wormhole) return
  if (link?.systemId === system.id) return
  try {
    const detail = await api.getSystemDetail(system.id)
    const w = detail?.wormhole
    if (w?.targetSystemId) link = { systemId: system.id, targetId: w.targetSystemId, targetName: w.targetSystemName }
  } catch { /* no button this time */ }
}

/** First press asks ('armed'); a second within ARM_SECONDS jumps ('go'). */
export function armBlackHoleJump(nowMs: number = Date.now()): 'armed' | 'go' {
  if (nowMs - armedAt <= ARM_SECONDS * 1000) { armedAt = -Infinity; return 'go' }
  armedAt = nowMs
  return 'armed'
}
export function isBlackHoleJumpArmed(nowMs: number = Date.now()): boolean { return nowMs - armedAt <= ARM_SECONDS * 1000 }
export function resetBlackHoleArm(): void { armedAt = -Infinity }
