"use client";
// The OpenData Terminal shell. Five stacked bands — 34px header, 22px feed-health
// strip, the breaking-banner band, the widget/stage grid, 24px footer — plus the
// overlays that float over all of them (command palette, dossier, cinematic dive,
// toast). Owns the global keyboard shortcuts, the one-time client hydration of the
// persisted stores (including the console layout + ?c= shared-layout / first-run
// seed), and the global capacity toast.
//
// `tn-terminal` on the root is where the console's --tnx-* palette starts. It is a
// SCOPED token block, not a theme: app/layout.tsx still hard-codes
// data-theme="light", and variantStore re-asserts a variant's theme on every switch,
// so a global dark default would be yanked back to light by the first board change.
// Scoping it also means widget bodies inherit the terminal surfaces through the
// remapped --tn-* tokens without a single .tn-cw* rule being rewritten.

import { useEffect, useRef, useState } from "react";
import { inspectorStore } from "@/lib/shell/inspector";
import { uiStore } from "@/lib/shell/ui";
import { langStore } from "@/lib/i18n/store";
import { watchlistStore } from "@/lib/shell/watchlist";
import { timeWindowStore } from "@/lib/shell/timeWindow";
import { registerServiceWorker } from "@/lib/pwa/register";
import { variantStore } from "@/lib/variants/store";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import BootSequence from "@/components/terminal/BootSequence";
import { SIGNALS } from "@/lib/signals/registry";
import { focusStageSearch } from "@/components/terminal/StageBar";
import SelectionAnnouncer from "@/components/terminal/SelectionAnnouncer";
import { mapViewStore } from "@/lib/mapView";
import { selectionStore } from "@/lib/terminal/selection";
import { pickStore } from "@/lib/console/widgets/camslot.pick";
import SkipLink from "@/components/shell/SkipLink";
import CommandPalette from "@/components/shell/CommandPalette";
import FeedbackPrompt from "@/components/shell/FeedbackPrompt";
import CommunityNote from "@/components/shell/CommunityNote";
import { FeedOverlay } from "@/components/FeedOverlay";
import { CinematicDive } from "@/components/CinematicDive";
import { scopeStore } from "@/lib/shell/scope";
import { viewModeStore } from "@/lib/shell/viewMode";
import { assetsStore } from "@/lib/events/assets";
import { alertingStore } from "@/lib/events/alerting";
import ConsoleWorkspace from "@/components/console/ConsoleWorkspace";
import { shellLayoutStore } from "@/lib/console/store";
import { activePresetStore } from "@/lib/console/activePreset";
import { profileStore } from "@/lib/shell/profile";
import { telegramStore } from "@/lib/shell/telegram";
import { notificationsStore } from "@/lib/shell/notifications";
import { trackStore } from "@/lib/planes/track";
import { pinsStore } from "@/lib/map/pins";
import { applyPreset, DEFAULT_PRESET_ID } from "@/lib/console/presets";
import { decodeLayout } from "@/lib/console/share";
import "@/lib/console/widgets";
import { sourcesRailStore } from "@/lib/console/sourcesRail";
import { actionFor, chordOf, keymapStore } from "@/lib/shell/keymap";
import { mapRailStore } from "@/lib/console/mapRail";
import { isDrawing, startDraw } from "@/lib/map/aoi";
import { getMapInstance } from "@/lib/map/instance";

/**
 * `feeds` — how many camera feeds the registry holds, for the boot screen's one
 * line of copy.
 *
 * IT IS A PROP RATHER THAN AN IMPORT, AND THAT IS LOAD-BEARING. This file is the
 * "use client" boundary, so `import { CAMERA_FEED_COUNT } from "@/lib/sources/
 * registry"` — which is what used to be here — pulls every camera adapter into the
 * BROWSER bundle. On 2026-08-21 that stopped being a size problem and became a
 * broken build: `lib/sources/actpr.ts` imports `node:http2`, which has no browser
 * resolution, so `next build` failed with "Module not found: Can't resolve 'http2'"
 * and an import trace ending here. Production quietly served a two-merges-old build
 * until someone read the deployment list — `tsc --noEmit` was clean and all 2,445
 * unit tests passed, because vitest runs in a node environment where node:http2
 * resolves fine. No test in a node-environment suite can see this class of failure.
 *
 * Required, with no default: the only caller is the server component that renders
 * this shell (app/(console)/app/page.tsx), where the derived constant is already in
 * scope. A default would invite a hand-typed number that every pinning test would
 * happily accept and that would rot the next time a feed is added.
 */
