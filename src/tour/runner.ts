// Runs the STEM ship tour: one scene at a time, one step at a time, one STEM line at a time. Camera shots and desk
// tabs are set per step; hands-on steps release the camera and wait for the real action (tour events). Progress is
// stored per scene on the server; a replay after completion or skip touches nothing on the server.
import { engine } from '@dcl/sdk/ecs'
import * as api from '../api'
import { TOUR, TourScene, Step, fill } from './script'
import { TourEvent, onTourEvent } from './events'
import { setupTourShots, applyShot, releaseShot } from './shots'
import { setTourDialog, DialogState } from './dialog'
import { showStationView } from '../stations'
import { switchViewMode, getViewMode } from '../galaxyMap'
import { isDocked } from '../docking'
import { isCurrentlyTraveling } from '../navigation'
import { isSleeping } from '../sleepMode'
import { getPref, setPref } from '../prefs'

const OFFER_PREF = 'tourOffered'
const OFFER_LINE = 'Want a tour of the ship, Captain? I can show you the desks and get your first pods out.'

// busy: a step change is awaiting the server; NEXT is hidden so repeated presses can't skip steps.
type Run = { sceneIdx: number; stepIdx: number; lineIdx: number; waiting: boolean; busy: boolean; confirmSkip: boolean; tracked: boolean; resumeLine: string | null; blocked: string | null }
let run: Run | null = null
let offering = false
let data: Record<number, Record<string, any>> = {}
let sleptWith = false
let scannedThisRun = false   // an exploration pod went out during this tour run (the wrap-up mentions it)

export function isTourRunning(): boolean { return run !== null }

function scene(): TourScene | null { return run ? TOUR[run.sceneIdx] ?? null : null }
function step(): Step | null { const s = scene(); return s && run ? s.steps[run.stepIdx] ?? null : null }
function sceneData(): Record<string, any> { const s = scene(); return s ? data[s.number] ?? {} : {} }

async function loadSceneData(n: number): Promise<void> {
  if (data[n]) return
  let d: Record<string, any> = {}
  try { d = await api.getWalkthroughSceneData(n) } catch { /* lines fall back to their generic wording */ }
  // Lines that depend on where the ship is (scene data describes the current system) or on what happened this run
  d.introLine = d.isHome === false
    ? `This is ${d.starName ?? 'the system we\'re in'} on the hologram — where we are right now. Your home system is elsewhere, but every system works the same way.`
    : 'This is your home system on the hologram. Every explorer gets one — a patch of the galaxy to call their own.'
  d.stationLine = d.hasStation === false
    ? "There's no space station in this system. Stations are scattered across the galaxy — we'll dock at one later."
    : `This system has a space station — ${d.stationName ?? 'right here'}. We'll dock there later.`
  d.scanLine = scannedThisRun
    ? `Your exploration pod is still scanning ${d.firstExpeditionPlanet ?? 'its planet'}. When it returns you'll have your first sample and your first catalog entry.`
    : 'Send an exploration pod to a living planet whenever you\'re ready — the first scan gives you your first sample and your first catalog entry.'
  data[n] = d
}

/** Why a hands-on step can't be done right now (null when it can). */
async function blockedReason(wait: TourEvent): Promise<string | null> {
  if (isCurrentlyTraveling()) return "We're in transit, Captain, so that will have to wait until we arrive."
  const d = sceneData()   // describes the system the ship is in
  if (wait === 'exploration_deployed') {
    if (!d.targetPlanet || d.targetPlanet.supportsLife === false) return "There's no living planet in range for a first scan, so let's move on."
    if (d.availableExplorationPods === 0) return 'Every exploration pod is already out, so let\'s move on.'
  }
  if (wait === 'mining_deployed') {
    if (!d.targetBelt || d.targetBelt.riskLevel !== 'low') return "There's no safe belt in range right now, so let's move on."
    if (d.availableMiningPods === 0) return "Every mining pod is already out, so let's move on."
  }
  if (wait === 'docked' && !d.homeStationId) return "There's no station in this system, so docking will have to wait."
  return null
}

/** True when the step's action already happened (a reload after deploying or docking). */
async function alreadyDone(wait: TourEvent): Promise<boolean> {
  if (wait === 'docked') return isDocked()
  try {
    const dash = await api.getShipDashboard()
    const type = wait === 'mining_deployed' ? 'mining' : 'exploration'
    // Finished but not yet collected counts too (a safe scan is done in minutes)
    return (dash?.activeExpeditions || []).some((e: any) => e.expedition_type === type && e.status !== 'collected')
  } catch { return false }
}

function applySetup(st: Step): void {
  switch (st.setup) {
    case 'systemView': if (getViewMode() !== 'system') switchViewMode('system'); break
    case 'galaxyView': if (getViewMode() !== 'galaxy') switchViewMode('galaxy'); break
    case 'shipOverview': void showStationView('ship', 'overview'); break
    case 'podOperations': void showStationView('ship', 'pods'); break
    case 'shipSystems': void showStationView('ship', 'systems'); break
    case 'floraSummary': void showStationView('flora', 'summary'); break
    case 'floraVault': void showStationView('flora', 'vault'); break
  }
}

function render(): void {
  if (offering) {
    const s: DialogState = { lines: [OFFER_LINE], index: 0, waiting: false, busy: false, last: false, confirmSkip: false, offer: true }
    setTourDialog(s, handlers)
    return
  }
  const st = step()
  if (!run || !st) { setTourDialog(null, null); return }
  const lines = run.blocked ? [run.blocked] : (run.resumeLine ? [run.resumeLine] : []).concat(st.lines.map(l => fill(l, sceneData())))
  const sc = scene()!
  const lastStep = run.sceneIdx === TOUR.length - 1 && run.stepIdx === sc.steps.length - 1
  setTourDialog({
    lines, index: Math.min(run.lineIdx, lines.length - 1),
    panel: st.panel ? { title: st.panel.title, text: fill(st.panel.text, sceneData()) } : undefined,
    waiting: run.waiting, busy: run.busy, last: lastStep, confirmSkip: run.confirmSkip, offer: false,
  }, handlers)
}

