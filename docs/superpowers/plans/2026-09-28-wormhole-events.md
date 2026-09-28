# Wormhole Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins open a temporary wormhole from anywhere in the galaxy to a chosen system for an event window; players jump there and back for free, or stay and lose contact with pods left out.

**Architecture:** Server: two tables (events, per-player trips), a service with pure rule helpers, player and admin routes, and a minute job that closes due events (applying pod losses) and sends the opening push. Scene: an event-state poller drives a HUD banner, a hologram marker, star-panel buttons, STEM answers, pod warnings and three cutscenes (opened, jump, closed) built from rotating ring segments seen through the front window.

**Tech Stack:** Server: Express + Supabase + Vitest (Node 20). Admin: React + Vite (`web/admin`). Scene: Decentraland SDK 7.23 (ECS, ReactEcs, VirtualCamera).

**Spec:** `docs/superpowers/specs/2026-09-28-wormhole-events-design.md`

## Global Constraints

- Node 20 for every command: `source ~/.nvm/nvm.sh && nvm use 20`.
- Server work in the worktree `~/Git/galaxy-gardeners-server-wt` on a branch off `origin/main`; never in `~/Git/galaxy-gardeners-server` (the user's checkout).
- Migration number **057**. The user runs migrations; nothing that reads the new tables is pushed before they have.
- Server code style: semicolons, 2-space indent, `.js` import suffixes, header comment per file.
- Scene: all 2D sizes through `px()` (`src/uiScale.ts`); never change `.editor/project.json` or `scene.json` `source.projectId`; build check `npm run build`.
- Jumps are instant and free both ways; one open event per galaxy; players at the target when it closes stay and lose every expedition still in progress.
- Push category: `'missions'` (existing), title "Wormhole open!", body "A wormhole to {target} is open until {HH:MM UTC}."
- STEM's pod warning copy: "Captain, we have to get back to the wormhole or we'll lose contact with {n} pods!" (n = 1 → "1 pod").
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A player who jumps, leaves the target by normal travel, and later the event closes: they're not at the target, so nothing is lost and no return is offered (Task 2 `canReturn` + Task 3 close test).
2. An event closed early by an admin while players are mid-jump: the close must be idempotent and the minute job must not close it twice or double-apply losses (Task 3 idempotency test).
3. A player in transit when the event opens: JUMP is refused with a clear message, and the banner shows it disabled rather than failing on click (Task 2 test, Task 6 banner).
4. Reload mid-event: the opening cutscene must not replay (pref per event id), the banner and marker come back from the poll (Task 6/8).
5. Two events scheduled back to back: `activeEvent` must return the one currently in its window, never a closed or future one (Task 1 `isOpen` test).

---

### Task 1: Server — migration 057 and pure rule helpers

**Files:**
- Create: `supabase/migrations/057_wormhole_events.sql`
- Create: `src/services/events/wormholeRules.ts`
- Test: `src/services/events/__tests__/wormholeRules.test.ts`

**Interfaces:**
- Produces: `isOpen(ev: EventRow, now: number): boolean`; `canJump(input: { event: EventRow | null; now: number; currentSystemId: string | null; traveling: boolean }): { ok: true } | { ok: false; reason: string }`; `canReturn(input: { event: EventRow | null; now: number; currentSystemId: string | null; trip: TripRow | null }): boolean`; `podWord(n: number): string`; types `EventRow = { id: string; galaxy_id: string; target_system_id: string; starts_at: string; ends_at: string; closed_at: string | null }`, `TripRow = { id: string; event_id: string; player_id: string; origin_system_id: string; returned_at: string | null }`.

- [ ] **Step 1: Branch** — `cd ~/Git/galaxy-gardeners-server-wt && git fetch -q && git checkout -b feat/wormhole-events origin/main`

- [ ] **Step 2: Migration** — create `supabase/migrations/057_wormhole_events.sql`:

```sql
-- Wormhole events: an admin opens a temporary wormhole from anywhere in a galaxy to one star system for a window.
-- Players jump there and back for free (wormhole_trips remembers where each came from); anyone still at the
-- target when it closes stays there and loses contact with pods still out (services/events/wormhole.ts).

CREATE TABLE IF NOT EXISTS wormhole_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  galaxy_id         UUID NOT NULL REFERENCES galaxies(id) ON DELETE CASCADE,
  target_system_id  UUID NOT NULL REFERENCES star_systems(id) ON DELETE CASCADE,
  starts_at         TIMESTAMPTZ NOT NULL,
  ends_at           TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,
  pushed_at         TIMESTAMPTZ,
  created_by        UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT wormhole_events_window CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_wormhole_events_galaxy_end ON wormhole_events (galaxy_id, ends_at);

CREATE TABLE IF NOT EXISTS wormhole_trips (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES wormhole_events(id) ON DELETE CASCADE,
  player_id         UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  origin_system_id  UUID NOT NULL REFERENCES star_systems(id) ON DELETE CASCADE,
  jumped_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  returned_at       TIMESTAMPTZ,
  pods_lost         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wormhole_trips_event_player ON wormhole_trips (event_id, player_id);

ALTER TABLE wormhole_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE wormhole_trips ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wormhole_events FROM anon, authenticated;
REVOKE ALL ON wormhole_trips FROM anon, authenticated;
```

- [ ] **Step 3: Failing tests** — `src/services/events/__tests__/wormholeRules.test.ts`:

```ts
// Galaxy Gardeners — wormhole event rules
import { describe, it, expect } from 'vitest';
import { isOpen, canJump, canReturn, podWord, EventRow, TripRow } from '../wormholeRules.js';

const T = Date.parse('2026-10-01T20:00:00Z');
const ev = (o: Partial<EventRow> = {}): EventRow => ({
  id: 'e1', galaxy_id: 'g', target_system_id: 'target',
  starts_at: '2026-10-01T19:00:00Z', ends_at: '2026-10-01T21:00:00Z', closed_at: null, ...o,
});
const trip = (o: Partial<TripRow> = {}): TripRow => ({ id: 't1', event_id: 'e1', player_id: 'p', origin_system_id: 'home', returned_at: null, ...o });

describe('isOpen', () => {
  it('is open inside its window only', () => {
    expect(isOpen(ev(), T)).toBe(true);
    expect(isOpen(ev({ starts_at: '2026-10-01T20:30:00Z' }), T)).toBe(false);   // not started
    expect(isOpen(ev({ ends_at: '2026-10-01T20:00:00Z' }), T)).toBe(false);     // ended exactly now
    expect(isOpen(ev({ closed_at: '2026-10-01T19:30:00Z' }), T)).toBe(false);   // closed early
  });
});

describe('canJump', () => {
  it('allows a player elsewhere while the event is open', () => {
    expect(canJump({ event: ev(), now: T, currentSystemId: 'home', traveling: false })).toEqual({ ok: true });
  });
  it('refuses with no open event, in transit, or already at the target', () => {
    expect(canJump({ event: null, now: T, currentSystemId: 'home', traveling: false }).ok).toBe(false);
    expect(canJump({ event: ev(), now: T, currentSystemId: 'home', traveling: true })).toEqual({ ok: false, reason: "We're mid-jump already, Captain. The wormhole will wait until we arrive." });
    expect(canJump({ event: ev(), now: T, currentSystemId: 'target', traveling: false })).toEqual({ ok: false, reason: "We're already at the wormhole's destination." });
  });
});

describe('canReturn', () => {
  it('allows a player at the target with an open trip', () => {
    expect(canReturn({ event: ev(), now: T, currentSystemId: 'target', trip: trip() })).toBe(true);
  });
  it('refuses once returned, away from the target, without a trip, or after closing', () => {
    expect(canReturn({ event: ev(), now: T, currentSystemId: 'target', trip: trip({ returned_at: '2026-10-01T19:40:00Z' }) })).toBe(false);
    expect(canReturn({ event: ev(), now: T, currentSystemId: 'elsewhere', trip: trip() })).toBe(false);
    expect(canReturn({ event: ev(), now: T, currentSystemId: 'target', trip: null })).toBe(false);
    expect(canReturn({ event: ev({ closed_at: '2026-10-01T19:50:00Z' }), now: T, currentSystemId: 'target', trip: trip() })).toBe(false);
  });
});

describe('podWord', () => {
  it('pluralises', () => { expect(podWord(1)).toBe('1 pod'); expect(podWord(3)).toBe('3 pods'); });
});
```

- [ ] **Step 4: Run** `npx vitest run src/services/events` — Expected: FAIL (module missing).

- [ ] **Step 5: Implement** `src/services/events/wormholeRules.ts`:

```ts
// Galaxy Gardeners — wormhole event rules (pure: no database)
// See services/events/wormhole.ts for how they're applied.

export type EventRow = { id: string; galaxy_id: string; target_system_id: string; starts_at: string; ends_at: string; closed_at: string | null };
export type TripRow = { id: string; event_id: string; player_id: string; origin_system_id: string; returned_at: string | null };

/** Inside its window and not closed early. */
export function isOpen(ev: EventRow, now: number): boolean {
  return !ev.closed_at && Date.parse(ev.starts_at) <= now && now < Date.parse(ev.ends_at);
}

export function canJump(input: { event: EventRow | null; now: number; currentSystemId: string | null; traveling: boolean }):
  { ok: true } | { ok: false; reason: string } {
  const { event, now, currentSystemId, traveling } = input;
  if (!event || !isOpen(event, now)) return { ok: false, reason: 'There is no wormhole open right now.' };
  if (traveling) return { ok: false, reason: "We're mid-jump already, Captain. The wormhole will wait until we arrive." };
  if (currentSystemId === event.target_system_id) return { ok: false, reason: "We're already at the wormhole's destination." };
  return { ok: true };
}

/** The way home belongs to the target: only from there, only on an open trip, only while the event is open. */
export function canReturn(input: { event: EventRow | null; now: number; currentSystemId: string | null; trip: TripRow | null }): boolean {
  const { event, now, currentSystemId, trip } = input;
  return !!event && isOpen(event, now) && !!trip && !trip.returned_at && currentSystemId === event.target_system_id;
}

export function podWord(n: number): string { return `${n} ${n === 1 ? 'pod' : 'pods'}`; }
```

- [ ] **Step 6: Run** `npx vitest run src/services/events` — Expected: PASS.

- [ ] **Step 7: Commit** — `git add supabase/migrations/057_wormhole_events.sql src/services/events && git commit -m "Wormhole events: migration 057 and rule helpers" -m "Co-Authored-By: ..."`

---

### Task 2: Server — status, jump and return

**Files:**
- Create: `src/services/events/wormhole.ts`
- Test: `src/services/events/__tests__/wormhole.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers and types.
- Produces: `wormholeStatus(playerId: string): Promise<WormholeStatus | null>` where `WormholeStatus = { id: string; targetSystemId: string; targetName: string; startsAt: string; endsAt: string; trip: { originSystemId: string; originName: string } | null; podsOut: number; canJump: boolean; jumpBlockedReason: string | null; canReturn: boolean }`; `jump(playerId: string): Promise<{ systemId: string; systemName: string }>`; `returnHome(playerId: string): Promise<{ systemId: string; systemName: string }>`; errors thrown as `WormholeError` (class with `message`), mapped to 400 by routes.

- [ ] **Step 1: Failing tests** — `src/services/events/__tests__/wormhole.test.ts` using an in-memory Supabase fake (filters `eq`, `is`, `lte`, `gt`, `in`; `update` applies to matches; `insert` appends with an id; `order`/`limit` pass through; `single`/`maybeSingle` return the first match; head counts via `select(_, { head: true })`):

```ts
// Galaxy Gardeners — wormhole status, jump and return
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = Record<string, any>;
let db: Record<string, Row[]> = {};
let nextId = 1;

vi.mock('../../../db/supabase.js', () => ({
  supabase: {
    from: vi.fn((table: string) => {
      const f: Array<(r: Row) => boolean> = [];
      let upd: Row | null = null, ins: Row | null = null, head = false, del = false;
      const rows = () => (db[table] ??= []);
      const hit = () => rows().filter(r => f.every(fn => fn(r)));
      const run = () => {
        if (ins) { const r = { id: `${table}-${nextId++}`, ...ins }; rows().push(r); return { data: [r], error: null }; }
        if (upd) { const h = hit(); h.forEach(r => Object.assign(r, upd)); return { data: h, error: null }; }
        if (del) { const h = hit(); db[table] = rows().filter(r => !h.includes(r)); return { data: h, error: null }; }
        const h = hit(); return head ? { count: h.length, data: null, error: null } : { data: h, error: null };
      };
      const q: any = {
        select: (_c?: string, o?: { head?: boolean }) => { if (o?.head) head = true; return q; },
        eq: (k: string, v: any) => { f.push(r => r[k] === v); return q; },
        is: (k: string, v: any) => { f.push(r => (r[k] ?? null) === v); return q; },
        lte: (k: string, v: any) => { f.push(r => r[k] <= v); return q; },
        gt: (k: string, v: any) => { f.push(r => r[k] > v); return q; },
        in: (k: string, vs: any[]) => { f.push(r => vs.includes(r[k])); return q; },
        order: () => q, limit: () => q,
        update: (u: Row) => { upd = u; return q; },
        insert: (r: Row) => { ins = r; return q; },
        delete: () => { del = true; return q; },
        single: async () => ({ data: run().data?.[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: run().data?.[0] ?? null, error: null }),
        then: (resolve: any) => resolve(run()),
      };
      return q;
    }),
  },
}));

import { wormholeStatus, jump, returnHome } from '../wormhole.js';

const NOW = new Date();
const iso = (mins: number) => new Date(NOW.getTime() + mins * 60000).toISOString();

function setup(o: { traveling?: boolean; at?: string; docked?: boolean } = {}) {
  nextId = 1;
  db = {
    players: [{ id: 'p1', galaxy_id: 'g', current_system_id: o.at ?? 'home' }],
    ships: [{ id: 's1', player_id: 'p1', is_traveling: !!o.traveling }],
    star_systems: [{ id: 'home', name: 'Homestar' }, { id: 'target', name: 'Farstar' }],
    wormhole_events: [{ id: 'e1', galaxy_id: 'g', target_system_id: 'target', starts_at: iso(-30), ends_at: iso(90), closed_at: null }],
    wormhole_trips: [],
    station_docking: o.docked ? [{ player_id: 'p1', station_id: 'st' }] : [],
    expeditions: [{ id: 'x1', player_id: 'p1', status: 'in_progress' }],
  };
}

beforeEach(() => setup());

describe('wormholeStatus', () => {
  it('describes the open event for the player', async () => {
    const s = await wormholeStatus('p1');
    expect(s).toMatchObject({ id: 'e1', targetSystemId: 'target', targetName: 'Farstar', trip: null, podsOut: 1, canJump: true, canReturn: false });
  });
  it('is null when no event is open', async () => {
    db.wormhole_events[0].closed_at = iso(-1);
    expect(await wormholeStatus('p1')).toBeNull();
  });
  it('says why a player in transit cannot jump', async () => {
    setup({ traveling: true });
    const s = await wormholeStatus('p1');
    expect(s?.canJump).toBe(false);
    expect(s?.jumpBlockedReason).toMatch(/mid-jump/);
  });
});

describe('jump and return', () => {
  it('jumps to the target, remembering the origin, undocking first', async () => {
    setup({ docked: true });
    expect(await jump('p1')).toEqual({ systemId: 'target', systemName: 'Farstar' });
    expect(db.players[0].current_system_id).toBe('target');
    expect(db.station_docking).toEqual([]);
    expect(db.wormhole_trips).toMatchObject([{ event_id: 'e1', player_id: 'p1', origin_system_id: 'home', returned_at: null }]);
  });
  it('returns home through the wormhole', async () => {
    await jump('p1');
    expect(await returnHome('p1')).toEqual({ systemId: 'home', systemName: 'Homestar' });
    expect(db.players[0].current_system_id).toBe('home');
    expect(db.wormhole_trips[0].returned_at).toBeTruthy();
  });
  it('refuses to jump in transit, and to return without a trip', async () => {
    setup({ traveling: true });
    await expect(jump('p1')).rejects.toThrow(/mid-jump/);
    setup({ at: 'target' });
    await expect(returnHome('p1')).rejects.toThrow(/no way back/i);
  });
  it('supersedes an earlier open trip when jumping again', async () => {
    await jump('p1');
    db.players[0].current_system_id = 'elsewhere';   // left the target by normal travel
    await jump('p1');
    expect(db.wormhole_trips.filter(t => !t.returned_at)).toHaveLength(1);
    expect(db.wormhole_trips.at(-1)!.origin_system_id).toBe('elsewhere');
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/services/events/__tests__/wormhole.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/services/events/wormhole.ts`:

```ts
// Galaxy Gardeners — wormhole events: status, jump and return (closing: closeEvent / closeDueEvents below)
// Rules are in wormholeRules.ts; this file reads and writes the tables (migration 057).

import { supabase } from '../../db/supabase.js';
import { isOpen, canJump, canReturn, EventRow, TripRow } from './wormholeRules.js';

export class WormholeError extends Error {}

export type WormholeStatus = {
  id: string; targetSystemId: string; targetName: string; startsAt: string; endsAt: string;
  trip: { originSystemId: string; originName: string } | null;
  podsOut: number; canJump: boolean; jumpBlockedReason: string | null; canReturn: boolean;
};

async function systemName(id: string): Promise<string> {
  const { data } = await supabase.from('star_systems').select('name').eq('id', id).maybeSingle();
  return (data as any)?.name ?? 'Unknown system';
}

/** The event currently in its window for a galaxy, if any. */
export async function activeEvent(galaxyId: string): Promise<EventRow | null> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase.from('wormhole_events')
    .select('id, galaxy_id, target_system_id, starts_at, ends_at, closed_at')
    .eq('galaxy_id', galaxyId).is('closed_at', null).lte('starts_at', nowIso).gt('ends_at', nowIso)
    .order('starts_at', { ascending: false }).limit(1);
  const ev = (data as EventRow[] | null)?.[0] ?? null;
  return ev && isOpen(ev, Date.now()) ? ev : null;
}

async function context(playerId: string) {
  const { data: player } = await supabase.from('players').select('id, galaxy_id, current_system_id').eq('id', playerId).single();
  if (!player) throw new WormholeError('Player not found');
  const [{ data: ship }, event] = await Promise.all([
    supabase.from('ships').select('is_traveling').eq('player_id', playerId).single(),
    activeEvent((player as any).galaxy_id),
  ]);
  let trip: TripRow | null = null;
  if (event) {
    const { data } = await supabase.from('wormhole_trips').select('id, event_id, player_id, origin_system_id, returned_at')
      .eq('event_id', event.id).eq('player_id', playerId).is('returned_at', null).order('jumped_at', { ascending: false }).limit(1);
    trip = (data as TripRow[] | null)?.[0] ?? null;
  }
  return { player: player as any, traveling: !!(ship as any)?.is_traveling, event, trip };
}

export async function wormholeStatus(playerId: string): Promise<WormholeStatus | null> {
  const { player, traveling, event, trip } = await context(playerId);
  if (!event) return null;
  const now = Date.now();
  const jumpCheck = canJump({ event, now, currentSystemId: player.current_system_id, traveling });
  const { count } = await supabase.from('expeditions').select('id', { count: 'exact', head: true })
    .eq('player_id', playerId).eq('status', 'in_progress');
  return {
    id: event.id,
    targetSystemId: event.target_system_id,
    targetName: await systemName(event.target_system_id),
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    trip: trip ? { originSystemId: trip.origin_system_id, originName: await systemName(trip.origin_system_id) } : null,
    podsOut: count ?? 0,
    canJump: jumpCheck.ok,
    jumpBlockedReason: jumpCheck.ok ? null : jumpCheck.reason,
    canReturn: canReturn({ event, now, currentSystemId: player.current_system_id, trip }),
  };
}

async function moveTo(playerId: string, systemId: string): Promise<void> {
  await supabase.from('station_docking').delete().eq('player_id', playerId);   // undock first, like the black-hole wormholes
  await supabase.from('players').update({ current_system_id: systemId }).eq('id', playerId);
}

export async function jump(playerId: string): Promise<{ systemId: string; systemName: string }> {
  const { player, traveling, event } = await context(playerId);
  const check = canJump({ event, now: Date.now(), currentSystemId: player.current_system_id, traveling });
  if (!check.ok || !event) throw new WormholeError(check.ok ? 'There is no wormhole open right now.' : check.reason);
  // A new jump supersedes any earlier open trip (e.g. left the target by normal travel)
  await supabase.from('wormhole_trips').update({ returned_at: new Date().toISOString() })
    .eq('event_id', event.id).eq('player_id', playerId).is('returned_at', null);
  await supabase.from('wormhole_trips').insert({ event_id: event.id, player_id: playerId, origin_system_id: player.current_system_id });
  await moveTo(playerId, event.target_system_id);
  return { systemId: event.target_system_id, systemName: await systemName(event.target_system_id) };
}

export async function returnHome(playerId: string): Promise<{ systemId: string; systemName: string }> {
  const { player, event, trip } = await context(playerId);
  if (!event || !trip || !canReturn({ event, now: Date.now(), currentSystemId: player.current_system_id, trip })) {
    throw new WormholeError("There's no way back through the wormhole from here, Captain.");
  }
  await supabase.from('wormhole_trips').update({ returned_at: new Date().toISOString() }).eq('id', trip.id);
  await moveTo(playerId, trip.origin_system_id);
  return { systemId: trip.origin_system_id, systemName: await systemName(trip.origin_system_id) };
}
```

- [ ] **Step 4: Run** the test file — Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/services/events && git commit -m "Wormhole events: status, jump and return" -m "Co-Authored-By: ..."`

---

### Task 3: Server — closing (pod losses) and the opening push

**Files:**
- Modify: `src/services/events/wormhole.ts` (append)
- Modify: `src/index.ts` (minute job)
- Test: `src/services/events/__tests__/wormholeClose.test.ts`

**Interfaces:**
- Consumes: Task 2 file; `sendPush(recipientId, 'missions', title, body, payload)` from `src/services/push/pushService.ts`.
- Produces: `closeEvent(eventId: string): Promise<{ closed: boolean; playersStayed: number; podsLost: number }>`; `closeDueEvents(): Promise<void>`; `pushOpenedEvents(): Promise<void>`.

- [ ] **Step 1: Failing tests** — `src/services/events/__tests__/wormholeClose.test.ts` (same in-memory fake as Task 2, copied into this file; plus `vi.mock('../../push/pushService.js', () => ({ sendPush: vi.fn().mockResolvedValue(undefined) }))`):

```ts
// (fake Supabase block from Task 2 here, unchanged)
import { sendPush } from '../../push/pushService.js';
import { closeEvent, closeDueEvents, pushOpenedEvents } from '../wormhole.js';

function setupClose() {
  nextId = 1;
  db = {
    players: [
      { id: 'stayer', galaxy_id: 'g', current_system_id: 'target' },
      { id: 'returner', galaxy_id: 'g', current_system_id: 'home' },
      { id: 'wanderer', galaxy_id: 'g', current_system_id: 'elsewhere' },
    ],
    star_systems: [{ id: 'target', name: 'Farstar' }],
    wormhole_events: [{ id: 'e1', galaxy_id: 'g', target_system_id: 'target', starts_at: iso(-60), ends_at: iso(-1), closed_at: null, pushed_at: null }],
    wormhole_trips: [
      { id: 't1', event_id: 'e1', player_id: 'stayer', origin_system_id: 'home', returned_at: null },
      { id: 't2', event_id: 'e1', player_id: 'returner', origin_system_id: 'home', returned_at: iso(-10) },
      { id: 't3', event_id: 'e1', player_id: 'wanderer', origin_system_id: 'home', returned_at: null },
    ],
    expeditions: [
      { id: 'x1', player_id: 'stayer', status: 'in_progress', pod_lost: false, rewards: { iron: 3 } },
      { id: 'x2', player_id: 'returner', status: 'in_progress', pod_lost: false, rewards: { iron: 3 } },
      { id: 'x3', player_id: 'wanderer', status: 'in_progress', pod_lost: false, rewards: { iron: 3 } },
    ],
  };
}

describe('closeEvent', () => {
  it('loses in-progress pods only for players still at the target', async () => {
    setupClose();
    const r = await closeEvent('e1');
    expect(r).toEqual({ closed: true, playersStayed: 1, podsLost: 1 });
    expect(db.expeditions.find(x => x.id === 'x1')).toMatchObject({ pod_lost: true, rewards: null });
    expect(db.expeditions.find(x => x.id === 'x2')!.pod_lost).toBe(false);
    expect(db.expeditions.find(x => x.id === 'x3')!.pod_lost).toBe(false);   // left by normal travel
    expect(db.wormhole_trips.find(t => t.id === 't1')!.pods_lost).toBe(1);
    expect(db.wormhole_events[0].closed_at).toBeTruthy();
  });
  it('is idempotent', async () => {
    setupClose();
    await closeEvent('e1');
    expect(await closeEvent('e1')).toEqual({ closed: false, playersStayed: 0, podsLost: 0 });
  });
});

describe('closeDueEvents', () => {
  it('closes events past their end', async () => {
    setupClose();
    await closeDueEvents();
    expect(db.wormhole_events[0].closed_at).toBeTruthy();
  });
});

describe('pushOpenedEvents', () => {
  it('pushes once to every player in the galaxy when an event opens', async () => {
    setupClose();
    db.wormhole_events[0] = { ...db.wormhole_events[0], ends_at: iso(60) };
    await pushOpenedEvents();
    await pushOpenedEvents();
    expect((sendPush as any).mock.calls).toHaveLength(3);
    expect((sendPush as any).mock.calls[0][1]).toBe('missions');
    expect(db.wormhole_events[0].pushed_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL (functions missing).

- [ ] **Step 3: Implement** — append to `src/services/events/wormhole.ts` (and import `sendPush` and `podWord`):

```ts
/** Closes an event once: players still at the target stay and lose every expedition still in progress. */
export async function closeEvent(eventId: string): Promise<{ closed: boolean; playersStayed: number; podsLost: number }> {
  const nowIso = new Date().toISOString();
  const { data: claimed } = await supabase.from('wormhole_events').update({ closed_at: nowIso })
    .eq('id', eventId).is('closed_at', null).select('id, target_system_id');
  const ev = (claimed as any[] | null)?.[0];
  if (!ev) return { closed: false, playersStayed: 0, podsLost: 0 };   // already closed

  const { data: trips } = await supabase.from('wormhole_trips').select('id, player_id')
    .eq('event_id', eventId).is('returned_at', null);
  let playersStayed = 0, podsLost = 0;
  for (const trip of (trips as any[] | null) ?? []) {
    const { data: player } = await supabase.from('players').select('current_system_id').eq('id', trip.player_id).single();
    if ((player as any)?.current_system_id !== ev.target_system_id) continue;   // left another way: nothing lost
    playersStayed++;
    const { data: lost } = await supabase.from('expeditions')
      .update({ pod_lost: true, rewards: null, completes_at: nowIso })
      .eq('player_id', trip.player_id).eq('status', 'in_progress').select('id');
    const n = (lost as any[] | null)?.length ?? 0;
    podsLost += n;
    await supabase.from('wormhole_trips').update({ pods_lost: n }).eq('id', trip.id);
  }
  return { closed: true, playersStayed, podsLost };
}

/** Minute job: close events past their end time. */
export async function closeDueEvents(): Promise<void> {
  const { data } = await supabase.from('wormhole_events').select('id').is('closed_at', null).lte('ends_at', new Date().toISOString());
  for (const ev of (data as any[] | null) ?? []) await closeEvent(ev.id);
}

/** Minute job: push once to every player in the galaxy when an event's window opens. */
export async function pushOpenedEvents(): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data } = await supabase.from('wormhole_events').select('id, galaxy_id, target_system_id, ends_at')
    .is('pushed_at', null).is('closed_at', null).lte('starts_at', nowIso).gt('ends_at', nowIso);
  for (const ev of (data as any[] | null) ?? []) {
    const { data: claimed } = await supabase.from('wormhole_events').update({ pushed_at: nowIso }).eq('id', ev.id).is('pushed_at', null).select('id');
    if (!(claimed as any[] | null)?.length) continue;
    const target = await systemName(ev.target_system_id);
    const until = new Date(ev.ends_at).toISOString().slice(11, 16);
    const { data: players } = await supabase.from('players').select('id').eq('galaxy_id', ev.galaxy_id);
    for (const p of (players as any[] | null) ?? []) {
      void sendPush(p.id, 'missions', 'Wormhole open!', `A wormhole to ${target} is open until ${until} UTC.`, { type: 'wormhole', eventId: ev.id });
    }
  }
}
```

- [ ] **Step 4: Minute job** — in `src/index.ts` inside the `app.listen` callback, after the backfill interval setup, add:

```ts
  // Wormhole events: close the ones past their end (pod losses) and push the ones just opened
  setInterval(() => {
    void closeDueEvents().catch(err => console.error('[wormhole] close failed:', err));
    void pushOpenedEvents().catch(err => console.error('[wormhole] push failed:', err));
  }, 60 * 1000);
```

and import `{ closeDueEvents, pushOpenedEvents }` from `./services/events/wormhole.js`.

- [ ] **Step 5: Run** the close tests and the full suite `npx vitest run` + `npx tsc --noEmit -p .` — Expected: all pass, no type errors.
- [ ] **Step 6: Commit** — `git add src/services/events src/index.ts && git commit -m "Wormhole events: closing with pod losses, opening push, minute job" -m "Co-Authored-By: ..."`

---

### Task 4: Server — routes (player and admin)

**Files:**
- Create: `src/routes/wormholeEvents.ts` (player), `src/routes/adminWormhole.ts` (admin)
- Modify: `src/index.ts` (`app.use('/api/events/wormhole', wormholeEventsRouter)`), `src/routes/admin.ts` (`adminRouter.use('/wormhole-events', adminWormholeRouter)`)
- Test: `src/routes/__tests__/wormholeEvents.test.ts`

**Interfaces:**
- Consumes: Task 2/3 service functions and `WormholeError`.
- Produces: `GET /api/events/wormhole` → `WormholeStatus | null`; `POST /api/events/wormhole/jump` and `/return` → `{ systemId, systemName }` or 400 `{ error }`; admin `GET /api/admin/wormhole-events` → `{ events: [...] }`, `POST /api/admin/wormhole-events` body `{ galaxyId, targetSystemId, startsAt, endsAt }` → `{ id }`, `POST /api/admin/wormhole-events/:id/close` → close result, `GET /api/admin/wormhole-events/systems?galaxyId=` → `{ systems: [{ id, name }] }`.

- [ ] **Step 1: Failing tests** — mock `../../middleware/auth.js` (`requirePlayer` sets `req.playerId = 'p1'`, `req.authUserId = 'a1'`; `clearPlayerCache: vi.fn()`) and `../../services/events/wormhole.js` (`wormholeStatus`, `jump`, `returnHome` as `vi.fn`, real `WormholeError` class). Tests: GET returns the status JSON; jump returns 200 with the system and calls `clearPlayerCache('a1')`; jump rejecting with `new WormholeError('x')` → 400 `{ error: 'x' }`; return likewise. (Admin routes are exercised in Task 9 against staging; their guard is the existing `requireAdmin` on `adminRouter`.)

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** `src/routes/wormholeEvents.ts`:

```ts
// Galaxy Gardeners — wormhole event routes for players (services/events/wormhole.ts)
import { Router } from 'express';
import { requirePlayer, clearPlayerCache, type AuthenticatedRequest } from '../middleware/auth.js';
import { wormholeStatus, jump, returnHome, WormholeError } from '../services/events/wormhole.js';

export const wormholeEventsRouter = Router();
wormholeEventsRouter.use(requirePlayer);

wormholeEventsRouter.get('/', async (req, res) => {
  try { res.json(await wormholeStatus((req as AuthenticatedRequest).playerId)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

for (const [path, action] of [['/jump', jump], ['/return', returnHome]] as const) {
  wormholeEventsRouter.post(path, async (req, res) => {
    try {
      const result = await action((req as AuthenticatedRequest).playerId);
      clearPlayerCache((req as AuthenticatedRequest).authUserId);   // current system changed
      res.json(result);
    } catch (err: any) {
      res.status(err instanceof WormholeError ? 400 : 500).json({ error: err.message });
    }
  });
}
```

and `src/routes/adminWormhole.ts`:

```ts
// Galaxy Gardeners — admin: open, list and close wormhole events (mounted under /api/admin, behind requireAdmin)
import { Router } from 'express';
import { supabase } from '../db/supabase.js';
import { closeEvent } from '../services/events/wormhole.js';

export const adminWormholeRouter = Router();

adminWormholeRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase.from('wormhole_events')
    .select('id, galaxy_id, target_system_id, starts_at, ends_at, closed_at, created_at, star_systems(name), wormhole_trips(id, returned_at, pods_lost)')
    .order('starts_at', { ascending: false }).limit(50);
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ events: data ?? [] });
});

adminWormholeRouter.get('/systems', async (req, res) => {
  const galaxyId = String(req.query.galaxyId ?? '');
  const { data, error } = await supabase.from('star_systems').select('id, name').eq('galaxy_id', galaxyId).order('name');
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.json({ systems: data ?? [] });
});

adminWormholeRouter.post('/', async (req, res) => {
  const { galaxyId, targetSystemId, startsAt, endsAt } = req.body ?? {};
  if (!galaxyId || !targetSystemId || !startsAt || !endsAt || Date.parse(endsAt) <= Date.parse(startsAt)) {
    res.status(400).json({ error: 'galaxyId, targetSystemId, startsAt and a later endsAt are required' }); return;
  }
  // One event at a time per galaxy: refuse overlaps with an event that isn't closed
  const { data: overlap } = await supabase.from('wormhole_events').select('id')
    .eq('galaxy_id', galaxyId).is('closed_at', null).lt('starts_at', endsAt).gt('ends_at', startsAt).limit(1);
  if ((overlap ?? []).length) { res.status(409).json({ error: 'Another wormhole event overlaps that window' }); return; }
  const { data, error } = await supabase.from('wormhole_events')
    .insert({ galaxy_id: galaxyId, target_system_id: targetSystemId, starts_at: startsAt, ends_at: endsAt, created_by: (req as any).playerId ?? null })
    .select('id').single();
  if (error) { res.status(500).json({ error: error.message }); return; }
  res.status(201).json({ id: (data as any).id });
});

adminWormholeRouter.post('/:id/close', async (req, res) => {
  try { res.json(await closeEvent(req.params.id as string)); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});
```

Wire both routers as listed under Files.

- [ ] **Step 4: Run** the route tests, full suite and `tsc` — Expected: PASS / clean.
- [ ] **Step 5: Commit** — `git commit -m "Wormhole events: player and admin routes"`.

---

### Task 5: Admin page — Wormhole events section

**Files:**
- Modify: `web/admin/src/api.ts` (append types + calls), `web/admin/src/pages/EventsPage.tsx` (new section below Fuel Drops)

**Interfaces:**
- Consumes: Task 4 admin routes. `getGalaxies()` already exists in `web/admin/src/api.ts`.
- Produces: `getWormholeEvents()`, `getWormholeSystems(galaxyId)`, `createWormholeEvent(input)`, `closeWormholeEvent(id)`.

- [ ] **Step 1: API calls** — append to `web/admin/src/api.ts`:

```ts
// --- Wormhole events ---
export interface WormholeEvent {
  id: string; galaxy_id: string; target_system_id: string; starts_at: string; ends_at: string; closed_at: string | null;
  star_systems: { name: string } | null;
  wormhole_trips: { id: string; returned_at: string | null; pods_lost: number | null }[];
}
export async function getWormholeEvents(): Promise<WormholeEvent[]> {
  return (await request<{ events: WormholeEvent[] }>("/wormhole-events")).events ?? [];
}
export async function getWormholeSystems(galaxyId: string): Promise<{ id: string; name: string }[]> {
  return (await request<{ systems: { id: string; name: string }[] }>(`/wormhole-events/systems?galaxyId=${encodeURIComponent(galaxyId)}`)).systems ?? [];
}
export async function createWormholeEvent(input: { galaxyId: string; targetSystemId: string; startsAt: string; endsAt: string }): Promise<void> {
  await request("/wormhole-events", { method: "POST", body: JSON.stringify(input) });
}
export async function closeWormholeEvent(id: string): Promise<void> {
  await request(`/wormhole-events/${id}/close`, { method: "POST" });
}
```

- [ ] **Step 2: Section** — in `EventsPage.tsx`, add a `WormholeEvents` component (same `styles` object) rendered after the fuel drops table: a form with a galaxy `<select>` (from `getGalaxies()`), a searchable target `<input list="wh-systems">` + `<datalist>` of `getWormholeSystems(galaxyId)` names mapped back to ids, start (`datetime-local`, default now) and end (`datetime-local`, default now + 2 h), and an **Open wormhole** button calling `createWormholeEvent` with ISO times; a table of `getWormholeEvents()` with columns Target, Window (local times), Status (scheduled / open / closed, same badge colours as drops), Jumped (`wormhole_trips.length`), Returned (trips with `returned_at`), Pods lost (sum of `pods_lost`), and a **Close now** ghost button for open or scheduled events calling `closeWormholeEvent` after `confirm()`. Errors go to the page's existing error line.

- [ ] **Step 3: Build** — `cd web/admin && npm run build` — Expected: `tsc` and `vite build` succeed.
- [ ] **Step 4: Commit** — `git commit -m "Admin: wormhole events on the Events page"`.

---

### Task 6: Scene — event state, banner, jump/return, STEM, pod warnings

**Files:**
- Modify: `src/api.ts` (append)
- Create: `src/wormhole/state.ts`, `src/wormhole/banner.tsx`
- Modify: `src/ui.tsx` (render banner; star panel buttons in Task 7), `src/index.ts` (arrival hook), `src/stemChat.tsx` (wormhole answer)

**Interfaces:**
- Consumes: Task 4 routes.
- Produces: `api.getWormholeEvent(): Promise<WormholeStatus | null>`, `api.wormholeJump()`, `api.wormholeReturn()` (each → `{ systemId, systemName }`); `state.ts`: `wormholeEvent(): WormholeStatus | null`, `refreshWormhole(): Promise<void>`, `onWormholeChanged(fn: (prev, next) => void)`, `jumpThroughWormhole(): Promise<void>`, `returnThroughWormhole(): Promise<void>`, `setWormholeArrivedCallback(fn: () => Promise<void>)`, `setWormholeCutscenePlayer(fn: (kind: 'open' | 'jump' | 'close', midpoint?: () => Promise<void>) => Promise<void>)`, `closesInText(): string`.

- [ ] **Step 1: API** — append to `src/api.ts`:

```ts
// Wormhole events: admin-opened temporary wormholes to one system (server services/events/wormhole.ts)
export type WormholeStatus = {
  id: string; targetSystemId: string; targetName: string; startsAt: string; endsAt: string
  trip: { originSystemId: string; originName: string } | null
  podsOut: number; canJump: boolean; jumpBlockedReason: string | null; canReturn: boolean
}
export async function getWormholeEvent(): Promise<WormholeStatus | null> { return apiGet<WormholeStatus | null>('/api/events/wormhole') }
export async function wormholeJump(): Promise<{ systemId: string; systemName: string }> { return apiPost('/api/events/wormhole/jump') }
export async function wormholeReturn(): Promise<{ systemId: string; systemName: string }> { return apiPost('/api/events/wormhole/return') }
```

- [ ] **Step 2: State** — create `src/wormhole/state.ts`: module state `current: WormholeStatus | null`; `refreshWormhole()` fetches and, if the id or null-ness changed, calls listeners `(prev, next)`; a system polls every 60 s once `getToken()` is set; `jumpThroughWormhole()` / `returnThroughWormhole()` call the API (errors → `notify` red with the server message), then play the `'jump'` cutscene via the injected player with a midpoint that awaits the arrived callback (index's `reloadMap`), then `refreshWormhole()`; after a jump, if `podsOut > 0`, notify the pod warning. Pod warnings also fire once each when `endsAt - now` crosses 15 min and 2 min while `trip && canReturn && podsOut > 0` (tracked per event id). `closesInText()` formats `endsAt - now` as `H:MM:SS`. Listeners (registered in `index.ts`): `prev === null && next` → if `getPref('wormholeSeen') !== next.id` play `'open'` then `setPref('wormholeSeen', next.id)`; `prev && !next` → play `'close'`, then `reloadMap()` (the player may have lost pods), then STEM notification `"The wormhole to ${prev.targetName} has closed."` plus `" We lost contact with ${podWord(prev.podsOut)}."` when `prev.trip && prev.canReturn && prev.podsOut > 0`.

- [ ] **Step 3: Banner** — create `src/wormhole/banner.tsx` (`WormholeBanner` component): hidden when no event or sleeping; top-centre at `top: px(isViewingRemoteSystem() ? 70 : 20)`; violet accent `Color4.create(0.75, 0.45, 1, 1)`; text `WORMHOLE OPEN TO ${targetName.toUpperCase()}  ·  CLOSES IN ${closesInText()}`; button **JUMP** (enabled when `canJump`; disabled grey with `jumpBlockedReason` as a second line otherwise) or **RETURN TO ${trip.originName.toUpperCase()}** when `canReturn`; the pod warning line (amber) when `canReturn && podsOut > 0`. Render it in `ui.tsx` right after `<SurveyBar />`.

- [ ] **Step 4: Wiring** — in `index.ts`: `setWormholeArrivedCallback(() => reloadMap())`, register the open/close listeners above, `void refreshWormhole()` after startup completes. In `stemChat.tsx` `send()`: if `/wormhole/i.test(text)`, answer locally: with an event, `"A wormhole to ${targetName} is open until ${local HH:MM}. Jumping through is free and instant, and so is the way back until it closes. If we stay past closing with pods still out, we lose contact with them."`; without, `"No wormhole is open right now, Captain."`.

- [ ] **Step 5: Build** `npm run build` — Expected: clean. **Commit** — `git commit -m "Wormhole events in the ship: state, banner, jump and return, STEM"`.

---

### Task 7: Scene — hologram marker and star panel buttons

**Files:**
- Modify: `src/galaxyMap.ts` (marker), `src/ui.tsx` (star panel buttons), `src/index.ts` (keep marker in sync)

**Interfaces:**
- Consumes: Task 6 state.
- Produces: `setWormholeTarget(systemId: string | null): void` in `galaxyMap.ts`.

- [ ] **Step 1: Marker** — in `galaxyMap.ts` add `setWormholeTarget(id)`: stores the id and redraws a violet ring of 12 segments (reuse the `addProgressRing` segment math with radius `size/2 + 0.2`, colour `(0.75, 0.45, 1)`, emissive 2.0) around that star, parented to a pivot entity so `galaxyAnimationSystem` rotates the pivot at 40°/s; cleared with the map and redrawn in `renderStarSystems` if an id is set; respects the legend filters (hidden when the star is hidden).
- [ ] **Step 2: Sync** — in `index.ts`'s wormhole listener, call `setWormholeTarget(next?.targetSystemId ?? null)`.
- [ ] **Step 3: Star panel** — in `ui.tsx` `SystemInfoPanel`, when `wormholeEvent()` exists: selected star is the target and `canJump` → violet **JUMP THROUGH WORMHOLE** button (`jumpThroughWormhole()`); selected star is the current system, it is the target and `canReturn` → **RETURN THROUGH WORMHOLE**.
- [ ] **Step 4: Build** — clean. **Commit** — `git commit -m "Wormhole events: hologram marker and star panel buttons"`.

---

### Task 8: Scene — cutscenes (opened, jump, closed)

**Files:**
- Create: `src/wormhole/cutscene.ts`, `src/wormhole/flash.tsx`
- Modify: `src/tour/shots.ts` (add a `window` shot), `src/ui.tsx` (render flash + skip overlay), `src/index.ts` (`setWormholeCutscenePlayer(playCutscene)`)

**Interfaces:**
- Consumes: `applyShot` / `releaseShot` from `src/tour/shots.ts`.
- Produces: `playCutscene(kind: 'open' | 'jump' | 'close', midpoint?: () => Promise<void>): Promise<void>`; `isCutscenePlaying(): boolean`; `skipCutscene(): void`; flash alpha `flashAlpha(): number`.

- [ ] **Step 1: Window shot** — in `shots.ts` add `window: { pos: Vector3.create(128, PLATFORM_Y + 2.4, 126), lookAt: Vector3.create(128, 45, 80) }` to `SHOTS` and `'window'` to `ShotId`.
- [ ] **Step 2: Vortex** — `cutscene.ts` builds, on demand, a vortex root at `(128, 46, 84)` (between the window glass at z≈112 and the window star at z 58) facing the ship: three concentric rings (radius 3, 5.5, 8 m) of 24 emissive box segments each (violet → magenta → white inner), each ring under its own pivot rotated around the z axis (inner 90°/s, middle −60°/s, outer 35°/s); 24 streak quads (thin emissive boxes 0.08 × 1.6 m) on a spiral that are pulled inward over time. A timeline system drives `scale`, rotation speeds and the streaks per kind:
  - `open` (7 s): scale 0 → 1 over 2.5 s with ease-out, a white pulse via `flashAlpha` 0.35 at 2.5 s, spin 4.5 s, then hold; STEM line shown by the caller.
  - `jump` (6 s): scale 1 → 3 and root moved toward the ship to z 100 over 2.5 s while streaks stretch (scale z ×4), flash to 1 at 2.5 s, **midpoint** awaited while fully white (the reload swaps the window star), flash back to 0 over 1.5 s while the vortex shrinks 1 → 0 behind.
  - `close` (5 s): scale 1 → 0.15 over 3 s spinning faster, a snap to 0 with a flash 0.6 at 3.2 s, fade out.
  Each kind applies the `window` shot at start and `releaseShot()` at the end; the vortex entities are removed at the end. A skip (`skipCutscene()`) jumps to the end state immediately (running the midpoint if it hasn't run).
- [ ] **Step 3: Flash + skip** — `flash.tsx`: `WormholeFlash` renders a full-screen white `UiEntity` with alpha `flashAlpha()` (hidden at 0), and while `isCutscenePlaying()` a full-screen transparent `UiEntity` with `onMouseDown={skipCutscene}` and a small "CLICK TO SKIP" label bottom-right. Render both last in `ui.tsx` (before `SleepCurtain`).
- [ ] **Step 4: Hook up** — `index.ts`: `setWormholeCutscenePlayer(playCutscene)`; the `'open'` listener shows the STEM line after the cutscene: `"Captain, a wormhole just opened to ${targetName}! It's open until ${local HH:MM}."`.
- [ ] **Step 5: Build** — clean. **Commit** — `git commit -m "Wormhole cutscenes: opened, jump, closed"`.

---

### Task 9: Verify on staging

- [ ] **Step 1:** User runs migration 057 on staging; push the server branch to `staging` only; wait for Railway.
- [ ] **Step 2:** Point the local preview at staging (TEMP `API_BASE` in `src/api.ts` and `src/auth.ts`, uncommitted), `npm run start`.
- [ ] **Step 3:** From the admin site (staging), open an event to a system two or more jumps away, ending in 10 minutes. In the preview: the opening cutscene plays once (reload: it doesn't replay), the banner and the violet marker appear; with a pod deployed, JUMP → jump cutscene, window star changes, pod warning; RETURN → back to origin; JUMP again; wait for the close while at the target → closing cutscene, "lost contact with 1 pod", the pod shows destroyed on collect.
- [ ] **Step 4:** Revert the TEMP API change. With the user's approval: migration 057 on production, push the server to `main`, deploy the scene.
