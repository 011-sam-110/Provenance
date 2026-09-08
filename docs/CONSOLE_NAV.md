# The console nav bar — an expanding, per-scene control surface

The console's 34px top bar (`components/terminal/TerminalHeader.tsx`) is no longer
just a row of board tabs. Hovering a tab makes **the whole bar grow downward** into
a panel holding that board's quick settings and a show/hide list of its widgets,
and those choices are remembered **per board**. It is modelled closely on Apple's
own site navigation, including the part people usually miss: **hover previews,
click commits.**

This document is the map. Read it before changing anything in the bar, the panel,
or per-scene state — several of the decisions below look arbitrary and are not.

## Vocabulary: scene = board = preset

One thing, three words that were already in the codebase, now deliberately fused.

A `ConsolePreset` (`lib/console/presets.ts`, seven built-ins) **is the whole
workspace**: the core layers it lights, the signal layers it lights, and the board
of widgets that reads them. `activePresetStore` tracks which one is live;
`boards.ts` archives each one's arrangement under its own id.

`sceneId` everywhere in this feature **is a `ConsolePreset.id`**. There is no
separate "scene" concept, no scene registry, and nothing to keep in sync. If you
find yourself adding one, that is the mistake this paragraph exists to prevent.

## The two stores, and why there are two

| Store | File | Answers |
|---|---|---|
| `navPanelStore` | `lib/console/navPanel.ts` | *Is a panel open, and whose?* |
| `sceneChromeStore` | `lib/console/sceneChrome.ts` | *What does a given scene hide, and what are its quick settings?* |

Both follow the shape every other shell store here uses — module state, a listener
`Set`, `useSyncExternalStore` — because their setters must be callable from plain
DOM handlers (a checkbox `onChange`), which is the same reason `activePreset.ts`
and `mapRail.ts` are not React context either.

`navPanelStore` is ephemeral and deliberately not persisted: a bar that reopened
itself on load would be a bar that ambushes you.

### Why `sceneChrome` is a sibling store and not a field on `ShellLayout`

This was the central persistence decision and it is worth not re-litigating.

`boards.ts`'s `BoardArchive` holds real **arrangements** — rects, rail order,
sizes — and `layoutSignature()` reads it to decide the "customised" dot and what
Reset throws away. Folding `hidden`/`quick` into `ShellLayout` would have meant
editing `sanitizeLayout`, editing (or carefully *not* editing) `layoutSignature`,
editing the `?c=` share-link codec in `share.ts`, and making a product call about
whether hiding a widget should light the customised dot and be destroyed by Reset.

None of that was asked for, and getting any of it wrong breaks Reset or shared
links for **every** board, not just this feature. Keeping chrome in its own store
means resetting a board's layout does not un-hide its widgets — the same way
resetting a board does not change your language or theme.

Consequence worth knowing: **`?c=` share links do not carry hidden state.** A
shared layout arrives with everything visible. That is a deliberate trade, not an
oversight — visibility is a personal viewing preference, like a collapsed rail.

**Key:** `tn.console.sceneChrome.v1`, version 1, through the existing
`loadPersisted`/`savePersisted`. Sanitised on the way **out**, never on the way in
— what lands there is a live value this app produced; what comes *back* is
untrusted (another tab, an older build, devtools).

## Hiding is a paint-time filter, not a layout mutation

This is the single most important invariant in the feature.

Removing a widget (the ✕ on `WidgetFrame`, `shellLayoutStore.remove`) **deletes**
it and its config forever. Hiding it here only stops it rendering:

- The instance, its position and its config are untouched.
- A hidden widget **keeps its slot** — nothing compacts around it, and un-hiding
  puts it back exactly where it was.
- A hidden widget still counts toward `MAX_WIDGETS`, the capacity toast, the
  "N ▦" counter and `isSourceWidgetOpen`. It is still *on* the workspace; it is
  merely not painted.

The whole mechanism is one pure function, `visibleWidgets(widgets, sceneId)`,
applied at exactly two render sites — `ConsoleWorkspace.tsx` (rails) and
`WallWorkspace.tsx` (wall boards). Nothing in the layout engine knows this feature
exists, which is why its blast radius is zero.

> **Streets is blunt on purpose.** It is the one `mode: "wall"` board and all its
> tiles are type `camslot`, so hiding that type hides the entire wall. Visibility
> is per widget *type*, and that is the honest consequence. It is not
> special-cased.

### The subscription trap — read this before touching either render site

Both render sites were, at one point, **silently broken in exactly this way**, and
the store-level unit tests were green the whole time. Only a real browser could
see it. Both failure modes are one line each:

1. **`ConsoleWorkspace.tsx`** memoises its per-rail arrays. `visibleWidgets` reads
   the hidden set out of the store by `sceneId`, so hiding a widget changes the
   memo's *result* **without changing `layout` or `sceneId`** — a memo keyed on
   `[layout, sceneId]` is never invalidated, and the stale arrays paint again.
   `chrome` **must** be in that dependency array.
2. **`WallWorkspace.tsx`** calls `visibleWidgets` inline (no memo, so no stale-memo
   problem) but needs a *subscription* or nothing re-renders it when `setHidden`
   fires. Hence the bare `useSceneChrome(sceneId);` — subscribed, not read, the
   same pattern and the same reason as `BoardTabs`' bare `useShellLayout()`.

Both are guarded by e2e, not unit tests, because **no unit test in a node
environment can catch either one.**

## The bar's structure and state machine

