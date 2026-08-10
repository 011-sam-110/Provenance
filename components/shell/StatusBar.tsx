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
import PresetPill from "@/components/shell/PresetPill";
import ProfileMenu from "@/components/shell/ProfileMenu";
import SettingsPanel from "@/components/shell/SettingsPanel";

export default function StatusBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const m = useMetrics();
  const layers = useLayers();
  const [settingsOpen, setSettingsOpen] = useState(false);

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

        {/* ── Brand ────────────────────────────────────────────────────────── */}
        <div className="tn-topbar-left">
          <span className="tn-wordmark">
            Open<span className="tn-wordmark-accent">Data</span>
          </span>
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
