// What a wormhole at a system offers the captain, and pressing it. The star panel's buttons and the system view's
// portals both go through here, so they always offer the same thing.
import { wormholeEvent, isWormholeBusy, jumpThroughWormhole, returnThroughWormhole, jumpThroughBlackHole } from './state'
import { BlackHoleLink, armBlackHoleJump } from './blackHole'

export type EventOffer = 'jump' | 'return'

/** The open event's wormhole at `systemId`: return (the ship is `here`, through it), jump there, or nothing. */
export function eventWormholeOffer(systemId: string, here: boolean): EventOffer | null {
  const ev = wormholeEvent()
  if (!ev || systemId !== ev.targetSystemId) return null
  if (ev.canReturn && here) return 'return'
  return ev.canJump ? 'jump' : null
}

export function useEventWormhole(offer: EventOffer): void {
  if (isWormholeBusy()) return
  void (offer === 'return' ? returnThroughWormhole() : jumpThroughWormhole())
}

/** First press: STEM warns there's no solar recharge on the far side. A second within ARM_SECONDS jumps. */
export function pressBlackHoleJump(link: BlackHoleLink, fuel: number | null, say: (text: string) => void): void {
  if (isWormholeBusy()) return
  if (armBlackHoleJump() === 'go') { void jumpThroughBlackHole(); return }
  const have = fuel !== null ? ` We have ${Math.floor(fuel)} fuel.` : ''
  say(`This wormhole drops us at ${link.targetName}, another black hole: no solar recharge there, Captain.${have} Make sure it's enough to fly back out. Press again to jump.`)
}
