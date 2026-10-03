// Building a station from the ship: the nav console's BUILD STATION opens a dialog (name, costs against the hold), the
// server starts a 24-hour build, the console's station card follows it (building, then OPEN STATION), and opening it
// tells the rest of the ship a new station exists.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const H = 3600_000
let activeReply: any = null
const startConstruction = vi.fn()
const completeConstruction = vi.fn()
const invalidateSystemDetail = vi.fn()
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getConstructionCosts: vi.fn(async () => ({ titanium: 50, quantum_alloy: 30, dark_matter: 15, void_essence: 5 })),
  getActiveConstruction: vi.fn(async () => activeReply),
  startConstruction: (...a: any[]) => startConstruction(...a),
  completeConstruction: (...a: any[]) => completeConstruction(...a),
  invalidateSystemDetail: (...a: any[]) => invalidateSystemDetail(...a),
}))

import {
  costRows, canBegin, stationCard, timeLeftText, loadConstruction, activeBuild, beginConstruction, openStation,
  onConstructionChanged, setStationOpenedCallback, resetConstruction,
} from '../src/construction'

const COSTS = { titanium: 50, quantum_alloy: 30, dark_matter: 15, void_essence: 5 }
const HOLD = [
  { resource_type: 'titanium', quantity: 60 }, { resource_type: 'quantum_alloy', quantity: 30 },
  { resource_type: 'dark_matter', quantity: 4 }, { resource_type: 'iron_ore', quantity: 99 },
]
const build = (over: any = {}) => ({ id: 'c1', systemId: 'sys', stationName: 'Haven', startedAt: 0, completesAt: 24 * H, ...over })

beforeEach(() => { resetConstruction(); activeReply = null; startConstruction.mockReset(); completeConstruction.mockReset() })

describe('the build dialog', () => {
  it('lists each cost against what the hold has, and marks what falls short', () => {
    expect(costRows(COSTS, HOLD)).toEqual([
      { resource: 'titanium', label: 'Titanium', need: 50, have: 60, short: false },
      { resource: 'quantum_alloy', label: 'Quantum Alloy', need: 30, have: 30, short: false },
      { resource: 'dark_matter', label: 'Dark Matter', need: 15, have: 4, short: true },
      { resource: 'void_essence', label: 'Void Essence', need: 5, have: 0, short: true },
    ])
  })
  it("won't begin while anything is short", () => {
    expect(canBegin(costRows(COSTS, HOLD), 'Haven Rest')).toEqual({ ok: false, reason: 'Not enough Dark Matter or Void Essence' })
  })
  it('wants a name of at least 3 characters', () => {
    const rich = costRows(COSTS, Object.entries(COSTS).map(([resource_type, quantity]) => ({ resource_type, quantity })))
    expect(canBegin(rich, '  Ab ')).toEqual({ ok: false, reason: 'Name the station (3 characters or more)' })
    expect(canBegin(rich, 'Haven Rest')).toEqual({ ok: true })
  })
})

describe('the station card', () => {
  it('offers the slot when nobody aboard is building', () => {
    expect(stationCard('sys', null, 0)).toEqual({ kind: 'available' })
  })
  it('follows a build here with its progress and time left', () => {
    expect(stationCard('sys', build(), 9.5 * H)).toEqual({ kind: 'building', build: build(), progress: 9.5 / 24, left: '14h 30m' })
  })
  it('turns into OPEN STATION once the timer is up', () => {
    expect(stationCard('sys', build(), 24 * H + 1)).toEqual({ kind: 'ready', build: build() })
  })
  it("says the crew is busy elsewhere when the build is in another system (one build at a time)", () => {
    expect(stationCard('other', build(), 2 * H)).toEqual({ kind: 'elsewhere', build: build() })
  })
})

describe('time left', () => {
  it('reads in hours and minutes, then minutes, then under a minute', () => {
    expect(timeLeftText(14 * H + 22 * 60_000 + 5_000)).toBe('14h 22m')
    expect(timeLeftText(38 * 60_000 + 59_000)).toBe('38m')
    expect(timeLeftText(30_000)).toBe('under a minute')
  })
})

describe('building', () => {
  it("picks up the player's build in progress from the server", async () => {
    activeReply = { id: 'c1', system_id: 'sys', station_name: 'Haven', started_at: new Date(0).toISOString(), completes_at: new Date(24 * H).toISOString(), status: 'in_progress' }
    await loadConstruction()
    expect(activeBuild()).toEqual(build())
  })
  it('begins a build in this system and tells the console', async () => {
    startConstruction.mockResolvedValue({ constructionId: 'c9', completesAt: new Date(Date.now() + 24 * H).toISOString() })
    const changed = vi.fn()
    onConstructionChanged(changed)
    await beginConstruction('sys', '  Haven Rest ')
    expect(startConstruction).toHaveBeenCalledWith('Haven Rest')
    expect(activeBuild()).toMatchObject({ id: 'c9', systemId: 'sys', stationName: 'Haven Rest' })
    expect(changed).toHaveBeenCalled()
  })
  it("passes on the server's refusal and keeps no build", async () => {
    startConstruction.mockRejectedValue(new Error('API error 400: {"error":"A station is already being built in this system"}'))
    await expect(beginConstruction('sys', 'Haven Rest')).rejects.toThrow('A station is already being built in this system')
    expect(activeBuild()).toBeNull()
  })
  it('opens the finished station: the build is done and the ship hears about the new station', async () => {
    activeReply = { id: 'c1', system_id: 'sys', station_name: 'Haven', started_at: new Date(0).toISOString(), completes_at: new Date(24 * H).toISOString(), status: 'in_progress' }
    await loadConstruction()
    completeConstruction.mockResolvedValue({ stationId: 'st1', stationName: 'Haven' })
    const opened = vi.fn()
    setStationOpenedCallback(opened)
    await openStation()
    expect(completeConstruction).toHaveBeenCalledWith('c1')
    expect(activeBuild()).toBeNull()
    expect(opened).toHaveBeenCalledWith({ systemId: 'sys', stationId: 'st1', stationName: 'Haven' })
    expect(invalidateSystemDetail).toHaveBeenCalledWith('sys')   // the cached detail still says no station
  })
})
