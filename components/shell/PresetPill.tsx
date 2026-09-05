"use client";
// The central navbar pill: the single board switcher. Shows the active board and
// drops down the five broad boards; picking one calls applyPreset(), which swaps
// BOTH the widgets and the map overlays in one shot (see lib/console/presets.ts).
// Replaces the old top-left variant switcher as the app's primary "what am I looking
// at" control. Custom saved boards (the palette's "Save workspace") are appended below a rule.

import { useEffect, useRef, useState } from "react";
import { BUILTIN_PRESETS, applyPreset, listPresets } from "@/lib/console/presets";
import { useActivePreset } from "@/lib/console/activePreset";

const FALLBACK = BUILTIN_PRESETS[0]; // World Overview — shown before the store hydrates

export default function PresetPill() {
  const activeId = useActivePreset();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);

  const all = listPresets();
  const active = all.find((p) => p.id === activeId) ?? FALLBACK;
  const builtins = all.filter((p) => BUILTIN_PRESETS.some((b) => b.id === p.id));
  const custom = all.filter((p) => !BUILTIN_PRESETS.some((b) => b.id === p.id));

  // Close on Escape or an outside click.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); };
  }, [open]);

  const pick = (id: string) => { applyPreset(id); setOpen(false); };

  return (
    // A <nav>, not a <div>: this is the console's primary way of moving between
    // views — picking a board swaps every widget AND the map overlays, so it is the
    // structural equivalent of a site's main menu. Same element, same class, so the
    // absolute centring in `.tn-preset-pill` is untouched; it just becomes a
    // landmark a screen-reader user can jump straight to.
    <nav className="tn-preset-pill" ref={ref} aria-label="Boards">
      <button type="button" className="tn-preset-pill-btn" aria-haspopup="menu" aria-expanded={open}
        aria-label="Board preset" onClick={() => setOpen((o) => !o)}>
        <span className="tn-preset-pill-icon" aria-hidden>{active.icon}</span>
        <span className="tn-preset-pill-title">{active.title}</span>
        <span className="tn-preset-pill-caret" aria-hidden>▾</span>
      </button>
      {open && (
        <div className="tn-preset-menu" role="menu">
          <p className="tn-preset-menu-head">Boards</p>
          {builtins.map((p) => (
            <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === active.id}
              className={`tn-preset-menu-item${p.id === active.id ? " is-active" : ""}`} onClick={() => pick(p.id)}>
              <span className="tn-preset-menu-icon" aria-hidden>{p.icon}</span>
              <span className="tn-preset-menu-text">
                <span className="tn-preset-menu-title">{p.title}</span>
                <span className="tn-preset-menu-blurb">{p.blurb}</span>
              </span>
            </button>
          ))}
          {custom.length > 0 && (
            <>
              <p className="tn-preset-menu-head">Saved</p>
              {custom.map((p) => (
                <button key={p.id} type="button" role="menuitemradio" aria-checked={p.id === active.id}
                  className={`tn-preset-menu-item${p.id === active.id ? " is-active" : ""}`} onClick={() => pick(p.id)}>
                  <span className="tn-preset-menu-icon" aria-hidden>{p.icon}</span>
                  <span className="tn-preset-menu-text"><span className="tn-preset-menu-title">{p.title}</span></span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </nav>
  );
}