async function enterStep(): Promise<void> {
  const st = step()
  if (!run || !st) return
  run.lineIdx = 0
  run.waiting = false
  run.busy = false
  run.blocked = null
  applySetup(st)
  applyShot(st.shot)
  render()
}

/** Called when the player has read the last line of a step. */
async function finishStepLines(): Promise<void> {
  const st = step()
  const r = run
  if (!r || !st) return
  if (r.blocked) return advanceStep()   // the player has read why the step can't be done
  if (st.waitFor) {
    r.busy = true
    render()
    const done = await alreadyDone(st.waitFor)
    if (run !== r) return   // skipped or replaced while waiting on the server
    if (done) { if (st.waitFor === 'exploration_deployed') scannedThisRun = true; return advanceStep() }
    const why = await blockedReason(st.waitFor)
    if (run !== r) return
    r.busy = false
    if (why) {
      // Say why; NEXT then moves on (finishStepLines sees run.blocked).
      run.blocked = why
      run.lineIdx = 0
      render()
      return
    }
    run.waiting = true
    releaseShot()   // the player needs their own camera to click the hologram or the console
    render()
    return
  }
  return advanceStep()
}

async function advanceStep(): Promise<void> {
  const r = run
  if (!r) return
  r.resumeLine = null
  r.waiting = false
  const sc = scene()!
  if (r.stepIdx < sc.steps.length - 1) { r.stepIdx++; return enterStep() }
  r.busy = true
  render()
  // Next scene
  if (r.sceneIdx < TOUR.length - 1) {
    const n = TOUR[r.sceneIdx + 1].number
    if (r.tracked) { try { await api.walkthroughProgress('advance', n) } catch { /* progress is best effort */ } }
    await loadSceneData(n)
    if (run !== r) return   // skipped or replaced while waiting on the server
    r.sceneIdx++
    r.stepIdx = 0
    return enterStep()
  }
  // Finished
  if (r.tracked) { try { await api.walkthroughProgress('complete') } catch { /* best effort */ } }
  if (run === r) end()
}

function end(): void {
  run = null
  releaseShot()
  setTourDialog(null, null)
}

const handlers = {
  next(): void {
    if (!run || run.waiting || run.busy) return
    const st = step()
    const total = run.blocked ? 1 : (run.resumeLine ? 1 : 0) + (st?.lines.length ?? 0)
    if (run.lineIdx < total - 1) { run.lineIdx++; render(); return }
    run.busy = true
    render()
    void finishStepLines()
  },
  // A hands-on step the player can't or won't do (e.g. the deploy failed): move on without it.
  moveOn(): void {
    if (!run || !run.waiting || run.busy) return
    void advanceStep()
  },
  skip(): void { if (run) { run.confirmSkip = true; render() } },
  confirmSkip(yes: boolean): void {
    if (!run) return
    if (!yes) { run.confirmSkip = false; render(); return }
    if (run.tracked) void api.walkthroughProgress('skip').catch(() => { /* best effort */ })
    end()
  },
  offer(yes: boolean): void {
    offering = false
    setPref(OFFER_PREF, true)
    if (!yes) { setTourDialog(null, null); return }
    void (async () => {
      let tracked = false
      try { await api.walkthroughProgress('restart'); tracked = true } catch { /* refused: run as a replay */ }
      await begin(0, tracked, null)
    })()
  },
}

async function begin(sceneIdx: number, tracked: boolean, resumeLine: string | null): Promise<void> {
  data = {}
  scannedThisRun = false
  await loadSceneData(TOUR[sceneIdx].number)
  run = { sceneIdx, stepIdx: 0, lineIdx: 0, waiting: false, busy: false, confirmSkip: false, tracked, resumeLine, blocked: null }
  await enterStep()
}

export function setupTour(): void {
  setupTourShots()
  onTourEvent((e) => {
    const st = step()
    if (!run || !run.waiting || st?.waitFor !== e) return
    if (e === 'exploration_deployed') scannedThisRun = true
    void advanceStep()
  })
  // Sleep: release the tour camera while asleep, re-apply the step's shot on waking.
  let acc = 0
  engine.addSystem((dt: number) => {
    acc += dt
    if (acc < 0.5) return
    acc = 0
    const asleep = isSleeping()
    if (asleep && !sleptWith && run && !run.waiting) { releaseShot(); sleptWith = true }
    else if (!asleep && sleptWith) { sleptWith = false; const st = step(); if (run && st && !run.waiting) applyShot(st.shot) }
  })
}

/** On load: start or resume the tour for a player mid-walkthrough, or make the one-time offer. */
export async function startTourIfNeeded(): Promise<void> {
  let state: api.WalkthroughState
  try { state = await api.getWalkthroughState() } catch { return }
  if (!state.walkthroughCompleted && !state.walkthroughSkipped) {
    const idx = Math.max(0, TOUR.findIndex(s => s.number === state.walkthroughScene))
    const resume = state.walkthroughScene > 0 ? TOUR[idx].resume : null
    await begin(idx, true, resume)
    return
  }
  if (state.walkthroughSkipped && !state.walkthroughCompleted && !getPref<boolean>(OFFER_PREF, false)) {
    offering = true
    render()
  }
}

/** From the STEM chat: run the tour from the start without touching server progress. */
export function replayTour(): void {
  if (run) return
  offering = false
  void begin(0, false, null)
}
