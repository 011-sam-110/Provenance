"use client";
// The OpenData Terminal shell. Five stacked bands — 34px header, 22px feed-health
// strip, the breaking-banner band, the widget/stage grid, 24px footer — plus the
// overlays that float over all of them (⌘K palette, dossier, cinematic dive, tour,
// toast). Owns the global keyboard shortcuts, the one-time client hydration of the
// persisted stores (including the console layout + ?c= shared-layout / first-run
// seed), and the global capacity toast.
//
// `tn-terminal` on the root is where the near-black --tnx-* palette starts. It is a
// SCOPED token block, not a theme: app/layout.tsx still hard-codes
// data-theme="light", and variantStore re-asserts a variant's theme on every switch,
// so a global dark default would be yanked back to light by the first board change.
// Scoping it also means widget bodies inherit the terminal surfaces through the
// remapped --tn-* tokens without a single .tn-cw* rule being rewritten.

import { useEffect, useRef, useState } from "react";
import { uiStore } from "@/lib/shell/ui";
import { langStore } from "@/lib/i18n/store";
import { watchlistStore } from "@/lib/shell/watchlist";
import { timeWindowStore } from "@/lib/shell/timeWindow";
import { registerServiceWorker } from "@/lib/pwa/register";
import { variantStore } from "@/lib/variants/store";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import BootSequence from "@/components/terminal/BootSequence";
import { BOOT_MS, bootOverrideFromSearch, loadBootSeen, shouldPlayBoot } from "@/lib/terminal/boot";
import { SIGNALS } from "@/lib/signals/registry";
import FeedHealthStrip from "@/components/terminal/FeedHealthStrip";
import { focusStageSearch } from "@/components/terminal/StageBar";
import SelectionAnnouncer from "@/components/terminal/SelectionAnnouncer";
import { basemapForSkin, terminalSkinStore, useTerminalSkin } from "@/lib/terminal/skin";
import { mapViewStore } from "@/lib/mapView";
import { selectionStore } from "@/lib/terminal/selection";
import { armStore } from "@/lib/console/widgets/camslot.arm";
import SkipLink from "@/components/shell/SkipLink";
import CommandPalette from "@/components/shell/CommandPalette";
import TourOverlay from "@/components/shell/TourOverlay";
import FeedbackPrompt from "@/components/shell/FeedbackPrompt";
import { tourStore } from "@/lib/shell/tour";
import { FeedOverlay } from "@/components/FeedOverlay";
import { CinematicDive } from "@/components/CinematicDive";
import { scopeStore } from "@/lib/shell/scope";
import { viewModeStore } from "@/lib/shell/viewMode";
import { soloStore } from "@/lib/terminal/solo";
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
  const skin = useTerminalSkin();

  // Re-hydrate persisted view state once, client-side (render defaults on the
  // server, reconcile after mount → no hydration mismatch).
  // uiStore.hydrate() applies the persisted data-theme before paint; variantStore
  // then re-asserts the variant's theme. Order matters.
  useEffect(() => {
    uiStore.hydrate();
    variantStore.bootstrap(new URLSearchParams(window.location.search));
    watchlistStore.hydrate();
    timeWindowStore.hydrate();
    langStore.hydrate();
    scopeStore.hydrate();
    viewModeStore.hydrate();
    soloStore.hydrate();
    assetsStore.hydrate();
    alertingStore.hydrate();
    shellLayoutStore.hydrate();
    activePresetStore.hydrate();
    profileStore.hydrate();
    telegramStore.hydrate();
    notificationsStore.hydrate();
    trackStore.hydrate();
    pinsStore.hydrate();
    // APPENDED, not inserted. The calls above are order-dependent (uiStore.hydrate
    // applies the persisted data-theme before paint; variantStore then re-asserts
    // the variant's theme). The skin owns `tn.terminal.skin.v1`
    // and touches neither theme nor layout. Without this the persisted DARK/LIGHT
    // choice is silently ignored on every reload.
    terminalSkinStore.hydrate();
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) { const l = decodeLayout(c); if (l) shellLayoutStore.replace(l); }
    else if (shellLayoutStore.get().widgets.length === 0) applyPreset(DEFAULT_PRESET_ID); // first-run seed
    registerServiceWorker(); // production-only; a no-op under `next dev`

    // First-visit guided tour: hydrate the persisted "seen" flag, then invite once
    // the seeded widgets have painted (so the tour can spotlight a real widget frame).
    // Gated so it never nags on return visits — see lib/shell/tour.ts.
    tourStore.hydrate();

    // WAIT FOR THE BOOT SEQUENCE. Both of these are first-visit-only surfaces, and
    // they were racing: the boot overlay holds the screen for BOOT_MS while the tour
    // invited itself at 900ms underneath it. The visitor saw the launch animation,
    // then a modal already half-open behind it — and it is the one visit where the
    // product gets to explain itself. shouldPlayBoot() is the same predicate
    // BootSequence uses, including the ?boot= override, so the two cannot disagree
    // about whether a boot is happening.
    const bootPlaying = shouldPlayBoot(loadBootSeen(), bootOverrideFromSearch(window.location.search));
    const tourTimer = setTimeout(() => tourStore.maybeAutoStart(), bootPlaying ? BOOT_MS + 500 : 900);
    return () => clearTimeout(tourTimer);
  }, []);

  // ── Skin ⇄ basemap ───────────────────────────────────────────────────────
  // The Terminal pins CARTO Dark Matter, and a near-white console wrapped around
  // a near-black map is the most obviously wrong thing a light skin could ship
  // with. Positron is the light counterpart and already exists in lib/basemaps.ts,
  // described there as "the calm light default".
  //
  // It only swaps when the current basemap is the OTHER skin's default. Someone
  // who deliberately chose Satellite or Topographic keeps it — a skin toggle is a
  // statement about chrome, not a licence to throw away a map choice. The first
  // run is skipped so a deep-linked `?base=` is never clobbered; the skin's own
  // hydrate() then counts as a real change, which is what gives a returning
  // light-skin user positron on load.
  const skinSettled = useRef(false);
  useEffect(() => {
    if (!skinSettled.current) { skinSettled.current = true; return; }
    const other = basemapForSkin(skin === "dark" ? "light" : "dark");
    if (mapViewStore.get().basemap === other) mapViewStore.setBasemap(basemapForSkin(skin));
  }, [skin]);

  // Global shortcuts. One listener, because they share two guards that have to agree.
  //
  //   ⌘K / Ctrl-K  toggle the command palette
  //   /            focus the stage search
  //   Escape       clear the terminal selection
  //
  // W and C are gone with the CONSOLE/WALL control they drove. A single-key
  // shortcut for a mode with no button, no label and no hint bar to advertise it
  // is not a power feature, it is a trap — the layout would rearrange itself for
  // anyone who pressed W outside a text field and there would be nothing on screen
  // to explain what had happened or how to undo it.
  //
  // GUARD 1 — never steal a keystroke from a text field. "/" is a single printable
  // character, so without this, typing a "/" anywhere would be swallowed. The
  // check is on the EVENT TARGET rather than document.activeElement because a
  // keydown is dispatched at the focused element, and contentEditable is included
  // because a rich-text field is a text field even though its tagName is not INPUT.
  //
  // GUARD 2 — Escape belongs to whatever dialog is open. The palette, the settings
  // drawer, the coverage panel and the tour all close on Escape, and clearing the
  // user's selection as a side effect of closing a dialog would be a silent data
  // loss they never asked for. Any mounted role="dialog" hands Escape (and the rest)
  // back to that surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      // A modifier means the user is aiming at the browser or the OS, not at us.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true) return;
      if (document.querySelector('[role="dialog"]')) return;

      switch (e.key) {
        case "/":
          // Only swallow the "/" if there was actually a search box to focus — the
          // stage chrome unmounts while a widget is expanded onto the stage, and a
          // preventDefault with nothing to show for it would look like a dead key
          // (and would block Firefox's quick-find, which is the browser default
          // this shortcut is deliberately shadowing).
          if (focusStageSearch()) e.preventDefault();
          break;
        case "Escape":
          // Escape leaves the innermost thing first, and a map armed to fill a slot
          // is inner to a selection. Sequenced HERE rather than from a second
          // listener, because two listeners would both fire on the same keydown and
          // one press would end arming AND silently clear the user's selection —
          // work they never asked to lose. Armed: end the mode, nothing else. A
          // second Escape then clears the selection as it always did.
          if (armStore.get()) {
            armStore.disarm();
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
      if (now) armStore.disarm(); // entering focus, not leaving it
    });
    const offPreset = activePresetStore.subscribe(() => {
      const now = activePresetStore.get();
      if (now === lastPreset) return;
      lastPreset = now;
      armStore.disarm();
    });
    return () => {
      offLayout();
      offPreset();
    };
  }, []);

  // The ⌘K palette dispatches a `tn-toast` CustomEvent (e.g. the widget cap).
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
    <div className="tn-shell tn-terminal" data-tnx-skin={skin}>
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
          `.tn-preset-pill` / `.tn-palette-trigger` / `.tn-settings-trigger` tour
          targets. Mounting both would duplicate all of those in the DOM and make
          getByTestId("stat-line") strict-mode ambiguous in the e2e suite. */}
      <TerminalHeader onOpenPalette={() => setPaletteOpen(true)} />
      <FeedHealthStrip />
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
      <TourOverlay />
      {/* Gates itself entirely (lib/shell/feedback.ts) and renders null until it
          decides to ask, so mounting it unconditionally costs one interval. */}
      <FeedbackPrompt />
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
