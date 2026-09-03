# Cameras widget retirement — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the `cameras` console widget, point everything that named it at `camslot`, and migrate saved layouts so no board shows a hole where a tile used to be.

**Architecture:** Five tasks, each leaving the tree green and each independently rejectable. Task 1 adds the migration that makes every later deletion safe. Task 2 re-points the four registries. Tasks 3 and 4 delete the widget and then the code only its focus view used. Task 5 runs the gate and captures evidence.

**Tech Stack:** Next.js 15, TypeScript, vitest (NODE environment, `tests/unit/**/*.test.ts`), Playwright for UI evidence. No React testing library is installed — there are no component tests, so every test here is over pure functions.

**Spec:** `docs/superpowers/specs/2026-09-03-cameras-widget-retirement-design.md`

## Global Constraints

- Work in the worktree `.claude/worktrees/camslot-retire`, branch `feat/retire-cameras-widget`, base `0596d6e`. Do not `cd` to the repo root.
- `node_modules` is already junctioned into the worktree. **Never run `npm install` here.**
- Commit style: **solo attribution, no `Co-Authored-By` trailer.** Every commit in this repo follows that, and `CLAUDE.md` requires it.
- Stage explicit paths. Never `git add -A` — this repo holds untracked scratch directories.
- Gate: `npx tsc --noEmit && npm test`. Full check: `npm run build`.
- The word `cameras` names a **map layer key**, a **catalogue source id**, a **widget category** and a **⌘K palette section** as well as the widget type. Only the widget type is being removed. Read every grep hit before changing it.
- Line numbers below were read against `0596d6e`. `main` moves fast. If a number does not match, find the code by its content and carry on — a moved line is not a design error.

---

### Task 1: The sanitize migration

`sanitize.ts` copies any string type straight through (`lib/console/sanitize.ts:80,83`) and `WidgetFrame` renders `null` for an unregistered one (`components/console/WidgetFrame.tsx:103`). Every board and every `?c=` link written before this change carries `type: "cameras"`. This task is what stops them becoming holes. It lands **first**, so that every deletion after it is already safe.

**Files:**
- Create: `tests/unit/console-sanitize-migrate.test.ts`
- Modify: `lib/console/sanitize.ts:76-91`

**Interfaces:**
- Consumes: `sanitizeLayout(raw: unknown): ShellLayout | null` from `@/lib/console/sanitize`; `sanitizeCamslotConfig` is already imported by that module at line 6.
- Produces: nothing new is exported. Later tasks rely only on the behaviour that a persisted `type: "cameras"` loads as a `camslot` with `config.streams === []`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/console-sanitize-migrate.test.ts`:

```ts
import { expect, test } from "vitest";
import { sanitizeLayout } from "@/lib/console/sanitize";

// A board saved before the `cameras` widget was retired — or a ?c= link already sent
// to somebody — carries `type: "cameras"`. Nothing registers that type any more, and
// WidgetFrame renders null for an unregistered type. Without the migration the tile
// becomes a hole that still holds its place in the grid: no error, nothing to click.
function savedBeforeTheSwap() {
  return {
    stage: "map2d",
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    widgets: [
      { id: "w1", type: "cameras", segment: "left", order: 0, height: 240, collapsed: false, config: {} },
    ],
  };
}

test("a board saved with the retired `cameras` widget loads as a camera wall", () => {
  const out = sanitizeLayout(savedBeforeTheSwap());
  expect(out).not.toBeNull();
  expect(out!.widgets).toHaveLength(1);
  expect(out!.widgets[0].type).toBe("camslot");
});

test("the migrated tile lands on camslot's own empty state, not a half-built config", () => {
  // The old widget stored {} as its config. Routing the RENAMED type through
  // readConfig is what sends it to sanitizeCamslotConfig, so a migrated tile is
  // identical to a freshly added one rather than merely similar to it.
  const out = sanitizeLayout(savedBeforeTheSwap());
  expect(out!.widgets[0].config.streams).toEqual([]);
});

