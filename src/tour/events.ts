// Real player actions the ship tour waits for. The deploy and docking code report them here so the tour
// doesn't poll the server.
export type TourEvent = 'exploration_deployed' | 'mining_deployed' | 'docked'

const listeners: ((e: TourEvent) => void)[] = []
export function onTourEvent(fn: (e: TourEvent) => void): void { listeners.push(fn) }
export function emitTourEvent(e: TourEvent): void { for (const fn of listeners) fn(e) }
