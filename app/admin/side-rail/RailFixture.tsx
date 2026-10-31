"use client";
// A host for the shared sidebar, the size of the two real ones: one positioned box, rows that
// change real state, and a neighbour that reads `--rail-w`. See page.tsx for why it is here.
//
// `.tn-terminal` gives `tone="skin"` the same tokens it reads inside the console.

import { useEffect, useRef, useState } from "react";
import SideRail, { type RailEntry } from "@/components/rail/SideRail";
import { AlertGlyph, DrawGlyph, PinGearGlyph, SearchGlyph, ViewGlyph } from "@/components/shell/inspector/ToolIcons";
import { closeRail, type RailSurface } from "@/lib/rail/railOpen";

const TRAY_ID = "rail-fixture-tray";

export default function RailFixture({ tone, surface }: { tone: "dark" | "skin"; surface: RailSurface }) {
  const [mounted, setMounted] = useState(true);
  const [previews, setPreviews] = useState(true);
  const [turning, setTurning] = useState(false);
  const [tray, setTray] = useState(false);
  const [claimEscape, setClaimEscape] = useState(false);
  const [ladder, setLadder] = useState(0);
  const exitCount = useRef(0);

  // Stands for a surface with a capture-phase listener that takes the press first.
  const claim = useRef(claimEscape);
  claim.current = claimEscape;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && claim.current) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // Stands for ConsoleShell's ladder: bubble phase on window, and it does not look at
  // `defaultPrevented`. One press that closes the sheet must not reach it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLadder((n) => n + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const entries: RailEntry[] = [
    {
      kind: "switch",
      id: "previews",
      label: "Camera previews",
      icon: <ViewGlyph />,
      on: previews,
      onClick: () => setPreviews((v) => !v),
    },
    {
      kind: "switch",
      id: "turn",
      label: "Auto-turn",
      icon: <DrawGlyph />,
      on: turning,
      onClick: () => setTurning((v) => !v),
    },
    {
      kind: "action",
      id: "sources",
      label: "Sources & layers",
      icon: <PinGearGlyph />,
      active: tray,
      controls: TRAY_ID,
      onClick: () => setTray((v) => !v),
    },
    {
      kind: "action",
      id: "alerts",
      label: "Notifications",
      icon: <AlertGlyph />,
      badge: "3",
      onClick: () => undefined,
    },
    {
      kind: "action",
      id: "host-close",
      label: "Row the host closes",
      icon: <SearchGlyph />,
      onClick: () => closeRail(surface),
    },
  ];
  const foot: RailEntry[] = [
    { kind: "rule", id: "foot-rule" },
    {
      kind: "link",
      id: "exit",
      label: "Exit to dashboard",
      icon: <span>←</span>,
      href: "/admin",
      refreshHref: () => `/admin?read=${++exitCount.current}`,
    },
    {
      kind: "action",
      id: "controls",
      label: "Controls",
      icon: <span>?</span>,
      onClick: () => undefined,
    },
  ];

  return (
    <div
      className="tn-terminal"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        overflow: "hidden",
        background: "repeating-linear-gradient(135deg, #141a20 0 14px, #171e25 14px 28px)",
      }}
    >
      {/* The admin bar is wider than a phone, and a phone browser zooms out to fit it. A real
          host has no such bar, so a measurement on this page must not have one either. */}
      <style>{".adm-bar { display: none; }"}</style>
      {mounted && <SideRail surface={surface} tone={tone} label="Map tools" menuLabel="Provenance" entries={entries} foot={foot} />}

      <div
        data-testid="neighbour"
        style={{
          position: "absolute",
          top: 16,
          left: "calc(var(--rail-w, 64px) + 24px)",
          width: 280,
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 12,
          paddingInline: 16,
          boxSizing: "border-box",
          borderRadius: 24,
          background: "rgba(14, 18, 22, 0.94)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          color: "#e8ecf0",
          fontSize: 14,
          transition: "left .18s ease",
        }}
      >
        Neighbour
      </div>

      <div
        style={{
          position: "absolute",
          top: 80,
          left: "calc(var(--rail-w, 64px) + 24px)",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: 8,
          color: "#e8ecf0",
          fontSize: 13,
          transition: "left .18s ease",
        }}
      >
        <input data-testid="owned-field" data-owns-escape="" aria-label="A field that owns Escape" />
        <label>
          <input
            type="checkbox"
            data-testid="claim-escape"
            checked={claimEscape}
            onChange={(e) => setClaimEscape(e.target.checked)}
          />{" "}
          Take Escape first
        </label>
        <button type="button" data-testid="unmount" onClick={() => setMounted((v) => !v)}>
          {mounted ? "Unmount the rail" : "Mount the rail"}
        </button>
        <output data-testid="ladder">{ladder}</output>
        <output data-testid="previews-state">{String(previews)}</output>
      </div>

      {tray && (
        <div
          id={TRAY_ID}
          style={{
            position: "absolute",
            top: 120,
            left: "calc(var(--rail-w, 64px) + 12px)",
            width: 260,
            padding: 14,
            background: "rgba(12, 15, 19, 0.96)",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            borderRadius: 12,
            color: "#e8ecf0",
            fontSize: 12,
            transition: "left .18s ease",
          }}
        >
          Tray
        </div>
      )}
    </div>
  );
}
