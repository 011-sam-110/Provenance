"use client";
// The Display tab: what the console shows you — its language, which board is loaded, and
// the link that reproduces both.
//
// NO MAP VIEW CONTROLS HERE, deliberately. Basemap, 2D/3D, terrain and buildings live in
// the map rail's View group (components/console/maprail/ViewFlyout.tsx), and that file
// argues the case against a second surface for one concept better than a comment here
// could. There is no Appearance row to move either: the light/dark pair was deleted from
// the product, and a segment with one option left in it is a control that cannot do
// anything.
//
// THE TRANSIENT STATE MOVED WITH THE MARKUP, and that is not incidental. Inactive tabs
// unmount, so `copied` and its timer live here rather than in SettingsPanel — otherwise a
// "✓ Link copied" flash would survive a trip to another tab and back and be telling the
// user about something that happened a minute ago.

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGS } from "@/lib/i18n/catalog";
import { useLang, langStore } from "@/lib/i18n/store";
import { buildShareUrl } from "@/lib/share/deepLink";
import { encodeLayout } from "@/lib/console/share";
import { shellLayoutStore } from "@/lib/console/store";
import { BUILTIN_PRESETS, applyPreset, listPresets, saveCustomPreset } from "@/lib/console/presets";
import { useActivePreset } from "@/lib/console/activePreset";

/** A shareable URL that carries BOTH the map view state and the widget layout (?c=). */
async function copyLayoutLink(): Promise<boolean> {
  const base = buildShareUrl();
  const c = encodeLayout(shellLayoutStore.get());
  const url = `${base}${base.includes("?") ? "&" : "?"}c=${c}`;
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = url; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** One board card. The built-ins and the user's saved boards render identically. */
function BoardCard({ id, icon, title, blurb, active }: {
  id: string; icon: string; title: string; blurb: string; active: boolean;
}) {
  return (
    <button type="button"
      className={`tn-settings-board${active ? " is-active" : ""}`}
      aria-pressed={active} onClick={() => applyPreset(id)}>
      <span className="tn-settings-board-icon" aria-hidden>{icon}</span>
      <span className="tn-settings-board-text">
        <span className="tn-settings-board-title">{title}</span>
        <span className="tn-settings-board-blurb">{blurb}</span>
      </span>
    </button>
  );
}

export default function DisplayTab() {
  const lang = useLang();
  const activeId = useActivePreset();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // listPresets() reads localStorage directly (no reactive store — see
  // lib/console/presets.ts), so a save from THIS panel needs an explicit nudge to
  // reappear in the list below. Bumping presetTick forces the memo to re-read.
  const [presetTick, setPresetTick] = useState(0);
  const customPresets = useMemo(
    () => listPresets().filter((p) => !BUILTIN_PRESETS.some((b) => b.id === p.id)),
    [presetTick],
  );

  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const onShare = async () => {
    const ok = await copyLayoutLink();
    if (!ok) return;
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1800);
  };

  // Same working implementation the command palette used ("save-preset"): a plain
  // window.prompt for the name, then saveCustomPreset(). Kept identical rather
  // than built into a dialog — see lib/console/presets.ts's saveCustomPreset.
  const onSaveAsPreset = () => {
    const t = window.prompt("Preset name?");
    if (!t) return;
    saveCustomPreset(t);
    setPresetTick((n) => n + 1);
  };

  return (
    <>
      <section className="tn-settings-sec">
        <h3 className="tn-settings-sec-title">Language</h3>
        <div className="tn-settings-row">
          <span className="tn-settings-label">Interface</span>
          <div className="tn-settings-seg" role="group" aria-label="Interface language">
            {LANGS.map((l) => (
              <button key={l.code} type="button" className="tn-settings-seg-btn" title={l.name}
                aria-pressed={lang === l.code} onClick={() => langStore.set(l.code)}>{l.label}</button>
            ))}
          </div>
        </div>
      </section>

      <section className="tn-settings-sec">
        <h3 className="tn-settings-sec-title">Load a board</h3>
        <p className="tn-settings-hint">Swaps the widgets and the map overlays together.</p>
        <div className="tn-settings-boards">
          {BUILTIN_PRESETS.map((p) => (
            <BoardCard key={p.id} id={p.id} icon={p.icon} title={p.title} blurb={p.blurb}
              active={p.id === activeId} />
          ))}
        </div>
        {/* Custom boards, saved from this same panel (or from the palette before it moved
            here) — the command palette's "Profiles" group has always listed these
            alongside the built-ins via listPresets(); this list did not. */}
        {customPresets.length > 0 && (
          <>
            <h3 className="tn-settings-sec-title">Saved by you</h3>
            <div className="tn-settings-boards">
              {customPresets.map((p) => (
                <BoardCard key={p.id} id={p.id} icon={p.icon} title={p.title} blurb={p.blurb}
                  active={p.id === activeId} />
              ))}
            </div>
          </>
        )}
        <button type="button" className="tn-settings-tg-test" onClick={onSaveAsPreset}>
          Save current layout as a new board…
        </button>
      </section>

      <section className="tn-settings-sec">
        <h3 className="tn-settings-sec-title">Share</h3>
        <p className="tn-settings-hint">Copy a link that reopens this exact board and view.</p>
        <button type="button" className={`tn-settings-share${copied ? " is-copied" : ""}`} onClick={onShare}>
          {copied ? "✓ Link copied" : "Share this layout"}
        </button>
      </section>
    </>
  );
}