export default function ConsoleShell({ feeds }: { feeds: number }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Re-hydrate persisted view state once, client-side (render defaults on the
  // server, reconcile after mount → no hydration mismatch).
  // uiStore.hydrate() applies the persisted data-theme before paint; variantStore
  // then re-asserts the variant's theme. Order matters.
  useEffect(() => {
    inspectorStore.hydrate();
    uiStore.hydrate();
    variantStore.bootstrap(new URLSearchParams(window.location.search));
    watchlistStore.hydrate();
    timeWindowStore.hydrate();
    langStore.hydrate();
    scopeStore.hydrate();
    viewModeStore.hydrate();
    assetsStore.hydrate();
    alertingStore.hydrate();
    shellLayoutStore.hydrate();
    keymapStore.hydrate();
    activePresetStore.hydrate();
    profileStore.hydrate();
    telegramStore.hydrate();
    notificationsStore.hydrate();
    trackStore.hydrate();
    pinsStore.hydrate();
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) { const l = decodeLayout(c); if (l) shellLayoutStore.replace(l); }
    else if (shellLayoutStore.get().widgets.length === 0) applyPreset(DEFAULT_PRESET_ID); // first-run seed
    registerServiceWorker(); // production-only; a no-op under `next dev`

    // THE GUIDED TOUR IS GONE, and with it this effect's only cleanup.
    //
    // It was 8 chapters and 59 steps of spotlighted walkthrough, gated to a first
    // visit and armed here on a timer that had to wait out the boot plate's CEILING
    // so a modal could not open underneath it. That timer is why the effect returned
    // a cleanup at all; with the tour removed there is nothing to cancel, so the
    // effect returns nothing.
    //
    // Removing it also removed the reason a dozen class names in the header, the map
    // rail and the settings drawer were load-bearing: `resolveTourSteps()` dropped a
    // step whose CSS target had been renamed, silently, so tests/unit/tour.test.ts
    // existed to fail on the rename instead. Those classes are now held by the e2e
    // suite alone, which is a weaker guard than the one that went — worth knowing
    // before renaming one.
  }, []);

// THE SKIN⇄BASEMAP EFFECT IS GONE, with the skin it followed.
  //
  // It swapped the basemap when the console skin changed — dark chrome with CARTO
  // Dark Matter, light chrome with Positron — but only when the current basemap was
  // the other skin's default, so a deliberate choice of Satellite or Topographic
  // survived. There is no skin to change now, and neither of those two basemaps is
  // in the registry any more, so there is nothing left for it to do.

    // Global shortcuts. One listener, because they share two guards that have to agree.
  //
  // THE BINDINGS ARE NOT IN THIS FILE. They live in lib/shell/keymap.ts, they are
  // rebindable from Settings, and they are persisted — so what this handler does is
  // ask "which action, if any, is this chord?" and run it. The defaults:
  //
  //   Ctrl-Space, ;   search the map
  //   Ctrl-K          toggle the Sources rail
  //   Ctrl-Q          arm the draw-an-area tool
  //   Escape          leave picking mode, then clear the selection
  //
  // ESCAPE IS DELIBERATELY NOT IN THE KEYMAP. It is a close/cancel gesture, sequenced
  // by hand below and by every dialog on the page. Making it rebindable would let a
  // user lock themselves inside a panel with no way out.
  //
  // W and C are gone with the CONSOLE/WALL control they drove. A single-key
  // shortcut for a mode with no button, no label and no hint bar to advertise it
  // is not a power feature, it is a trap — the layout would rearrange itself for
  // anyone who pressed W outside a text field and there would be nothing on screen
  // to explain what had happened or how to undo it.
  //
  // GUARD 1 — never steal a keystroke from a text field. ";" is a single printable
  // character, so without this, typing one anywhere would be swallowed.
  //
  // GUARD 2 — Escape belongs to whatever dialog is open. The palette, the settings
  // drawer and the coverage panel all close on Escape, and clearing the
  // user's selection as a side effect of closing a dialog would be a silent data
  // loss they never asked for. Any mounted role="dialog" hands Escape (and the rest)
  // back to that surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // THE TEXT-FIELD GUARD RUNS FIRST NOW, and it has to. ";" is a printable
      // character, so a keymap that can hold single keys must never be consulted
      // while someone is typing — otherwise a semicolon in the search box opens the
      // search box. The old handler could check modifiers first because its only
      // single-key binding was "/" and it was checked after this guard; that ordering
      // is no longer safe, so the guard moved up.
      //
      // The check is on the EVENT TARGET rather than document.activeElement because a
      // keydown is dispatched at the focused element, and contentEditable is included
      // because a rich-text field is a text field even though its tagName is not INPUT.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const typing =
        tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true;

      if (!typing) {
        const action = actionFor(chordOf(e), keymapStore.get());
        if (action === "sources") {
          // TOGGLE, NOT OPEN. A key that only opens is a dead key the second time it
          // is pressed.
          e.preventDefault();
          sourcesRailStore.toggle();
          return;
        }
        if (action === "search") {
          // Only swallow the key if there was actually a search box to focus — the
          // stage chrome unmounts while a widget is expanded onto the stage, and a
          // preventDefault with nothing to show for it would look like a dead key.
          if (focusStageSearch()) e.preventDefault();
          return;
        }
        if (action === "draw") {
          // Opens the group AND arms the gesture. Opening the flyout alone would be a
          // shortcut that saves one click out of two and leaves the user looking at a
          // panel wondering what the key did.
          const map = getMapInstance();
          if (map && !isDrawing()) {
            e.preventDefault();
            mapRailStore.open("draw");
            startDraw(map);
          }
          return;
        }
      }

      // A modifier means the user is aiming at the browser or the OS, not at us.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing) return;
      if (document.querySelector('[role="dialog"]')) return;

      switch (e.key) {
        case "Escape":
          // Escape leaves the innermost thing first, and a map in camera-picking
          // mode is inner to a selection. Sequenced HERE rather than from a second
          // listener, because two listeners would both fire on the same keydown and
          // one press would end picking AND silently clear the user's selection —
          // work they never asked to lose. Picking: leave the mode, nothing else. A
          // second Escape then clears the selection as it always did.
          //
          // Leaving the mode does NOT empty the basket. Escape is how you stop the
          // map intercepting clicks, and a user who presses it to pan around before
          // sending would otherwise lose every camera they had chosen. `clear()` on
          // the tray is the only thing that throws picks away.
          if (pickStore.get().mode === "picking") {
            pickStore.setMode("off");
            break;
          }
          selectionStore.clear();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ── Arming is a MAP mode, so anything that takes the map away ends it ──────
  //
  // Focusing a widget unmounts <WorldMap/> entirely (StageHost.tsx:33,37), and
  // switching board replaces the widget the arm points at. Either way the ring is
  // gone while the mode is still on — and a mode you cannot see is one that turns
  // the next pin click into a silent append to a slot that is no longer on screen.
  //
  // Store subscriptions rather than hooks on purpose: the shell has no reason to
  // re-render for this, and useShellLayout() here would re-render the whole terminal
  // on every layout write, including each armed append.
  useEffect(() => {
    let lastFocus = shellLayoutStore.get().focusedWidgetId;
    let lastPreset = activePresetStore.get();
    const offLayout = shellLayoutStore.subscribe(() => {
      const now = shellLayoutStore.get().focusedWidgetId;
      if (now === lastFocus) return;
      lastFocus = now;
      if (now) pickStore.setMode("off"); // entering focus, not leaving it
    });
    const offPreset = activePresetStore.subscribe(() => {
      const now = activePresetStore.get();
      if (now === lastPreset) return;
      lastPreset = now;
      // A board change is the one case that empties the basket: picks belong to
      // the wall you were building, and carrying them to another board would
      // offer to send cameras to slots that are not there any more.
      pickStore.reset();
    });
    return () => {
      offLayout();
      offPreset();
    };
  }, []);

  // The command palette dispatches a `tn-toast` CustomEvent (e.g. the widget cap).
  // This always-mounted shell is the host that surfaces it as a calm pill.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (typeof detail !== "string") return;
      setToast(detail);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setToast(null), 3200);
    };
    window.addEventListener("tn-toast", onToast as EventListener);
    return () => { window.removeEventListener("tn-toast", onToast as EventListener); if (timer) clearTimeout(timer); };
  }, []);

  return (
    <div className="tn-shell tn-terminal">
      {/* First Tab stop on the page — see components/shell/SkipLink.tsx. */}
      {/* The cold-start overlay. Mounted INSIDE the shell as a sibling, never
          wrapping it: the app is already mounted and fetching behind this, so the
          boot covers work that was happening anyway and costs nothing in
          time-to-interactive. Gate the shell on it and a decoration becomes a
          load-time regression. Counts are read from the registries rather than
          typed, so the line cannot drift from the product. */}
      <BootSequence layers={SIGNALS.length} feeds={feeds} />

      <SkipLink />
      {/* Replaces StatusBar outright rather than sitting beside it: it carries the
          page's single <h1>, the `stat-line` / `a11y-status-line` spans, and the
          `.tn-preset-pill` / `.tn-palette-trigger` / `.tn-settings-trigger`
          classes the e2e suite drives. Mounting both would duplicate all of those in the DOM and make
          getByTestId("stat-line") strict-mode ambiguous in the e2e suite. */}
      <TerminalHeader onOpenPalette={() => setPaletteOpen(true)} />
      <ConsoleWorkspace />
      {/*
        WHAT THE FOOTER USED TO ANNOUNCE, KEPT WITHOUT THE BAND.
        The 24px footer carried SEL — the answer to "what did I just click?" — and
        it was the ONE announced surface in that bar: role="status", aria-live, fed
        by the same pure footerLine() this uses. Deleting the band would have
        deleted a live region, which is a silent accessibility regression rather
        than a visual change, so the announcement stays and only the paint goes.
        Sighted users still get the answer from the dossier that slides in on
        select; this is for the users who were relying on the bar.
      */}
      <SelectionAnnouncer />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <FeedOverlay />
      <CinematicDive />
      {/* Gates itself entirely (lib/shell/feedback.ts) and renders null until it
          decides to ask, so mounting it unconditionally costs one interval. */}
      <FeedbackPrompt />
      {/* Gates itself the same way (lib/shell/community.ts) and renders an empty
          live region until it decides to ask, so this also costs one interval.
          Mounted AFTER FeedbackPrompt for readability only — the two are ordered by
          z-index (1050 under 1100), not by DOM position. */}
      <CommunityNote />
      {/* The toast is now mounted ALWAYS, empty when idle, instead of appearing and
          disappearing with its text. A live region has to already be in the
          accessibility tree when its content changes for the change to be
          announced; a region that arrives *carrying* its message is announced
          inconsistently across browser/screen-reader pairs, which is the same as
          not announcing at all. `.tn-toast:empty` (app/globals.css) strips the
          pill's padding, background and shadow so the idle element is invisible
          and zero-sized — it must NOT be display:none/visibility:hidden, which
          would take it back out of the accessibility tree and undo the fix. */}
      <div className="tn-toast" role="status" aria-live="polite">{toast}</div>
    </div>
  );
}
