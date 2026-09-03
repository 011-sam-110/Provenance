# Retiring the `cameras` widget in favour of `camslot`

**Date:** 2026-09-03
**Status:** design approved; implementation plan pending
**Base:** `origin/main` @ `0596d6e`
**Origin:** user request — replace the old camera widget on the console with the newer one built for
the Streets board, and let the Sources rail add that newer one.

Every claim below carries `file:line` where it was checked against `0596d6e` on 2026-09-03.

**`main` moves during a working session, and it moved during this one.** PR #146, the console
reskin, landed between the first read of this code and this document. It rewrote `sanitize.ts` and
shifted `presets.ts` by 63 lines, which made an early draft of this spec cite line numbers that no
longer existed. Every number here was re-read against `0596d6e` afterwards. Re-read them again
before you edit anything, and treat a line number that does not match as a moved file rather than
as a mistake in the design.

---

## 1. What this is

The console registers two camera widgets. This spec removes one of them.

- `cameras` (`lib/console/widgets/cameras.tsx:77`) draws a six-tile grid of whatever the map has
  already loaded. It takes no configuration. It raises one alert per camera the operator flags
  unavailable.
- `camslot` (`lib/console/widgets/camslot.tsx`, registered as title **Camera wall**) draws a
  playlist you build yourself. It shows one view at a time and rotates on a timer. Each frame
  carries a corner line that states what the road surface is doing, what the air is doing, and the
  local clock at the camera.

After this change the `cameras` widget type does not exist. Every place that named it names
`camslot`. Saved layouts and `?c=` share links that carry the old type are rewritten as they load.

## 2. Ground truth (measured 2026-09-03 — this rots, re-measure)

| Fact | Value | Source |
|---|---|---|
| Old widget | 91 lines | `lib/console/widgets/cameras.tsx` |
| Old focus view | 328 lines | `lib/console/widgets/cameras.detail.tsx` |
| Old alert rule | 13 lines | `lib/console/widgets/cameras.rules.ts` |
| New widget | 633 lines | `lib/console/widgets/camslot.tsx` |
| New focus view | 383 lines | `lib/console/widgets/camslot.detail.tsx` |
| Where the old widget appears on a board | Brief only | `lib/console/presets.ts:225` |
| Where the new widget appears on a board | Streets, four slots | `lib/console/presets.ts:352-355` |
| Both widgets' category and height | `"Cameras"`, `260` | both registration blocks |

**Not measured, and deliberately not quoted as a measurement.** The `12236` and `278` figures in
this design's review page came from the user's screenshot of a running console. They are not a
reading of `/api/coverage`. Do not copy them into a README or a PR description.

## 3. What the change costs

Four things go. None of them arrives somewhere else. This section exists so that nobody later reads
the diff and thinks the loss was accidental.

1. **The offline alerts.** `cameraAlerts` (`lib/console/widgets/cameras.rules.ts:5`) raises a `warn`
   for every camera whose `available` flag is false. That produces the amber badge in the widget
   header and the "Needs attention" list under it. `camslot` reports `alerts: []`
   (`lib/console/widgets/camslot.tsx:355`).
2. **The auto-filled grid.** The old widget read `loadedCamerasStore` and showed the first six
   cameras with no user choice. `camslot` reads its own config. An unconfigured slot shows
   "＋ Add a camera" and "◎ Pick cameras on the map".
3. **The camera console.** The old widget's focus view holds a coverage masthead with a count
   sparkline, a per-operator coverage bar, operator and region filters, a region inset map, still
   and live camera walls, a sortable table with a per-camera dossier, and CSV and GeoJSON export.
   Nothing else in the app opens it — `CamerasDetail` has exactly one importer
   (`lib/console/widgets/cameras.tsx:26`).
4. **Its supporting code.** `hlsSlots`, `useHlsActive` and `HLS_CAP` have one caller
   (`lib/console/widgets/cameras.detail.tsx:24`). `coverage()` and `byWallPriority()` have one
   caller, the same file. Both lose it.

The Sources rail keeps its own camera filter panel. That is `CameraFilters`
(`components/shell/SourceCatalog.tsx:261`), a different component, and this change does not touch
it.

## 4. Files deleted

| File | Why it can go |
|---|---|
| `lib/console/widgets/cameras.tsx` | The widget. |
| `lib/console/widgets/cameras.detail.tsx` | Its focus view. One importer, deleted above. |
| `lib/console/widgets/cameras.rules.ts` | Two importers: the widget and one test, both deleted. |
| `lib/cameras/concurrency.ts` | Two importers: `cameras.detail.tsx` and its own test, both deleted. |
| `tests/unit/console-cameras.test.ts` | Covers the deleted alert rule. |
| `tests/unit/cameras-concurrency.test.ts` | Covers the deleted HLS cap. |
| `tests/unit/cameras-coverage.test.ts` | Covers `coverage` and `byWallPriority` and nothing else (`tests/unit/cameras-coverage.test.ts:2`). |

`lib/cameras/coverage.ts` is **edited, not deleted**. `useCameras` still imports the `CameraLite`
type from it (`lib/cameras/useCameras.ts:13`).

## 5. Files edited

| File | Change |
|---|---|
| `lib/console/sanitize.ts` | Add the type migration. See §6. |
| `lib/console/presets.ts:225` | Brief becomes `{ type: "camslot", weight: 2 }`. |
| `lib/console/sourceWidgets.ts:22` | `CORE_TO_WIDGET.cameras` becomes `"camslot"`, so the Sources rail ＋ on the Cameras row adds a camera wall. |
| `lib/console/paletteGroups.ts:101` | `POPULAR_WIDGET_IDS` carries `"camslot"` in place of `"cameras"`. |
| `lib/console/presetLayers.ts:14` | Remove `cameras: "cameras"`. `camslot: "cameras"` already exists at line 22 and covers the board. |
| `lib/console/help.ts:104` | Remove the `cameras` explainer. `camslot` has its own at line 122. |
| `lib/console/widgets/index.ts` | Remove the `cameras` import. |
| `lib/cameras/coverage.ts` | Keep the `CameraLite` type. Remove `coverage()` and `byWallPriority()`. |

