// STEM is the ship itself: a HUD button opens a chat with it. Answers come from the server's STEM templates,
// worded for this ship (client 'dcl'). Actions STEM offers are described, not carried out; the player uses the desk.
import ReactEcs, { UiEntity, Label, Input } from '@dcl/sdk/react-ecs'
import { Color4 } from '@dcl/sdk/math'
import { px } from './uiScale'
import * as api from './api'
import { replayTour } from './tour/runner'

type Message = { role: 'user' | 'stem' | 'warning' | 'error'; text: string }

const GREETING = 'STEM online. Ask me anything about the ship, Captain.'
const NO_ANSWER = "That's beyond my databanks, Captain. Try asking about fuel, pods, stations or travel."
const COMMS_DOWN = 'Comms offline, Captain. Try again in a moment.'

// Where to do what STEM was asked to do
const ACTION_HINT: Record<string, string> = {
  dock: 'Press DOCK on the Stellar Navigation console.',
  undock: 'Press UNDOCK on the Stellar Navigation console.',
  refine: 'Press REFINE on the Ship Overview desk.',
  fabricate: 'Use BUILD POD at the Pod Operations desk.',
  navigate: 'Select the system on the galaxy map hologram and press TRAVEL.',
  discover: 'Use the Stellar Discovery desk.'
}

const HISTORY_SENT = 8

let open = false
let messages: Message[] = [{ role: 'stem', text: GREETING }]
let draft = ''
let waiting = false
// The explorer keeps the typed text inside the input, so setting value back to '' doesn't clear it.
// A new key after each send rebuilds the input empty.
let inputGeneration = 0

function replyMessages(reply: api.StemReply): Message[] {
  const out: Message[] = []
  if (reply.type === 'command' && reply.command) {
    const c = reply.command
    const hint = ACTION_HINT[c.action]
    out.push({ role: 'stem', text: c.canExecute ? (hint ? `${c.confirmText}\n${hint}` : c.confirmText) : (c.blockedReason || c.confirmText) })
  } else {
    out.push({ role: 'stem', text: reply.text?.trim() || NO_ANSWER })
  }
  for (const w of reply.warnings ?? []) out.push({ role: 'warning', text: w.text })
  return out
}

function send(): void {
  const text = draft.trim()
  if (!text || waiting) return
  if (/\b(tour|walkthrough)\b/i.test(text)) {
    messages.push({ role: 'user', text }, { role: 'stem', text: 'Starting the tour, Captain.' })
    draft = ''
    inputGeneration++
    open = false
    replayTour()
    return
  }
  const history = messages
    .filter(m => m.role === 'user' || m.role === 'stem')
    .slice(-HISTORY_SENT)
    .map(m => ({ role: m.role as 'user' | 'stem', text: m.text }))
  messages.push({ role: 'user', text })
  draft = ''
  inputGeneration++
  waiting = true
  api.askStem(text, history)
    .then(reply => { messages.push(...replyMessages(reply)) })
    .catch(err => { console.log('STEM query failed:', err); messages.push({ role: 'error', text: COMMS_DOWN }) })
    .finally(() => { waiting = false; messages = messages.slice(-40) })
}

// Layout, in 1080-canvas units (px() scales them)
const PANEL_W = 440
const PAD = 12
const LOG_H = 320
const FONT = 14
const LINE_H = 19
const CHARS_PER_LINE = Math.floor((PANEL_W - PAD * 2 - 16) / (FONT * 0.55))

// DCL doesn't size wrapped text to its content, so estimate each message's height from its length.
function messageHeight(text: string): number {
  const lines = text.split('\n').reduce((n, para) => n + Math.max(1, Math.ceil(para.length / CHARS_PER_LINE)), 0)
  return lines * LINE_H + 10
}

// The newest messages that fit in the log, oldest first
function visibleMessages(): Message[] {
  const shown: Message[] = []
  let used = waiting ? messageHeight('…') : 0
  for (let i = messages.length - 1; i >= 0; i--) {
    used += messageHeight(messages[i].text)
    if (used > LOG_H) break
    shown.unshift(messages[i])
  }
  return shown
}

