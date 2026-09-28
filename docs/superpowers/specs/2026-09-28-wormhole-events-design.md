# Wormhole Events — Design

**Date:** 2026-09-28
**Status:** Draft for review
**Repos:** galaxy-gardeners-server (rules, routes, closing job, push, admin page), galaxy-gardeners-dcl (banner,
map marker, cutscenes, STEM). The iOS app follows as a separate spec once this API is settled.

## Goal

Admins can open a temporary wormhole from anywhere in the galaxy to a star system of their choice for a set event
window. Every player can jump there instantly and for free, and jump back to where they started while the window
is open, or stay at the target to use it. It's an event: it gathers players in one place, and staying has a price if
you left pods working back home.

## Rules

- **Event:** an admin picks a target star system, a start time and an end time (starting now or later). One event is
  open at a time per galaxy. Admins can close an event early.
- **Jump:** while an event is open, any player in that galaxy can jump to the target, from any system. Instant, no
  fuel. The server records the player's **origin system** for this event. A docked ship is undocked first; a ship in
  transit must arrive first ("Captain, we're mid-jump already — wait until we arrive"). Discovery scans carry on.
  A player already at the target can't jump.
- **Return:** a player who jumped during this event can return to their recorded origin, instant and free, any time
  before the event closes. They may jump again later in the window (the origin is recorded afresh each time they
  leave home). A player who left the target by normal travel can no longer "return" (the return belongs to the
  target).
- **Mission length:** a player who jumped through and hasn't come back can't launch a mining or exploration pod
  whose mission would end after the wormhole closes ("The wormhole closes in {n} minutes, Captain, and this mission
  would outlast it."). Discovery scans aren't limited.
- **Pods out:** a player at the target with pods still deployed (expeditions in progress started before or after the
  jump, anywhere) is warned by STEM: on arrival, 15 minutes before closing and 2 minutes before closing:
  "Captain, we have to get back to the wormhole or we'll lose contact with {n} pods!"
- **Closing:** when the event ends (its end time, or an admin closing it), every player still at the target **stays
  there**. Every player who jumped and hasn't come back through the wormhole (still at the target, or flown off
  elsewhere by normal travel) loses contact with their pods: every expedition still in progress is lost: `pod_lost = true`, `rewards = null`,
  `completes_at = now`, so collecting it reports the pod destroyed, exactly like a normal pod loss. Players who
  returned or never jumped are unaffected.
- **Push:** when an event opens, iOS players in that galaxy get a push notification ("A wormhole to {target} is open
  until {time}!") through the existing push service.

## Server

- **Migration 057 `wormhole_events`:**
  - `wormhole_events (id, galaxy_id, target_system_id, starts_at, ends_at, closed_at NULL, pushed_at NULL, created_by,
    created_at)`,
    `CHECK (ends_at > starts_at)`, index on `(galaxy_id, ends_at)`.
  - `wormhole_trips (id, event_id, player_id, origin_system_id, jumped_at, returned_at NULL, pods_lost INT NULL)`,
    one open trip (returned_at NULL) per player per event.
  - Row level security on, no grants to anon/authenticated (server-only, like the other game tables).
- **Service `services/events/wormhole.ts`:** `activeEvent(galaxyId)`, `jump(playerId)`, `returnHome(playerId)`,
  `closeEvent(eventId)` (applies the stay-and-lose-pods rule, sets `closed_at`, records `pods_lost` per trip), and
  `closeDueEvents()` for the timer. Pure helpers for the rules (can this player jump / return, is the event open)
  are unit tested with no database.
- **Routes:**
  - `GET /api/events/wormhole` → the open event for the player's galaxy, or `null`:
    `{ id, targetSystemId, targetName, startsAt, endsAt, trip: { originSystemId, originName } | null,
    podsOut: n, canJump, canReturn }`.
  - `POST /api/events/wormhole/jump`, `POST /api/events/wormhole/return` → the new system, like the existing
    `/api/ships/wormhole` reply. Errors: no open event, in transit, already there, no trip to return from (400).
  - Admin (`requireAdmin`): `POST /api/admin/wormhole-events` (create), `POST /api/admin/wormhole-events/:id/close`,
    `GET /api/admin/wormhole-events` (recent events with trip counts and pods lost).
- **Closing job:** every minute (same pattern as the existing interval jobs in `index.ts`) `closeDueEvents()` closes
  events past `ends_at`; closing is idempotent (guarded by `closed_at`).
- **Push on open:** when an event's start time arrives (the same minute job) the push goes out once
  (`pushed_at` column guards repeats).
- **Admin page:** a "Wormhole events" section on the admin site's Events page: pick a galaxy and a target system
  (searchable), start (now or a time), end; list of events with status, jumps, returns, pods lost; Close now.

## Decentraland ship

- **Status:** the scene reads `GET /api/events/wormhole` on load and every minute, plus after a jump or return.
  (The guide WebSocket could push event changes instantly later; the minute poll is enough for an event.)
- **Banner:** while an event is open: "WORMHOLE OPEN TO {TARGET} · CLOSES IN 1:42:10" with **JUMP** (or
  **RETURN HOME** when the player is at the target with a trip), and the pod warning line when it applies.
- **Hologram:** the target star gets a swirling wormhole ring (rotating dashed ring segments, violet); its star panel
  shows **JUMP THROUGH WORMHOLE** / **RETURN THROUGH WORMHOLE** alongside the usual buttons.
- **Cutscenes** (5–8 s each, skippable with a click, played from a fixed camera out of the front window using the
  existing tour camera shots and a full-screen fade):
  - *Wormhole opened*: once per event per player (remembered in preferences): a vortex spins up in space outside the
    window (growing, rotating emissive ring segments and inward-spiralling streaks, a light pulse). STEM: "Captain, a
    wormhole just opened to {target}! It's open until {time}."
  - *Jump* (either way): the vortex rushes at the ship, streaks stretch into a tunnel, a white flash; the window's star
    becomes the new system's star; the vortex collapses behind.
  - *Wormhole closed*: if aboard when it closes: the vortex shrinks and snaps shut with a flash. STEM says where the
    ship ended up and, if so, "… we lost contact with {n} pods."
  The vortex is built from pieces already proven in this scene (segment rings, rotation, scale, emissive materials,
  2D fade). The SDK's particle system may add sparks if it proves to work in the current explorer; the cutscenes
  must not depend on it.
- **STEM:** answers "wormhole" questions with the target, closing time and the pod rule (client-side, like the tour
  shortcut); the pod warnings are STEM lines in the notification banner.

## iOS (separate follow-up spec)

Banner with jump / return, pod warnings, a simpler 2D open / jump / close animation, and the push notification
(server side here). Until the app update ships, iOS players get the push but can only join in Decentraland.

## Testing

- Server: unit tests for the rule helpers (open window, can jump / return, pods-out count); route tests for jump,
  return and their refusals; `closeEvent` loses in-progress pods only for players still at the target and is
  idempotent; the admin routes require admin; the push is sent once.
- Scene: build check plus a manual pass in the local preview against staging: open an event from the admin page, see
  the opening cutscene and banner, jump with a pod out (warning), return, jump again, let it close while at the
  target (closing cutscene, pods lost), and a second player (guide mode) joining.

## Out of scope

- More than one simultaneous event per galaxy.
- Charging fuel or travel time for the jump.
- Event wormholes between two arbitrary systems (always from anywhere to the target).