## 6. The migration

`sanitize.ts` accepts any string as a widget type. It checks that `o.type` is a string
(`lib/console/sanitize.ts:80`) and then copies it through unchanged (`sanitize.ts:83`). It does
not check the type against the registry.

`WidgetFrame` looks the type up and returns `null` when it finds nothing
(`components/console/WidgetFrame.tsx:103`).

Those two facts together produce the failure this migration exists to stop. A board saved before
this change, or a `?c=` link already sent to somebody, carries `type: "cameras"`. After the swap
that type resolves to nothing. The tile renders as empty space. It still holds its rect in the grid,
so the board shows a hole with no error and nothing to click.

Add this to the widget loop in `sanitize.ts`, above the `readConfig` call at line 89:

```ts
// The `cameras` widget was retired in favour of `camslot`. An unmigrated type is not
// an error anyone can see: WidgetFrame renders null for an unregistered type, so a
// board or a ?c= link written before the swap would show a hole where a tile used to
// be. Renaming it here lands it on camslot's empty state instead.
const RETIRED_TYPES: Record<string, string> = { cameras: "camslot" };
const type = RETIRED_TYPES[o.type] ?? o.type;
```

Then pass `type` to both the widget's `type` field and to `readConfig(type, o.config)`.

The old widget stored `{}` as its config (`lib/console/widgets/cameras.tsx:82`). `readConfig`
routes a `camslot` type through `sanitizeCamslotConfig` (`sanitize.ts:44`), which turns `{}` into a
config with an empty stream list. A migrated tile therefore lands on the same "＋ Add a camera"
state that a fresh Brief board shows. The two agree because one code path produces both, not
because two code paths were written to match.

## 7. Decisions taken, and how to reverse them

Three calls were made during design. Each is recorded with its reason so that a later reader can
reverse it on purpose rather than by accident.

1. **The camera console is deleted, not rehomed.** The alternative was a two-tab focus view on
   `camslot`: "This slot" for the day-history strip it already has, "All cameras" for the old
   console. The user chose deletion. To reverse it, restore `cameras.detail.tsx` and
   `lib/cameras/concurrency.ts` from this commit's parent and mount the component as a second tab.
2. **The Brief board's camera wall ships empty.** The alternatives were a curated playlist, as
   Streets uses, or a new fallback that fills an empty slot from the map. The user chose the empty
   state. The landing board therefore opens with a tile that invites you to add a camera.
3. **The widget title stays "Camera wall".** It does not become "Cameras". The Streets spec recorded
   the reason (`docs/superpowers/specs/2026-08-15-streets-board-design.md` §1.1): the word already
   names several different things, so one more makes the ⌘K entry for "cameras" ambiguous. Deleting
   the old widget removes one of those uses and leaves three — the map layer key
   (`lib/layers.ts:18`), the widget category (`lib/console/widgets/camslot.tsx:619`), and the ⌘K
   palette section (`lib/console/paletteGroups.ts:73`). The collision the Streets spec named is
   therefore still there, and this design does not add a fourth use to it. Reversing the call is a
   one-line title change and nothing more: the id `camslot` is pinned by `?c=` links and never
   changes.

## 8. Tests

Write the new test first and watch it fail. A pinning test that nobody saw go red proves nothing.

| Test | Change |
|---|---|
| `tests/unit/console-sanitize-migrate.test.ts` | **New.** Persisted JSON carrying `type: "cameras"` comes back as a `camslot` whose stream list is empty. |
| `tests/unit/source-widgets.test.ts:55` | `widgetTypeForSource("cameras")` now answers `"camslot"`. |
| `tests/unit/console-presets.test.ts:7,18` | `CORE_WIDGETS` and `CORE_MONITORS` name `camslot` in place of `cameras`. The monitor count stays at seven. |
| `tests/unit/widget-explainers.test.ts:172` | Retarget to `camslot`. The file's real invariant is that every registered type has a trust card, and that invariant must still hold. |

**One test gives false comfort here, and the implementer must know it.**
`tests/unit/preset-layers.test.ts:48` asserts that the Brief board lights the `cameras` map layer.
It passes before and after this change, because `presetLayers.ts:22` maps `camslot` to that same
layer. It cannot catch a mistake in this work. Update its comment at line 52, which says "cameras
card", and do not treat its green as evidence. The new sanitize test is the one doing real work.

## 9. Out of scope

- No change to the `cameras` **map layer**, its adapters, or `lib/sources/*`. The word `cameras`
  appears throughout those files as a layer key and a source id. It is not the widget type and it
  stays.
- No change to `camslot` behaviour. This spec moves the widget. It does not edit it.
- No change to `lib/cameraFilter.ts`, which `WorldMap`, `SourceCatalog` and `lib/variants/*` all
  use.
- No new fallback that fills an empty `camslot` from the map. See §7.2.

## 10. Gate

1. `npx tsc --noEmit && npm test`
2. `npm run build`
3. Playwright screenshots into `persona-shots/`: the Brief board with its empty camera wall, and the
   Sources rail ＋ on the Cameras row after it adds one.
4. Grep for any remaining reference to the widget type: `grep -rn '"cameras"' lib/console components/console`. Every surviving hit must be a layer key or a source id, not a widget type. Read each hit before you change it.