const CYAN = Color4.create(0, 0.9, 1, 1)
const DIM = Color4.create(0.45, 0.65, 0.75, 1)
const ROLE_COLOR: Record<Message['role'], Color4> = {
  user: CYAN,
  stem: Color4.create(0.92, 0.95, 1, 1),
  warning: Color4.create(1, 0.72, 0.2, 1),
  error: Color4.create(1, 0.4, 0.4, 1)
}
const PANEL_BG = Color4.create(0.02, 0.05, 0.12, 0.9)
const DARK = Color4.create(0.02, 0.05, 0.1, 1)

const messageLine = (m: Message, key: string) => (
  <UiEntity key={key} uiTransform={{ width: '100%', height: px(messageHeight(m.text)), flexShrink: 0 }}
    uiText={{ value: m.role === 'user' ? `> ${m.text}` : m.text, fontSize: px(FONT), color: ROLE_COLOR[m.role], textAlign: 'top-left', textWrap: 'wrap' }} />
)

export const StemButton = () => (
  <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(104), left: px(260) }, width: px(90), height: px(30), justifyContent: 'center', alignItems: 'center' }}
    uiBackground={{ color: open ? CYAN : PANEL_BG }}
    onMouseDown={() => { open = !open }}>
    <Label value="STEM" fontSize={px(12)} color={open ? DARK : CYAN} />
  </UiEntity>
)

export const StemPanel = () => {
  if (!open) return null
  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: px(144), left: px(60) }, width: px(PANEL_W), flexDirection: 'column', padding: px(PAD) }}
      uiBackground={{ color: PANEL_BG }}>
      <UiEntity uiTransform={{ width: '100%', height: px(24), flexDirection: 'row', alignItems: 'center', margin: { bottom: px(8) } }}>
        <Label value="STEM  //  SHIP TELEMETRY AND EXPLORATION MODULE" fontSize={px(11)} color={DIM} uiTransform={{ flexGrow: 1 }} textAlign="middle-left" />
        <UiEntity uiTransform={{ width: px(56), height: px(24), margin: { right: px(6) }, justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
          onMouseDown={() => { open = false; replayTour() }}>
          <Label value="TOUR" fontSize={px(12)} color={CYAN} />
        </UiEntity>
        <UiEntity uiTransform={{ width: px(24), height: px(24), justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
          onMouseDown={() => { open = false }}>
          <Label value="X" fontSize={px(12)} color={CYAN} />
        </UiEntity>
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: px(LOG_H), flexDirection: 'column', justifyContent: 'flex-end', overflow: 'hidden' }}>
        {visibleMessages().map((m, i) => messageLine(m, `stem${messages.length}-${i}`))}
        {waiting ? messageLine({ role: 'stem', text: '…' }, 'stem-waiting') : null}
      </UiEntity>
      <UiEntity uiTransform={{ width: '100%', height: px(44), flexDirection: 'row', margin: { top: px(8) } }}>
        <Input
          key={`stem-input-${inputGeneration}`}
          uiTransform={{ flexGrow: 1, height: '100%', margin: { right: px(6) } }}
          uiBackground={{ color: Color4.create(0.05, 0.12, 0.2, 1) }}
          fontSize={px(FONT)}
          color={Color4.White()}
          placeholder="Ask STEM…"
          placeholderColor={DIM}
          value={draft}
          onChange={(v) => { draft = v }}
          onSubmit={(v) => { draft = v; send() }}
        />
        <UiEntity uiTransform={{ width: px(70), height: '100%', justifyContent: 'center', alignItems: 'center' }}
          uiBackground={{ color: waiting ? Color4.create(0.15, 0.15, 0.15, 1) : CYAN }}
          onMouseDown={() => { send() }}>
          <Label value={waiting ? '…' : 'SEND'} fontSize={px(12)} color={waiting ? DIM : DARK} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
