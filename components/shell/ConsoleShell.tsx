"use client";
// The calm light console shell. Hosts the widget workspace (3 resizable segments
// around a fixed centre stage) with the thin chrome that recedes around it: a thin
// top status bar, the ⌘K palette, the breaking banner, and the cinematic/feed
// overlays. Owns the global ⌘K shortcut, the one-time client hydration of the
// persisted stores (including the console layout + ?c= shared-layout / first-run
// seed), and the global capacity toast.

import { useEffect, useState } from "react";
import { uiStore } from "@/lib/shell/ui";
import { alertStore } from "@/lib/shell/alert";
import { langStore } from "@/lib/i18n/store";
import { watchlistStore } from "@/lib/shell/watchlist";
import { timeWindowStore } from "@/lib/shell/timeWindow";
import { registerServiceWorker } from "@/lib/pwa/register";
import { variantStore } from "@/lib/variants/store";
import StatusBar from "@/components/shell/StatusBar";
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
    const c = new URLSearchParams(window.location.search).get("c");
    if (c) { const l = decodeLayout(c); if (l) shellLayoutStore.replace(l); }
    else if (shellLayoutStore.get().widgets.length === 0) applyPreset(DEFAULT_PRESET_ID); // first-run seed
    registerServiceWorker(); // production-only; a no-op under `next dev`

    // First-visit guided tour: hydrate the persisted "seen" flag, then auto-open once
    // the seeded widgets have painted (so the tour can spotlight a real widget frame).
    // Gated so it never nags on return visits — see lib/shell/tour.ts.
    tourStore.hydrate();
    const tourTimer = setTimeout(() => tourStore.maybeAutoStart(), 900);
    return () => clearTimeout(tourTimer);
  }, []);

  // Global ⌘K / Ctrl-K toggles the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
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
    <div className="tn-shell">
      {/* First Tab stop on the page — see components/shell/SkipLink.tsx. */}
      <SkipLink />
      <StatusBar onOpenPalette={() => setPaletteOpen(true)} />
      <BreakingBanner />
      <ConsoleWorkspace />
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
