// Distress calls in the ship: a captain who can't reach any other star sends a call to the galaxy; every other ship
// hears it, can respond from afar, and once in the same system can send fuel or tow the stranded ship to the
// nearest station. The rescued captain hears who helped. The server does the work (routes/distress.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest'

let active: any[] = []
const sendDistressCall = vi.fn(async () => ({ id: 'mine' }))
const cancelDistressCall = vi.fn(async () => ({}))
const acceptDistressCall = vi.fn(async () => ({ accepted: true }))
const transferDistressFuel = vi.fn(async (_id: string, amount: number) => ({ status: 'completed', fuelTransferred: amount }))
const towDistressShip = vi.fn(async (_id: string, dest: string) => ({ status: 'completed', destinationSystemId: dest, towFuelCost: 120 }))
vi.mock('../src/api', async (orig) => ({
  ...(await orig<any>()),
  getActiveDistressCalls: vi.fn(async () => active),
  sendDistressCall: (...a: any[]) => (sendDistressCall as any)(...a),
  cancelDistressCall: (...a: any[]) => (cancelDistressCall as any)(...a),
  acceptDistressCall: (...a: any[]) => (acceptDistressCall as any)(...a),
  transferDistressFuel: (...a: any[]) => (transferDistressFuel as any)(...a),
  towDistressShip: (...a: any[]) => (towDistressShip as any)(...a),
}))

import {
  needsHelp, helpFor, towMinutes, durationText, setDistressPlace, DISTRESS_PRESETS, distressMessage, setDistressShip, shouldOfferDistress, fuelChoices, nearestStation, towCost, refreshDistress, callsAt, myCall,
  sendDistress, cancelDistress, respondTo, sendFuelTo, towToSafety, setDistressHandlers, resetDistress,
} from '../src/distress'

const sys = (id: string, x: number, y: number, has_station = false) => ({ id, name: id.toUpperCase(), coord_x: x, coord_y: y, coord_z: 0, has_station, visible: true }) as any
const SYSTEMS = [sys('here', 0, 0), sys('near', 30, 0), sys('dock', 0, 60, true), sys('far-dock', 0, 300, true)]
const call = (over: any = {}) => ({
  id: 'c1', playerId: 'p2', username: 'Nomis', message: null, systemId: 'here', systemName: 'HERE',
  coordX: 0, coordY: 0, coordZ: 0, acceptorCount: 0, iAccepted: false, isMe: false, createdAt: new Date().toISOString(), ...over,
})

const said: string[] = []
const shipChanged = vi.fn()
const moved = vi.fn()
beforeEach(() => {
  resetDistress(); active = []; said.length = 0; shipChanged.mockReset(); moved.mockReset()
  for (const f of [sendDistressCall, cancelDistressCall, acceptDistressCall, transferDistressFuel, towDistressShip]) f.mockClear()
  setDistressHandlers({ say: t => said.push(t), shipChanged, moved })
})

describe('when to call for help', () => {
  it('when the ship is stranded', () => {
    expect(needsHelp({ fuel: 50, efficiency: 1, stranded: true }, 'here', SYSTEMS)).toBe(true)
  })
  it("when there isn't the fuel to reach the nearest star", () => {
    expect(needsHelp({ fuel: 29, efficiency: 1, stranded: false }, 'here', SYSTEMS)).toBe(true)
    expect(needsHelp({ fuel: 31, efficiency: 1, stranded: false }, 'here', SYSTEMS)).toBe(false)
    expect(needsHelp({ fuel: 16, efficiency: 2, stranded: false }, 'here', SYSTEMS)).toBe(false)   // 30 GU at 2x efficiency
  })
})

describe('the distress dialog', () => {
  it('offers quick lines for fuel and for a tow', () => {
    expect(DISTRESS_PRESETS.map(p => p.label)).toEqual(['NEED FUEL', 'NEED A TOW'])
  })
  it('sends the message trimmed, nothing when blank, and no more than the server keeps', () => {
    expect(distressMessage('  Need 40 fuel  ')).toBe('Need 40 fuel')
    expect(distressMessage('   ')).toBeUndefined()
    expect(distressMessage('x'.repeat(250))).toHaveLength(200)
  })
  it('sends the call with its message', async () => {
    await sendDistress(distressMessage(' Need a tow to the nearest station '))
    expect(sendDistressCall).toHaveBeenCalledWith('Need a tow to the nearest station')
  })
})