test("a type nobody retired is passed through untouched", () => {
  const out = sanitizeLayout({
    stage: "map2d",
    segments: {
      left: { size: 300, collapsed: false },
      right: { size: 300, collapsed: false },
      bottom: { size: 220, collapsed: false },
    },
    widgets: [
      { id: "w1", type: "camslot", segment: "left", order: 0, height: 240, collapsed: false, config: { streams: [] } },
      { id: "w2", type: "events", segment: "left", order: 1, height: 240, collapsed: false, config: {} },
    ],
  });
  expect(out!.widgets.map((w) => w.type)).toEqual(["camslot", "events"]);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npx vitest run tests/unit/console-sanitize-migrate.test.ts`

Expected: the first two tests FAIL. The first reports `expected 'cameras' to be 'camslot'`. The third test passes already — it is the control, and it must stay green throughout.

Do not continue until you have seen that failure. A migration test that was never red proves nothing about the migration.

- [ ] **Step 3: Add the rename to the widget loop**

In `lib/console/sanitize.ts`, the loop currently reads:

```ts
    const o = w as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    parsed.push({
      id: o.id,
      type: o.type,
```

and ends that object with:

```ts
      config: readConfig(o.type, o.config),
```

Change it to:

```ts
    const o = w as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.type !== "string") continue;
    // The `cameras` widget was retired in favour of `camslot` (see
    // docs/superpowers/specs/2026-09-03-cameras-widget-retirement-design.md). An
    // unmigrated type is not an error anyone can see: WidgetFrame renders null for
    // an unregistered type, so a board or a ?c= link written before the swap would
    // show a hole where a tile used to be. Renaming it here lands it on camslot's
    // empty state, which is what a fresh board shows in the same slot.
    const type = RETIRED_TYPES[o.type] ?? o.type;
    parsed.push({
      id: o.id,
      type,
```

and change the config line to:

```ts
      config: readConfig(type, o.config),
```

Add the table beside the other module constants near the top of the file, under the `num` helper on line 11:

```ts
/** Widget types that no longer exist, and what they load as instead. */
const RETIRED_TYPES: Record<string, string> = { cameras: "camslot" };
```

Passing the renamed `type` to `readConfig` is the load-bearing half. Passing `o.type` there would rename the widget but hand it the old, unsanitised config, and the tile would not match a freshly added one.

- [ ] **Step 4: Run the test and watch it pass**

Run: `npx vitest run tests/unit/console-sanitize-migrate.test.ts`
Expected: 3 passed.

- [ ] **Step 5: Run the neighbouring suites**

Run: `npx vitest run tests/unit/console-sanitize.test.ts tests/unit/camslot-sanitize.test.ts tests/unit/share-url.test.ts tests/unit/sanitize-focus.test.ts`
Expected: all pass. These four are the other readers of `sanitizeLayout`.

- [ ] **Step 6: Commit**

```bash
git add lib/console/sanitize.ts tests/unit/console-sanitize-migrate.test.ts
git commit -m "Load an old board's cameras tile as a camera wall, not as a hole"
```

---

### Task 2: Re-point Brief, the Sources ＋, the palette and the layer map

After this task the `cameras` widget is still registered but no board, no button and no palette entry reaches it. The tree stays green.

**Files:**
- Modify: `lib/console/presets.ts:225`
- Modify: `lib/console/sourceWidgets.ts:22`
- Modify: `lib/console/paletteGroups.ts:101`
- Modify: `lib/console/presetLayers.ts:14`
- Test: `tests/unit/source-widgets.test.ts:55`, `tests/unit/console-presets.test.ts:7,18`, `tests/unit/preset-layers.test.ts:52`

**Interfaces:**
- Consumes: the migration from Task 1 (nothing at call level).
- Produces: `widgetTypeForSource("cameras") === "camslot"`. Task 3 relies on no preset naming `"cameras"` any more.

**Read this before you start — the two edits need opposite orderings.**
`source-widgets.test.ts` asserts the old answer, so you change the test first and watch it go red.
`console-presets.test.ts` asserts "some board uses the `cameras` widget", which only goes red once the **source** changes. Changing that test first would make it green immediately and prove nothing. So for that one you change `presets.ts` first and let the existing test catch it.

- [ ] **Step 1: Change the source-widgets expectation and watch it fail**

In `tests/unit/source-widgets.test.ts:55`, change:

```ts
    expect(widgetTypeForSource("cameras")).toBe("cameras");
```

to:

```ts
    expect(widgetTypeForSource("cameras")).toBe("camslot");
```

Run: `npx vitest run tests/unit/source-widgets.test.ts`
Expected: FAIL — `expected 'cameras' to be 'camslot'`.

- [ ] **Step 2: Point the Sources rail ＋ at the camera wall**

In `lib/console/sourceWidgets.ts`, change line 22 inside `CORE_TO_WIDGET`:

```ts
  cameras: "cameras",
```

to:

```ts
  cameras: "camslot",
```

Run: `npx vitest run tests/unit/source-widgets.test.ts`
Expected: PASS.

- [ ] **Step 3: Move Brief onto the camera wall, and let the existing test catch it**

In `lib/console/presets.ts:225`, inside the `overview` board, change:

```ts
      { type: "cameras", weight: 2 },
```

to:

```ts
      { type: "camslot", weight: 2 },
```

Run: `npx vitest run tests/unit/console-presets.test.ts`
Expected: FAIL — `no board uses the core "cameras" widget`. That failure is the point of this step: it is the existing suite noticing that a core card left the boards.

- [ ] **Step 4: Update the two sets in the presets test**

In `tests/unit/console-presets.test.ts:7`, remove `"cameras"` from `CORE_WIDGETS` (`"camslot"` is already in the set). The line becomes:

```ts
const CORE_WIDGETS = new Set(["events", "news", "aviation", "satellites", "markets", "headlines", "locate", "anomaly", "camslot"]);
```

In `tests/unit/console-presets.test.ts:18`, replace `"cameras"` with `"camslot"`:

```ts
const CORE_MONITORS = ["events", "news", "camslot", "aviation", "satellites", "markets", "headlines"];
```

`CORE_WIDGETS` is an allowlist checked at line 227 — dropping the name **tightens** it, so a preset that re-adds `"cameras"` now fails. `CORE_MONITORS` at line 249 asserts every core card appears on some board.

Run: `npx vitest run tests/unit/console-presets.test.ts`
Expected: PASS.

- [ ] **Step 5: Swap the Popular-widgets entry**

In `lib/console/paletteGroups.ts:101`, inside `POPULAR_WIDGET_IDS`, change:

```ts
  "cameras",
```

to:

```ts
  "camslot",
```

- [ ] **Step 6: Drop the dead widget→layer entry**

In `lib/console/presetLayers.ts`, delete line 14 from `WIDGET_TO_CORE`:

```ts
  cameras: "cameras",
```

Leave the `camslot: "cameras"` entry and its comment block alone — that is what keeps the Brief board lighting the camera pins.

- [ ] **Step 7: Correct one comment that is now wrong**

`tests/unit/preset-layers.test.ts:48` asserts the Brief board lights the `cameras` map layer. **It passes before and after this change**, because `camslot` maps to the same layer. It cannot catch a mistake here, so do not read its green as evidence.

Its comment at line 52 now names a widget that is leaving. Change:

```ts
  // Without the declared map layers, the same board lights only its cameras card.
```

to:

```ts
  // Without the declared map layers, the same board lights only its camera wall.
```

- [ ] **Step 8: Run the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add lib/console/presets.ts lib/console/sourceWidgets.ts lib/console/paletteGroups.ts lib/console/presetLayers.ts tests/unit/source-widgets.test.ts tests/unit/console-presets.test.ts tests/unit/preset-layers.test.ts
git commit -m "Point the Brief board, the Sources button and the palette at the camera wall"
```

---

### Task 3: Delete the widget, its focus view, its alert rule and its help entry

These four go together. Deleting the widget while leaving its help entry makes `tests/unit/widget-explainers.test.ts:54` red on `orphanedWidgetExplainerIds`, so they cannot be split.

**Files:**
- Delete: `lib/console/widgets/cameras.tsx`
- Delete: `lib/console/widgets/cameras.detail.tsx`
- Delete: `lib/console/widgets/cameras.rules.ts`
- Delete: `tests/unit/console-cameras.test.ts`
- Modify: `lib/console/widgets/index.ts:4`
- Modify: `lib/console/help.ts:102-121`
- Test: `tests/unit/widget-explainers.test.ts:171-175`

**Interfaces:**
- Consumes: from Task 2, no preset or registry names `"cameras"` as a widget type.
- Produces: `listWidgetTypes()` no longer contains an entry with `id: "cameras"`. Task 4 relies on `lib/cameras/concurrency.ts` and the two `coverage` exports having lost their only importer here.

- [ ] **Step 1: Delete the four files**

```bash
git rm lib/console/widgets/cameras.tsx lib/console/widgets/cameras.detail.tsx lib/console/widgets/cameras.rules.ts tests/unit/console-cameras.test.ts
```

- [ ] **Step 2: Stop registering the widget**

In `lib/console/widgets/index.ts`, delete line 4:

```ts
import "@/lib/console/widgets/cameras";
```

- [ ] **Step 3: Run the explainer suite and watch it fail**

Run: `npx vitest run tests/unit/widget-explainers.test.ts`

Expected: FAIL twice, and both failures are informative.
- Line 54, `orphanedWidgetExplainerIds(ids)` returns `["cameras"]` rather than `[]` — the help catalogue still documents a widget that no longer exists.
- Line 172, `widgetExplainerFor("cameras")!` — the test still asserts the coverage honesty of the deleted card.

- [ ] **Step 4: Remove the help entry**

In `lib/console/help.ts`, delete the whole `cameras` entry — the section comment on line 102 through the closing `},` on line 120, plus the blank line 121. It begins:

```ts
  // --- Cameras --------------------------------------------------------------
  {
    id: "cameras",
```

and ends with the `limitations` array's closing `],` followed by `},`. The `camslot` entry that starts `id: "camslot",` must remain.

- [ ] **Step 5: Retarget the coverage-honesty test to the camera wall**

The test at `tests/unit/widget-explainers.test.ts:171-175` exists so that nobody quietly softens the claim that this camera network covers seven countries and not the world. That claim still needs guarding — it moved to the `camslot` card, it did not stop mattering. Replace the test with:

```ts
  it("admits the camera network covers seven countries, not the world", () => {
    const e = widgetExplainerFor("camslot")!;
    expect(e.coverage).toMatch(/seven countries/i);
    expect(e.limitations.join(" ")).toMatch(/not evidence that none exists|partial sample/i);
  });
```

Both patterns are checked against the live `camslot` entry: its `coverage` reads "The same seven countries the road-camera registry covers, plus a partial global sample of Windy webcams", and its first limitation ends "a search finding no camera in a city is not evidence that none exists there."

- [ ] **Step 6: Run the explainer suite and watch it pass**

Run: `npx vitest run tests/unit/widget-explainers.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the full suite**

Run: `npx tsc --noEmit && npm test`

Expected: all green. If `tsc` reports an unused import in a file you did not touch, read it — it means something else imported the deleted widget and the spec's dependency sweep missed it. Report that rather than deleting the caller.

- [ ] **Step 8: Commit**

```bash
git add lib/console/widgets/cameras.tsx lib/console/widgets/cameras.detail.tsx lib/console/widgets/cameras.rules.ts tests/unit/console-cameras.test.ts
git add lib/console/widgets/index.ts lib/console/help.ts tests/unit/widget-explainers.test.ts
git commit -m "Delete the cameras widget, and the trust card that documented it"
```

---

### Task 4: Remove the code only the deleted focus view used

Two modules lost their only caller in Task 3. This is a separate task because it is separately rejectable: keeping `coverage()` is a defensible choice, and rejecting this task does not undo the retirement.

**Files:**
- Delete: `lib/cameras/concurrency.ts`
- Delete: `tests/unit/cameras-concurrency.test.ts`
- Delete: `tests/unit/cameras-coverage.test.ts`
- Modify: `lib/cameras/coverage.ts`

**Interfaces:**
- Consumes: from Task 3, `lib/console/widgets/cameras.detail.tsx` no longer exists.
- Produces: `lib/cameras/coverage.ts` exports exactly one symbol, `CameraLite`, which `lib/cameras/useCameras.ts:13` imports as a type.

- [ ] **Step 1: Confirm both modules really are orphaned**

Run:

```bash
grep -rn "cameras/concurrency" lib components app tests --include=*.ts --include=*.tsx
grep -rn 'from "@/lib/cameras/coverage"' lib components app tests --include=*.ts --include=*.tsx
```

Expected: the first prints only `tests/unit/cameras-concurrency.test.ts`. The second prints only `lib/cameras/useCameras.ts:13` (a `import type { CameraLite }`) and `tests/unit/cameras-coverage.test.ts`.

If either grep prints anything else, stop and report it. A surviving caller means this task is wrong, not that the caller should be deleted.

- [ ] **Step 2: Delete the HLS cap and both dead test files**

```bash
git rm lib/cameras/concurrency.ts tests/unit/cameras-concurrency.test.ts tests/unit/cameras-coverage.test.ts
```

`tests/unit/cameras-coverage.test.ts` imports only `coverage`, `byWallPriority` and the `CameraLite` type (`tests/unit/cameras-coverage.test.ts:2`) and tests only the first two, so it goes with them.

- [ ] **Step 3: Trim `lib/cameras/coverage.ts` to the type that is still used**

Replace the whole file with:

```ts
// The camera shape the console reads. The coverage maths that used to live here —
// coverage() and byWallPriority() — went with the cameras focus view that was their
// only caller (see docs/superpowers/specs/2026-09-03-cameras-widget-retirement-design.md).
export interface CameraLite {
  id: string; source: string; name: string; lat: number; lon: number;
  available: boolean; live: boolean; region?: string;
}
```

Keep the field list byte-for-byte. `useCameras` builds objects against it and `tsc` is the only thing checking that they still match.

- [ ] **Step 4: Run the type check and the full suite**

Run: `npx tsc --noEmit && npm test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/cameras/concurrency.ts tests/unit/cameras-concurrency.test.ts tests/unit/cameras-coverage.test.ts
git add lib/cameras/coverage.ts
git commit -m "Remove the coverage maths and the HLS cap, which lost their only caller"
```

---

### Task 5: Gate and evidence

**Files:**
- Create: `persona-shots/camslot-brief-empty.png`
- Create: `persona-shots/camslot-sources-add.png`

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence the repo's build gate asks for.

- [ ] **Step 1: Run the full gate**

Run: `npx tsc --noEmit && npm test && npm run build`

Expected: all green. `npm run build` is memory-hungry on this machine — if it is killed, close other work and run it alone rather than assuming it failed on this change.

- [ ] **Step 2: Sweep for any surviving reference to the widget type**

Run:

```bash
grep -rn '"cameras"' lib/console components/console
```

Expected: every remaining hit is a **map layer key**, a **catalogue source id** or a **palette category**, not a widget type. The known-good survivors are `lib/console/presetLayers.ts` (`camslot: "cameras"`, the layer), `lib/console/paletteGroups.ts:73` (the palette section) and `lib/console/sourceWidgets.ts:22` (`cameras: "camslot"`, source id on the left). Read each hit before changing it.

- [ ] **Step 3: Write the evidence spec**

This is a real regression test, not a screenshot script. The Brief board opening empty was a deliberate decision (spec §7.2), and the Sources ＋ adding a camera wall is the whole point of the change. Both deserve to stay pinned.

**Two full-screen overlays will eat your clicks if you skip the init script.** The first-visit guided tour auto-opens ~900ms after load and `.tn-tour-veil` is `position:fixed; inset:0`, so from that moment every click lands on the veil. The launch sequence (`components/terminal/BootSequence.tsx`) is the same problem again and owns the screen for five seconds. `tests/e2e/console.spec.ts:21-29` already solves both by stamping the "seen" flags before the app boots. Copy that, do not invent a `waitForTimeout`.

Create `tests/e2e/camslot-shots.spec.ts`:

```ts
// tests/e2e/camslot-shots.spec.ts
import { test, expect } from "@playwright/test";

// Both stamps are copied from tests/e2e/console.spec.ts, and for the reason given
// there: the guided tour and the launch sequence are each a `position:fixed;
// inset:0` layer, so without these a click lands on an overlay instead of the
// control under it. The tour version is deliberately far above the current one, so
// that bumping the tour does not silently re-arm the overlay and break this file.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

test("the Brief board's camera wall opens empty, and offers both ways to fill it", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tn-cw").first()).toBeVisible();

  const empty = page.locator(".tn-cs-empty").first();
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("button", { name: /Add a camera/ })).toBeVisible();
  await expect(empty.getByRole("button", { name: /Pick cameras on the map/ })).toBeVisible();

  // A viewport shot, not fullPage: the map behind the board animates, and a fullPage
  // capture reframes the page to catch it mid-flight.
  await page.screenshot({ path: "persona-shots/camslot-brief-empty.png" });
});

test("the Sources rail + on Cameras adds a camera wall, not the retired grid", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tn-cw").first()).toBeVisible();

  const before = await page.locator(".tn-cs").count();
  await page.getByRole("button", { name: "Add Cameras as a widget" }).click();

  // One more camera wall than there was. The retired widget rendered `.tn-cam-grid`
  // and never `.tn-cs`, so this assertion fails if the rail is still wired to it.
  await expect(page.locator(".tn-cs")).toHaveCount(before + 1);
  await expect(page.locator(".tn-cam-grid")).toHaveCount(0);

  await page.screenshot({ path: "persona-shots/camslot-sources-add.png" });
});
```

- [ ] **Step 4: Run it and watch both shots land**

Run: `npx playwright test tests/e2e/camslot-shots.spec.ts`

Expected: 2 passed, and both PNGs present in `persona-shots/`.

The Playwright config runs `npm run build && npm run start` as its web server (`playwright.config.ts:6-7`). Step 1 already built, so this is a rebuild — if the machine is under load it can be killed. Run it alone rather than reading a kill as a test failure.

**Open both PNGs and look at them.** The Brief shot is the first thing a visitor now sees on the landing board, and shipping it empty was a decision made in design rather than discovered here. If it looks wrong, say so — that is a finding for Sampo, not something to fix silently.

- [ ] **Step 5: Commit the spec and the evidence**

```bash
git add tests/e2e/camslot-shots.spec.ts persona-shots/camslot-brief-empty.png persona-shots/camslot-sources-add.png
git commit -m "Pin the Brief board's empty camera wall, and the Sources button adding one"
```

- [ ] **Step 6: Open the PR**

Branch off the latest `main` if it has moved again — Sampo merges within minutes, so re-check before opening.

```bash
git fetch origin
git log --oneline origin/main -1
```

If `origin/main` has moved past `0596d6e`, rebase onto it and re-run the gate before opening the PR. The PR description should carry the spec's §3 ("What the change costs") in full — the reviewer needs to see the camera console being deleted, not discover it in the diff.
