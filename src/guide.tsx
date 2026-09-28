// Guides: the game's own wallets can see the players in their ships and reveal themselves to chosen players
// to show them the ropes. The guide's scene broadcasts who it is revealed to on the scene message bus (repeated,
// so late arrivals and reloads catch up); each player's scene trusts the message only when the sender is a guide
// wallet, and hides the guide again once the messages stop.
import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { engine, PlayerIdentityData, AvatarBase } from '@dcl/sdk/ecs'
import { MessageBus } from '@dcl/sdk/message-bus'
import { px } from './uiScale'
import { setAlsoVisible, setSolo } from './soloShip'

const GUIDE_WALLETS = [
  '0xc2877b05cfe462e585fe3de8046f7528998af6f1',   // unknower
  '0x7e567deabffceceea48da456ebb9ef84d159374c'    // MetaPetal
]
const MESSAGE = 'gg-guide-reveal'
const REBROADCAST_S = 4
const REVEAL_TIMEOUT_MS = 15000

const bus = new MessageBus()
let notify: ((text: string) => void) | null = null
export function setGuideNotifyCallback(cb: (text: string) => void): void { notify = cb }

function selfAddress(): string {
  return (PlayerIdentityData.getOrNull(engine.PlayerEntity)?.address ?? '').toLowerCase()
}
function selfName(): string {
  return AvatarBase.getOrNull(engine.PlayerEntity)?.name ?? 'Guide'
}
export function isGuide(): boolean { return GUIDE_WALLETS.includes(selfAddress()) }

// --- Player side: guides revealed to me, until their messages stop ---

const revealedUntil = new Map<string, number>()   // guide address → expiry (ms)

function publishRevealed(): void { setAlsoVisible(Array.from(revealedUntil.keys())) }

bus.on(MESSAGE, (value: any, sender: string) => {
  const guide = (sender ?? '').toLowerCase()
  if (!GUIDE_WALLETS.includes(guide) || guide === selfAddress()) return
  const to: string[] = Array.isArray(value?.to) ? value.to.map((a: any) => String(a).toLowerCase()) : []
  if (to.includes(selfAddress())) {
    if (!revealedUntil.has(guide)) {
      revealedUntil.set(guide, Date.now() + REVEAL_TIMEOUT_MS)
      publishRevealed()
      notify?.(`Guide ${String(value?.name ?? 'Captain')} has boarded your ship`)
    } else {
      revealedUntil.set(guide, Date.now() + REVEAL_TIMEOUT_MS)
    }
  } else if (revealedUntil.delete(guide)) {
    publishRevealed()
  }
})

// --- Guide side: who I'm revealed to, and my own view ---

const revealTo = new Set<string>()
let seeCrew = false
let open = false

function broadcast(): void {
  bus.emit(MESSAGE, { name: selfName(), to: Array.from(revealTo) })
}

function toggleReveal(address: string): void {
  if (revealTo.has(address)) revealTo.delete(address)
  else revealTo.add(address)
  broadcast()   // an empty list tells players to hide the guide straight away
}

function hideFromAll(): void {
  revealTo.clear()
  broadcast()
}

function toggleSeeCrew(): void {
  seeCrew = !seeCrew
  setSolo(!seeCrew)
}

let acc = 0
let sinceBroadcast = 0
engine.addSystem((dt: number) => {
  acc += dt
  if (acc < 1) return
  acc = 0
  // Expire guides whose messages stopped (they left, or their scene closed)
  const now = Date.now()
  let changed = false
  for (const [guide, until] of revealedUntil) if (until < now) { revealedUntil.delete(guide); changed = true }
  if (changed) publishRevealed()
  // Keep repeating my reveals so late arrivals and reloads catch up
  if (revealTo.size > 0 && ++sinceBroadcast >= REBROADCAST_S) { sinceBroadcast = 0; broadcast() }
})

// --- Guide panel ---

type Crew = { address: string; name: string }

