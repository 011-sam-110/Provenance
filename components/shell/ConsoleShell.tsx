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
import { alertStore } from "@/lib/shell/alert";
import { langStore } from "@/lib/i18n/store";
import { watchlistStore } from "@/lib/shell/watchlist";
import { timeWindowStore } from "@/lib/shell/timeWindow";
import { registerServiceWorker } from "@/lib/pwa/register";
import { variantStore } from "@/lib/variants/store";
import TerminalHeader from "@/components/terminal/TerminalHeader";
import BootSequence from "@/components/terminal/BootSequence";
import { BOOT_MS, bootOverrideFromSearch, loadBootSeen, shouldPlayBoot } from "@/lib/terminal/boot";
import { SIGNALS } from "@/lib/signals/registry";
import { CAMERA_FEED_COUNT } from "@/lib/sources/registry";
import FeedHealthStrip from "@/components/terminal/FeedHealthStrip";
import TerminalFooter from "@/components/terminal/TerminalFooter";
import { focusStageSearch } from "@/components/terminal/StageBar";
import { terminalModeStore, useTerminalMode } from "@/lib/terminal/mode";
import { basemapForSkin, terminalSkinStore, useTerminalSkin } from "@/lib/terminal/skin";
import { mapViewStore } from "@/lib/mapView";
import { selectionStore } from "@/lib/terminal/selection";
import SkipLink from "@/components/shell/SkipLink";
import CommandPalette from "@/components/shell/CommandPalette";
import BreakingBanner from "@/components/shell/BreakingBanner";
import TourOverlay from "@/components/shell/TourOverlay";
import { tourStore } from "@/lib/shell/tour";
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

export default function ConsoleShell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const skin = useTerminalSkin();
  const mode = useTerminalMode();

  // Re-hydrate persisted view state once, client-side (render defaults on the
  // server, reconcile after mount → no hydration mismatch).
  // uiStore.hydrate() applies the persisted data-theme before paint; variantStore
  // then re-asserts the variant's theme. Order matters.
  useEffect(() => {
    uiStore.hydrate();
    variantStore.bootstrap(new URLSearchParams(window.location.search));
    watchlistStore.hydrate();
    timeWindowStore.hydrate();
    alertStore.hydrate();
    langStore.hydrate();
    scopeStore.hydrate();
    viewModeStore.hydrate();
    assetsStore.hydrate();
    alertingStore.hydrate();
    shellLayoutStore.hydrate();
    activePresetStore.hydrate();
    profileStore.hydrate();
    telegramStore.hydrate();
    notificationsStore.hydrate();
    trackStore.hydrate();
    pinsStore.hydrate();
    // APPENDED, not inserted. The seventeen calls above are order-dependent
    // (uiStore.hydrate applies the persisted data-theme before paint; variantStore
    // then re-asserts the variant's theme), and terminalModeStore touches neither
    // theme nor layout — it owns its own key, `tn.terminal.mode.v1`. Without this
    // call the persisted CONSOLE/WALL choice is silently ignored on reload.
    terminalModeStore.hydrate();
    // Same reasoning, same appended position: the skin owns `tn.terminal.skin.v1`
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

  // ── CONSOLE ⇄ WALL actually re-arranges the board ────────────────────────
  //
  // Until now it did nothing. `terminalModeStore.set()` flipped an enum, persisted
  // it, and repainted the button's own highlight; `useTerminalMode()` had exactly
  // one consumer, the header's active class. Meanwhile `arrangeBoard`,
  // `arrangeConsole` and `arrangeWall` were all fully implemented and unit-tested
  // with zero callers — a green suite over a dead feature. The W and C keyboard
  // shortcuts hit the same inert setter.
  //
  // Wired HERE rather than in the two places that set the mode, so the button and
  // the shortcut cannot drift apart, and so `terminalModeStore` stays the small
  // independent store its own header comment promises it is.
  //
  // The first-run skip is not optional: `hydrate()` sets the mode during mount, and
  // re-arranging on that would throw away the layout the store has just restored —
  // which is the exact bug class this session is here to remove.
  const modeSettled = useRef(false);
  useEffect(() => {
    if (!modeSettled.current) { modeSettled.current = true; return; }
    shellLayoutStore.arrange(mode);
  }, [mode]);

  // Global shortcuts. One listener, because they share two guards that have to agree.
  //
  //   ⌘K / Ctrl-K  toggle the command palette   (unchanged)
  //   W            WALL layout
  //   C            CONSOLE layout
  //   /            focus the stage search
  //   Escape       clear the terminal selection
  //
  // GUARD 1 — never steal a keystroke from a text field. W, C and / are single
  // printable characters, so without this, typing "console" into the stage search
  // would flip the layout twice and typing a "/" anywhere would be swallowed. The
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
        case "w":
        case "W":
          e.preventDefault();
          terminalModeStore.set("wall");
          break;
        case "c":
        case "C":
          e.preventDefault();
          terminalModeStore.set("console");
          break;
        case "/":
          // Only swallow the "/" if there was actually a search box to focus — the
          // stage chrome unmounts while a widget is expanded onto the stage, and a
          // preventDefault with nothing to show for it would look like a dead key
          // (and would block Firefox's quick-find, which is the browser default
          // this shortcut is deliberately shadowing).
          if (focusStageSearch()) e.preventDefault();
          break;
        case "Escape":
          selectionStore.clear();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The ⌘K palette dispatches a `tn-toast` CustomEvent (e.g. the 50-widget cap).
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
      <BootSequence layers={SIGNALS.length} feeds={CAMERA_FEED_COUNT} />

      <SkipLink />
      {/* Replaces StatusBar outright rather than sitting beside it: it carries the
          page's single <h1>, the `stat-line` / `a11y-status-line` spans, and the
          `.tn-preset-pill` / `.tn-palette-trigger` / `.tn-settings-trigger` tour
          targets. Mounting both would duplicate all of those in the DOM and make
          getByTestId("stat-line") strict-mode ambiguous in the e2e suite. */}
      <TerminalHeader onOpenPalette={() => setPaletteOpen(true)} />
      <FeedHealthStrip />
      {/* BreakingBanner must stay the DIRECT PREVIOUS SIBLING of ConsoleWorkspace's
          `.tn-cw-shell`: globals.css reserves the banner's band with the sibling
          combinator `.tn-alert ~ .tn-cw-shell`, and the banner renders a fragment
          (an sr-only live region, then the strip), so wrapping it in anything —
          including a layout div for the new grid — breaks that selector and puts the
          banner back on top of the stage's search box and projection switch. */}
      <BreakingBanner />
      <ConsoleWorkspace />
      {/* Last band. Everything after it is fixed-position overlay chrome that takes
          itself out of flow, so this is the final element in the column. */}
      <TerminalFooter />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <FeedOverlay />
      <CinematicDive />
      <TourOverlay />
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
