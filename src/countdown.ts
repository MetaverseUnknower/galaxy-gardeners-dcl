// Live countdowns: panels draw their timers once, so each registers what its timers currently read and how to
// redraw them. Once a second the readings are compared; a section is redrawn only when its text would change
// (timers show whole minutes, so that is about once a minute, plus the moment one turns READY).
import { engine } from '@dcl/sdk/ecs'

type Watcher = { read: () => string; redraw: () => void; last: string }
const watchers: Watcher[] = []
let acc = 0

/** `read` returns what the section's timers show right now ('' when the section isn't on screen). */
export function redrawWhenCountdownChanges(read: () => string, redraw: () => void): void {
  watchers.push({ read, redraw, last: read() })
}

/** Whole minutes left until an ISO time, or -1 when there is none (matches how the panels display it). */
export function minutesUntil(iso: string | null | undefined): number {
  if (!iso) return -1
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000))
}

engine.addSystem((dt: number) => {
  acc += dt
  if (acc < 1) return
  acc = 0
  for (const w of watchers) {
    const now = w.read()
    if (now === w.last) continue
    w.last = now
    if (now !== '') w.redraw()
  }
})
