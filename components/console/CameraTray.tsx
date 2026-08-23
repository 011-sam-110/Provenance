"use client";
// ── The camera tray ──────────────────────────────────────────────────────────
//
// The basket, made visible. It is the half of picking that arming never had: a
// standing, on-screen answer to "what have I chosen, and where is it going?".
//
// WHY IT SITS ON THE STAGE AND NOT THE VIEWPORT. Picking happens on the map, and the
// tray is the receipt for it. A fixed bar across the bottom of the window would float
// over whichever widget happened to be at the foot of the board and would claim to
// belong to the whole console, when it belongs to one gesture on one surface. It is
// rendered as a child of the stage container and positioned against that box, so it
// covers the map it is describing and nothing else.
//
// WHY IT DISAPPEARS. Visible only while the basket has something in it or picking is
// switched on. A tray that is always there is chrome; a tray that appears when you
// start choosing and leaves when you are done is feedback.
//
// THE AREA TOTAL IS NEVER `picks.length`. When a drawn area held more cameras than a
// wall can take, the tray says so in the area's own numbers. Printing the basket size
// as the area's total would turn a cap into a coverage claim — "Soho has 60 cameras"
// — which is the one thing this product must not say.

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_PICKS, pickStore, usePicks } from "@/lib/console/widgets/camslot.pick";
import { camslotTargets, sendPicksToWall, type CamslotTarget } from "@/lib/console/widgets/camslot.send";

/** The console's one notification channel — ConsoleShell listens for this and
 *  renders it into the single `.tn-toast` live region. A second mechanism here
 *  would mean two things on screen claiming to be the app talking. */
function toast(message: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tn-toast", { detail: message }));
}

export default function CameraTray() {
  const { mode, picks, foundInArea } = usePicks();
  const [menuOpen, setMenuOpen] = useState(false);
  // Snapshotted when the menu OPENS rather than subscribed to. The list is only ever
  // read while it is on screen, and taking it at open time means a wall added by
  // another surface mid-menu cannot renumber the rows under the user's cursor.
  const [targets, setTargets] = useState<CamslotTarget[]>([]);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const closeMenu = useCallback((refocus: boolean) => {
    setMenuOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Escape closes from anywhere inside the tray, and hands focus back to the button
  // that opened it — a keyboard user who dismisses a menu and lands at the top of the
  // document has been punished for using the keyboard.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeMenu(true);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (menuRef.current?.contains(t ?? null)) return;
      if (triggerRef.current?.contains(t ?? null)) return;
      closeMenu(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [menuOpen, closeMenu]);

  // A menu left open over a board that has changed underneath it is a menu that sends
  // somewhere the user did not choose, so it closes with the tray.
  useEffect(() => {
    if (picks.length === 0 && menuOpen) closeMenu(false);
  }, [picks.length, menuOpen, closeMenu]);

  const openMenu = useCallback(() => {
    setTargets(camslotTargets());
    setMenuOpen(true);
  }, []);

  const send = useCallback((target: string) => {
    closeMenu(true);
    toast(sendPicksToWall(target).message);
  }, [closeMenu]);

  // Nothing chosen and not picking: the tray has nothing to say, so it says nothing.
  if (picks.length === 0 && mode !== "picking") return null;

  const empty = picks.length === 0;

  return (
    <div className="tn-tray" role="region" aria-label="Picked cameras">
      <div className="tn-tray-row">
        <span className="tn-tray-count" role="status" aria-live="polite">
          {empty ? "PICKING — click cameras on the map" : `SELECTED ${picks.length}`}
        </span>

        {picks.length > 0 && (
          <ul className="tn-tray-strip" aria-label="Cameras in the tray">
            {picks.map((p) => (
              <li key={p.key} className="tn-tray-chip">
                <span className="tn-tray-chip-label" title={p.label}>{p.label}</span>
                {p.source ? <span className="tn-tray-chip-src">{p.source}</span> : null}
                <button
                  type="button"
                  className="tn-tray-chip-x"
                  aria-label={`Remove ${p.label}`}
                  onClick={() => pickStore.remove(p.key)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="tn-tray-actions">
          <div className="tn-tray-menu-wrap">
            <button
              type="button"
              ref={triggerRef}
              className="tn-tray-btn is-primary"
              disabled={empty}
              aria-expanded={menuOpen}
              aria-haspopup="true"
              onClick={() => (menuOpen ? closeMenu(true) : openMenu())}
            >
              Send to wall ▾
            </button>

            {menuOpen && (
              // A labelled group of ordinary buttons rather than role="menu". A menu
              // promises arrow-key roving that this does not implement, and Tab
              // through real buttons already works; claiming the role and not
              // honouring it is worse for a screen-reader user than not claiming it.
              <div className="tn-tray-menu" ref={menuRef} role="group" aria-label="Send picked cameras to">
                <button type="button" className="tn-tray-menu-item" onClick={() => send("new")}>
                  New camera wall
                </button>
                {targets.length > 0 && <div className="tn-tray-menu-sep" />}
                {targets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="tn-tray-menu-item"
                    onClick={() => send(t.id)}
                  >
                    <span className="tn-tray-menu-name">{t.name}</span>
                    <span className="tn-tray-menu-count">({t.count})</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Always does something visible. With a basket it empties it; with an
              empty basket the only sensible reading of "clear" is "stop", and a
              tray with no way out of picking is the dead end this overhaul exists
              to remove. */}
          <button
            type="button"
            className="tn-tray-btn"
            onClick={() => (empty ? pickStore.setMode("off") : pickStore.clear())}
          >
            {empty ? "Stop picking" : "Clear"}
          </button>
        </div>
      </div>

      {foundInArea > picks.length && (
        <p className="tn-tray-note">
          this area has {foundInArea} cameras — a wall holds {MAX_PICKS}
        </p>
      )}
    </div>
  );
}