describe("the fuel panel's SEND DISTRESS CALL", () => {
  it("shows when the ship can't reach any other star, and not once a call is out", async () => {
    setDistressPlace(SYSTEMS, 'here')
    setDistressShip({ fuel: 5, efficiency: 1, stranded: false })
    expect(shouldOfferDistress()).toBe(true)
    active = [call({ id: 'mine', isMe: true })]
    await refreshDistress()
    expect(shouldOfferDistress()).toBe(false)
  })
  it("doesn't show before the ship's state is known", () => {
    setDistressPlace(SYSTEMS, 'here')
    expect(shouldOfferDistress()).toBe(false)
  })
})

describe('what a ship can do about a call', () => {
  it('respond from another system, or note that you already have', () => {
    expect(helpFor(call(), 'elsewhere', false)).toBe('respond')
    expect(helpFor(call({ iAccepted: true }), 'elsewhere', false)).toBe('responding')
  })
  it('send fuel or tow once in the same system', () => {
    expect(helpFor(call(), 'here', false)).toBe('help')
  })
  it('nothing while in flight, and nothing for your own call', () => {
    expect(helpFor(call(), 'here', true)).toBeNull()
    expect(helpFor(call({ isMe: true }), 'here', false)).toBeNull()
  })
})

describe('helping', () => {
  it('offers the fuel amounts you can spare', () => {
    expect(fuelChoices(60)).toEqual([10, 25, 50])
    expect(fuelChoices(30)).toEqual([10, 25])
    expect(fuelChoices(5)).toEqual([])
  })
  it('tows to the nearest station, at twice the fuel of the trip', () => {
    const dest = nearestStation('here', SYSTEMS)
    expect(dest?.id).toBe('dock')
    expect(towCost('here', dest!.id, SYSTEMS)).toBe(120)
  })
  it('takes 1.5x the trip at base speed (1 minute per GU), like the server', () => {
    expect(towMinutes('here', 'dock', SYSTEMS)).toBe(90)
    expect(durationText(90)).toBe('1h 30m')
    expect(durationText(45)).toBe('45m')
  })
  it("doesn't tow to the system you're already in", () => {
    expect(nearestStation('dock', SYSTEMS)?.id).toBe('far-dock')
  })
})

describe('hearing calls', () => {
  it('announces a new call once, and not your own', async () => {
    active = [call(), call({ id: 'mine', isMe: true, username: 'Me' })]
    await refreshDistress()
    await refreshDistress()
    expect(said.filter(t => t.includes('Nomis'))).toHaveLength(1)
    expect(said.some(t => t.includes('Me'))).toBe(false)
    expect(callsAt('here').map(c => c.id)).toEqual(['c1'])
    expect(myCall()?.id).toBe('mine')
  })
  it("tells you you can move again when your call closes without you cancelling (fuel, a tow, or recharge)", async () => {
    active = [call({ id: 'mine', isMe: true })]
    await refreshDistress()
    active = []
    await refreshDistress()
    expect(said.some(t => /distress call has closed/.test(t))).toBe(true)
    expect(moved).toHaveBeenCalledWith('rescued')   // a tow may have set the ship off: the ship follows it
  })
})

describe('acting', () => {
  it('sends a call, and cancelling it says nothing about being able to move', async () => {
    active = []
    await sendDistress()
    expect(sendDistressCall).toHaveBeenCalled()
    active = [call({ id: 'mine', isMe: true })]
    await refreshDistress()
    await cancelDistress()
    expect(cancelDistressCall).toHaveBeenCalledWith('mine')
    active = []
    await refreshDistress()
    expect(said.some(t => /distress call has closed/.test(t))).toBe(false)
  })
  it('responds to a call', async () => {
    active = [call()]
    await refreshDistress()
    await respondTo('c1')
    expect(acceptDistressCall).toHaveBeenCalledWith('c1')
  })
  it('sends fuel and updates the desks', async () => {
    await sendFuelTo('c1', 25)
    expect(transferDistressFuel).toHaveBeenCalledWith('c1', 25)
    expect(shipChanged).toHaveBeenCalled()
  })
  it('tows to safety, and the map follows the ship there', async () => {
    await towToSafety('c1', 'dock')
    expect(towDistressShip).toHaveBeenCalledWith('c1', 'dock')
    expect(moved).toHaveBeenCalledWith('towing')
  })
  it("passes on the server's refusal", async () => {
    transferDistressFuel.mockRejectedValueOnce(new Error('API error 400: {"error":"You must be in the same star system to transfer fuel"}'))
    await expect(sendFuelTo('c1', 10)).rejects.toThrow('You must be in the same star system to transfer fuel')
  })
})