function crewInWorld(): Crew[] {
  const me = selfAddress()
  const out: Crew[] = []
  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData, AvatarBase)) {
    const address = identity.address.toLowerCase()
    if (entity === engine.PlayerEntity || address === me) continue
    out.push({ address, name: AvatarBase.get(entity).name || `${address.slice(0, 6)}…${address.slice(-4)}` })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

const CYAN = Color4.create(0, 0.9, 1, 1)
const MAGENTA = Color4.create(1, 0.25, 0.85, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const PANEL_BG = Color4.create(0.02, 0.05, 0.12, 0.9)
const SLOT_BG = Color4.create(0.05, 0.12, 0.2, 1)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)
const MAX_ROWS = 10

export const GuideButton = () => {
  if (!isGuide()) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(104), left: px(360) }, width: px(90), height: px(30), justifyContent: 'center', alignItems: 'center' }}
      uiBackground={{ color: open ? MAGENTA : PANEL_BG }}
      onMouseDown={() => { open = !open }}>
      <Label value="GUIDE" fontSize={px(12)} color={open ? DARK : MAGENTA} />
    </UiEntity>
  )
}

export const GuidePanel = () => {
  if (!open || !isGuide()) return null
  const crew = crewInWorld()
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(144), left: px(520) }, width: px(340), flexDirection: 'column', padding: px(12) }}
      uiBackground={{ color: PANEL_BG }}>
      <UiEntity uiTransform={{ width: '100%', height: px(24), flexDirection: 'row', alignItems: 'center', margin: { bottom: px(8) } }}>
        <Label value="GUIDE  //  CREW IN WORLD" fontSize={px(13)} color={DIM} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: px(24), height: px(24), justifyContent: 'center', alignItems: 'center' }} uiBackground={{ color: SLOT_BG }}
          onMouseDown={() => { open = false }}>
          <Label value="X" fontSize={px(12)} color={CYAN} />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: px(30), justifyContent: 'center', alignItems: 'center', margin: { bottom: px(10) } }}
        uiBackground={{ color: seeCrew ? CYAN : SLOT_BG }}
        onMouseDown={() => { toggleSeeCrew() }}>
        <Label value={seeCrew ? 'SEE CREW: ON' : 'SEE CREW: OFF'} fontSize={px(12)} color={seeCrew ? DARK : CYAN} />
      </UiEntity>
      {crew.length === 0
        ? <Label value="No other players in the world" fontSize={px(13)} color={DIM} uiTransform={{ height: px(28) }} />
        : crew.slice(0, MAX_ROWS).map(c => {
          const shown = revealTo.has(c.address)
          return (
            <UiEntity key={c.address} uiTransform={{ width: '100%', height: px(30), flexDirection: 'row', alignItems: 'center', margin: { bottom: px(4) } }}>
              <Label value={c.name} fontSize={px(13)} color={shown ? MAGENTA : Color4.White()} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />
              <UiEntity uiTransform={{ width: px(80), height: px(26), justifyContent: 'center', alignItems: 'center' }}
                uiBackground={{ color: shown ? MAGENTA : SLOT_BG }}
                onMouseDown={() => { toggleReveal(c.address) }}>
                <Label value={shown ? 'HIDE' : 'REVEAL'} fontSize={px(12)} color={shown ? DARK : MAGENTA} />
              </UiEntity>
            </UiEntity>
          )
        })}
      {crew.length > MAX_ROWS ? <Label value={`+${crew.length - MAX_ROWS} more`} fontSize={px(12)} color={DIM} uiTransform={{ height: px(20) }} /> : null}
      {revealTo.size > 0
        ? <UiEntity uiTransform={{ width: '100%', height: px(28), justifyContent: 'center', alignItems: 'center', margin: { top: px(8) } }}
            uiBackground={{ color: SLOT_BG }} onMouseDown={() => { hideFromAll() }}>
            <Label value="HIDE FROM ALL" fontSize={px(12)} color={MAGENTA} />
          </UiEntity>
        : null}
    </UiEntity>
  )
}