```
.tnx-navshell                 ← the thing that visibly "grows"; flex column
├── header.tnx-hdr            ← the 34px bar: brand │ tabs │ spacer │ right cluster
└── .tnx-nav-panel#tnx-nav-panel
    └── .tnx-nav-panel-inner  ← the MEASURED node
.tnx-nav-scrim                ← sibling; dims the page below, closes on click
```

Timings live in `lib/console/navPanel.ts` as named constants — change them there,
never inline:

| Constant | Value | Meaning |
|---|---|---|
| `HOVER_OPEN_DELAY_MS` | 100 | mouseenter → open, **from closed only** |
| `CLOSE_GRACE_MS` | 300 | pointer leaves the whole navshell → close |
| `HEIGHT_TRANSITION_MS` | 220 | the `max-height` ease |
| `CROSSFADE_MS` | 150 | content cross-fade |

`nextOpenDelay()` is the whole "moving between labels re-sizes without closing"
rule, expressed purely so a unit test can hold it without a real timer: **0 when a
panel is already open** (instant retarget), `HOVER_OPEN_DELAY_MS` when closed
(debounce against a mouse merely passing through).

`mouseleave` is bound to **`.tnx-navshell`**, not to the tabs — the tabs and the
panel are one hover region, so moving the pointer down into the panel is never a
"leave".

### Height cannot be animated to `auto`

`.tnx-nav-panel-inner` is measured with a `ResizeObserver`; the result is written
as `--tnx-navpanel-h` (a px value) and `.tnx-nav-panel` transitions `max-height` to
it. Do not replace this with `height: auto` (untransitionable) or a hardcoded cap
(clips a board with many widgets).

> If `--tnx-navpanel-h` ever reads as the empty string, the measurement pipeline is
> dead and every panel is silently riding the CSS fallback constant — which *looks*
> fine right up until a board's content exceeds it. This happened once, from a
> `panelRef` that was declared and read but never attached via `ref=`.

Retargeting between two boards re-measures and eases the difference; it does **not**
restart from `max-height: 0`.

## Accessibility, and one trap that is not obvious

- The panel is **`role="region"`, never `role="dialog"`.** `ConsoleShell.tsx`'s
  global keydown handler bails out entirely when a `[role="dialog"]` is present, so
  that role would silently disable the app's whole keyboard layer for as long as the
  panel was open — a far worse regression than anything about the nav.
- Because it is not a dialog, Escape ordering is not automatic. `TerminalHeader`
  mounts its own `window` keydown listener and calls `stopImmediatePropagation()`
  after closing, so the same press does not also run ConsoleShell's
  picking-mode/selection-clear. This relies on React mounting child effects before
  parent effects, and it has been **verified empirically in a browser** (by tagging
  every registered window keydown listener and observing which actually fired) —
  not merely reasoned about. Re-verify it the same way if you reorder these mounts.
- Hover is gated on `(hover: hover) and (pointer: fine)`, read **once**, not per
  event. Coarse pointers never get the preview; `.tnx-hdr-nav-toggle` is their
  entry point, and it always scopes to the **active** board.
- Focus is never stolen. The panel sits in normal DOM flow directly after the
  header, so Tab reaches its controls without any focus-management code.
- Closed, the panel carries the `hidden` **attribute**, not merely CSS — its
  controls stay out of the tab order and the accessibility tree.
- Under `prefers-reduced-motion` the transitions collapse to instant, but the
  **debounce timers stay**. They are pacing, not animation; removing them would make
  the panel flash open on every incidental mouse pass, which is worse for exactly
  the users that query serves.

## The header has to *fit*, not merely contain its overflow

At 1280×720 — one of this app's own pinned widths — the seven tabs plus Reset plus
the toggle want 681px in a 616px box.

The first attempt gave `.tnx-hdr-boards` `overflow-x: auto`. That correctly stopped
the tabs painting over `.tnx-hdr-right` (they had been, which made the toggle's
click land on DISCORD) — but it fixed it by **clipping the toggle out of view**,
leaving the panel's only touch-reliable entry point unreachable without
horizontally scrolling a bar nobody would think to scroll.

The row is now made to fit: tab padding drops 13px → 8px between 901px and 1439px,
returning 70px against a 65px shortfall. The `overflow-x: auto` stays as the
backstop. Two e2e tests pin this at 1280 and **neither may use `force: true` or
`scrollIntoViewIfNeeded()`** — routing around the hit test is precisely what would
hide a return of the bug.

## Where the tests are

| File | Covers |
|---|---|
| `tests/unit/scene-chrome.test.ts` | the store contract, the per-scene isolation case, `boardWidgetTypes`' four branches, `visibleWidgets` |
| `tests/unit/nav-panel.test.ts` | `nextOpenDelay`, `boardStep` wrap-around, redundant-call-no-emit |
| `tests/e2e/nav-panel.spec.ts` | everything only a browser can show: real hover and timers, retarget, Escape ordering, the 1280 fit, and **that hiding a widget actually changes the DOM** |

The last of those is not redundant with the unit tests. The store was never wrong;
the rendering was. Assert on the DOM.

## Known non-goals

Deliberately out of scope, so nobody "finishes" them by accident: a second quick
setting beyond `compactCards`; drag-to-reorder inside the widget list (it is
visibility only); any change to `MAX_WIDGETS` or the capacity toast; any change to
wall-mode tile placement; a richer touch story (double-tap / long-press) for
previewing a board you are not on.
