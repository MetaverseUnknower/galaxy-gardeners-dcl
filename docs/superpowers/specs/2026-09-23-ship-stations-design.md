# Ship and Flora Stations — Design

Date: 2026-09-23

## Goal

Consolidate everything ship-related and everything inventory/flora-related onto two
physical stations inside the DaisyClass interior. Each station is a pair of desk
models already in the scene: a tall desk whose screen shows content, and a low desk
in front of it whose sloped screen holds the navigation buttons and a permanent
readout. The framework must be reusable so further stations are a config entry.

## Current state

- `src/shipDisplay.ts` draws a fuel gauge, ship stats, refine/purchase buttons and a
  paged missions list on a floating panel at the back (north) of the ship.
- `src/upgradesPanel.ts` draws the upgrades list on a floating panel at the east wall.
- `src/catalogPanel.ts` draws a species grid with a catalog/vault toggle on a floating
  panel above the west desk pair.
- All three position every entity in world coordinates from a hard-coded
  `DISPLAY_CENTER`, so moving a desk means re-tuning each file by hand.
- Desk models: `nav_panel_high_1.glb` (6m wide, screen body y 2.22..5.27) and
  `nav_panel_low_1.glb` (6m wide, sloped body y -0.2..2.51). The west pair sits at
  (117.2, DECK_Y, 121.3) with yaw `-32 + 90`; the east pair is its mirror across x=128
  with the yaw negated.

## Design

### Station framework (`src/stations.ts`)

A station is described by a config object:

```ts
interface StationConfig {
  id: string
  position: Vector3        // desk pair position on the deck (world)
  yaw: number              // desk facing, degrees, same convention as the existing desks
  tabs: TabDefinition[]    // ordered; first is the default
  readout: ReadoutRenderer // permanent strip on the low screen
}
```

`createStation(config)` spawns both desk models and two screen roots:

- **Top screen root**: on the tall desk's screen face. Its position, yaw and tilt
  relative to the desk origin are framework constants measured from the model
  geometry.
- **Low screen root**: on the low desk's sloped top, likewise from constants.

A screen root is an invisible entity carrying the world transform. Tabs and the
readout draw their entities as children of a root, using flat screen coordinates:
x across (negative left), y up, z a small positive offset off the glass. Tabs never
compute world coordinates.

Mirroring is a config entry with the same position reflected about x=128 and the yaw
negated; the framework does not special-case it.

The station object exposes `setTab(id)`, `refresh()` and `destroy()`. It remembers
the active tab across refreshes.

### Tabs

```ts
interface TabDefinition {
  id: string
  label: string
  render(root: Entity, ctx: StationContext): Promise<void>  // draw top screen
  clear(): void
  // Optional: a tab that only triggers an action (Refinery, Buy Fuel) sets
  // `action` instead of render/clear and draws nothing on the top screen.
  action?: () => void
}
```

`StationContext` gives a tab the shared dashboard data, a `notify(text, color)`
hook wired to the scene's notification toast, and `refresh()` to redraw after an
action.

### Low screen

Owned by the station, not the tabs. Draws one button per tab along the top edge of
the low screen, highlighting the active one, and calls the config's `readout` to
draw the permanent strip beneath them. Action tabs render as buttons that call
`action()` and do not change the active tab.

### Ship station (east pair)

- Tabs: Overview, Upgrades, Refinery (action: `openRefineryDialog`), Buy Fuel
  (action: `openPurchaseDialog`).
- Readout: fuel gauge with current/capacity, and the ship stats currently shown on
  the back panel.
- Overview tab: active expeditions with progress and collect buttons, paged, ported
  from `shipDisplay.ts` with local coordinates.
- Upgrades tab: the list from `upgradesPanel.ts`, two columns, install buttons,
  ported with local coordinates.

### Flora station (west pair)

- Tabs: Inventory, Vault, Catalog.
- Readout: specimen jars used against capacity, and species discovered count.
- Inventory tab: mined resources from the dashboard's `inventory` array as a list
  with quantities. New rendering, small.
- Vault tab: the `vault` view mode from `catalogPanel.ts`.
- Catalog tab: the `catalog` view mode from `catalogPanel.ts`, keeping the
  `setFloraSelectCallback` hook that drives the galaxy/system view.

### Data and refresh

- One shared `getShipDashboard()` fetch per station refresh feeds both the readout
  and the active tab. Catalog and upgrades lists are fetched only when their tab
  opens.
- Refresh triggers: tab switch, after any action on the station (collect mission,
  install upgrade, refine), and the existing scene-load path in `src/index.ts`
  where the three panels are created today.
- On fetch failure the tab draws one "Unable to load" line; the readout keeps its
  last values; the next refresh retries.

### Removals

- `src/shipDisplay.ts` and its back-of-ship panel.
- `src/upgradesPanel.ts` and its east-wall panel.
- `src/catalogPanel.ts` and its floating panel.
- The display-screen model north of center in `src/environment.ts`.
- The `createShipDisplay` / `createUpgradesPanel` / `createCatalogPanel` wiring in
  `src/index.ts`, replaced by two `createStation` calls. Notification and refinery/
  purchase callbacks are passed through the station context instead of module-level
  setters.

Unchanged: discovery desk and panel, galaxy map and its control panel, system view,
the 2D refinery and purchase overlays in `src/ui.tsx`, and `src/api.ts`.

### Screen geometry constants

Measured from the GLBs during implementation and recorded as comments next to the
constants:

- Tall desk: screen face center height, forward offset, and tilt.
- Low desk: sloped top center height, forward offset, and tilt.
- Usable screen size for each, so tabs know their bounds (about 5.5m wide on both).

## Verification

No test runner exists in this repo. Verification is:

1. `npm run build` type-checks clean.
2. In the local preview: switch every tab on both stations; collect a mission;
   install an upgrade; open Refinery and Buy Fuel from the ship station; select a
   species in Catalog and confirm the galaxy view responds; confirm the removed
   panels are gone.
3. Deploy to `metapetal.dcl.eth` and spot-check the same in the world.

## Out of scope

- A 3D refinery tab (the 2D overlay stays for now).
- Pods and fabrication UI.
- Any change to the API or server.
