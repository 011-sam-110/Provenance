"use client";
// Top status bar — the global chrome that recedes while the map stays the hero.
//
// Layout (left → right):  OpenData wordmark · [ central board pill ] · ⌘K | settings | profile
//
// The live-data pulse (camera/plane/sat counts) was removed from the visible bar for
// calm; the canonical machine-readable count line survives as a visually-hidden span
// (kept for the e2e smoke test + screen readers). Map-view controls live on the map;
// language / theme / share / Telegram live in the Settings drawer.

import { useState } from "react";
import { useMetrics } from "@/lib/metrics";
import { useLayers } from "@/lib/layers";
import { useActivePreset } from "@/lib/console/activePreset";
import { listPresets } from "@/lib/console/presets";
import { appStatusLine } from "@/components/shell/a11y";
import PresetPill from "@/components/shell/PresetPill";
import ProfileMenu from "@/components/shell/ProfileMenu";
import SettingsPanel from "@/components/shell/SettingsPanel";

export default function StatusBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const m = useMetrics();
  const layers = useLayers();
  const activePresetId = useActivePreset();
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Board name for the spoken status line. Same source the central pill reads, so
  // the two can never disagree about which board is loaded.
  const boardTitle = listPresets().find((p) => p.id === activePresetId)?.title ?? null;

  return (
    <>
      <header className="tn-topbar" role="banner">
        {/* Canonical machine-readable pulse — visually hidden, kept for the e2e smoke
            test and screen readers. */}
        <span data-testid="stat-line" className="tn-sr-only">
          {/* "off" is not "0". An audit read this line as "0 planes · 0 satellites"
              and concluded two of three headline feeds were dead, while /api/planes
              was serving 3,000 aircraft and the layer was simply not switched on.
              Reporting a disabled layer as a zero count is the same error as a
              frozen feed reporting "live". */}
          {m.camerasTotal.toLocaleString()} cameras ·{" "}
          {layers.planes ? `${m.planes.toLocaleString()} planes` : "planes off"} ·{" "}
          {layers.satellites ? `${m.satellites.toLocaleString()} satellites` : "satellites off"}
        </span>

        {/* The SPOKEN status line, and deliberately a different string from the one
            above. The pulse line re-renders every few seconds as the tallies move,
            so wiring aria-live to it would make a screen reader recite
            "18,729 cameras · 3,000 planes · 412 satellites" on a loop — noise that
            drowns the page. This one carries state only (board + which layers are
            on), so it changes when, and only when, the user changed something.
            See appStatusLine() in components/shell/a11y.ts. */}
        <span className="tn-sr-only" role="status" aria-live="polite" data-testid="a11y-status-line">
          {appStatusLine({ boardTitle, layers })}
        </span>

        {/* ── Brand ────────────────────────────────────────────────────────── */}
        <div className="tn-topbar-left">
          {/* The page's one h1. It is the wordmark itself rather than a hidden
              duplicate — the visible product name IS the page's title — with a
              visually-hidden tail so the accessible heading says what the product
              is instead of just "OpenData". `.tn-wordmark` pins font-size/weight
              and now margin, so swapping the span for an h1 changes no pixels. */}
          <h1 className="tn-wordmark">
            Open<span className="tn-wordmark-accent">Data</span>
            <span className="tn-sr-only"> — live global situational-awareness map</span>
          </h1>
        </div>

        {/* ── Central board switcher (absolutely centred over the bar) ─────── */}
        <PresetPill />

        {/* ── Entry points + identity ──────────────────────────────────────── */}
        {/* Support · ⌘K · Settings · Profile — the avatar sits at the very edge. */}
        <div className="tn-topbar-right">
          {/* Buy Me a Coffee (Ko-fi) — the app is free + keyless; this is a calm,
              opt-in way to support it. Present but not shouty. */}
          <a
            className="tn-kofi"
            href="https://ko-fi.com/opendata"
            target="_blank"
            rel="noreferrer noopener"
            title="Support OpenData on Ko-fi"
          >
            <span className="tn-kofi-icon" aria-hidden>☕</span>
            <span className="tn-kofi-label">Support</span>
          </a>

          <button
            type="button"
            className="tn-icon-btn tn-palette-trigger"
            onClick={onOpenPalette}
            title="Command palette (⌘K)"
          >
            <span className="tn-kbd">⌘K</span>
          </button>

          <button
            type="button"
            className="tn-icon-btn tn-settings-trigger"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <span aria-hidden>⚙</span>
          </button>

          <ProfileMenu onOpenSettings={() => setSettingsOpen(true)} />
        </div>
      </header>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
