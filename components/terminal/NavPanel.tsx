"use client";
// The Apple-style nav panel's own content: quick settings + widget show/hide
// for whichever board TerminalHeader says is open (hover-previewed OR the
// active board via `.tnx-hdr-nav-toggle`). Split out of TerminalHeader.tsx
// purely to keep that file from ballooning further past its already-420
// lines — this component owns no timing/open-close logic of its own beyond
// the two purely-cosmetic sequencing effects below (the `hidden`-attribute
// handoff and the measured-height CSS var), both of which are debounce
// timers / a ResizeObserver, never React state driven by an animation frame.
//
// WHY CONTENT IS KEYED OFF "THE LAST NON-NULL openId", NOT openId ITSELF.
// TerminalHeader's navPanelStore sets `openId` straight to `null` the instant
// a close starts — there is no separate "closing" scene id in the store, by
// design (see lib/console/navPanel.ts). But the CSS close transition still
// has to animate SOMETHING shrinking and fading over HEIGHT_TRANSITION_MS,
// and re-rendering empty content the moment the close begins would make the
// panel visibly go blank before it visibly goes away. `displayId` below is
// "openId, or whatever it last was, until the close animation finishes" —
// the `hidden` attribute is what actually removes the panel from the a11y
// tree, on the same clock, via `visible` below.
//
// WHY listPresets() AND NOT presetById()/BUILTIN_PRESETS. `.tnx-hdr-nav-toggle`
// always opens `activePresetStore.get()`, and the active board can legitimately
// be a CUSTOM saved board (Settings' "load a board" list), not one of the seven
// built-ins — TerminalHeader's own `boardTitle` already reads `listPresets()`
// rather than `BUILTIN_PRESETS` for exactly this reason. Hover-preview only ever
// targets one of the seven tabs, so this only matters for the toggle path, but
// getting it wrong there would silently blank the panel's header the first time
// someone opened quick settings on a saved board.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { applyPreset, listPresets } from "@/lib/console/presets";
import { activePresetStore, useActivePreset } from "@/lib/console/activePreset";
import { getWidgetType, widgetsByCategory } from "@/lib/console/registry";
import { shellLayoutStore } from "@/lib/console/store";
import { WIDGET_LIMIT_MESSAGE } from "@/lib/console/types";
import { boardWidgetTypes, sceneChromeStore, useSceneChrome } from "@/lib/console/sceneChrome";
import { HEIGHT_TRANSITION_MS, navPanelStore } from "@/lib/console/navPanel";

/** The one panel element every board tab's `aria-controls` points at. Exported
 *  so TerminalHeader's tabs/toggle reference the same string rather than a
 *  second copy of the literal. */
export const NAV_PANEL_ID = "tnx-nav-panel";

export default function NavPanel({ openId }: { openId: string | null }) {
  const activePresetId = useActivePreset();

  // See the file header: content trails openId by one close animation so the
  // panel does not go visually blank before it visually closes.
  const [displayId, setDisplayId] = useState<string | null>(openId);
  useEffect(() => {
    if (openId !== null) setDisplayId(openId);
  }, [openId]);

  // The `hidden` attribute's own clock — independent of the CSS transition,
  // which claude-css drives off `--tnx-navpanel-h`/max-height. Removed the
  // instant openId goes non-null (no delay opening); re-added only after
  // HEIGHT_TRANSITION_MS of closing, so a screen reader never announces an
  // empty region mid-close. A plain timeout, not a transitionend listener —
  // both are sanctioned by nav-spec §7 and a timeout does not depend on which
  // of the panel's own transitioning properties fires last.
  const [visible, setVisible] = useState(openId !== null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (openId !== null) {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      setVisible(true);
    } else {
      hideTimerRef.current = setTimeout(() => setVisible(false), HEIGHT_TRANSITION_MS);
    }
    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [openId]);

  // The measured-height CSS var. Set once on mount (the panel exists, just
  // hidden, from the first render — see TerminalHeader) and kept current by a
  // ResizeObserver on the CONTENT node, which fires on its own whenever the
  // inner's border-box changes — a different scene's content, a widget
  // hidden/unhidden, a viewport resize that reflows text. No React state
  // updates per frame: the observer callback writes the CSS custom property
  // straight onto the DOM node, exactly the mechanism nav-spec §5 pins.
  const innerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const inner = innerRef.current;
    const panel = panelRef.current;
    if (!inner || !panel || typeof ResizeObserver === "undefined") return;
    const setHeight = () => {
      panel.style.setProperty("--tnx-navpanel-h", `${inner.scrollHeight}px`);
    };
    setHeight();
    const ro = new ResizeObserver(setHeight);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const chrome = useSceneChrome(displayId);
  const scene = displayId ? (listPresets().find((p) => p.id === displayId) ?? null) : null;
  const isActiveScene = displayId !== null && displayId === activePresetId;

  // Every widget TYPE this board actually holds right now, hidden or not —
  // hiding is a paint-time filter, never a layout mutation, so a hidden
  // widget's checkbox must still appear here (unchecked) rather than
  // vanishing from the list along with its own render.
  const widgetTypeIds = displayId ? [...new Set(boardWidgetTypes(displayId))] : [];
  const onBoard = new Set(widgetTypeIds);

  // "Add a widget…" only makes sense for the board actually on screen — the
  // add button writes straight to `shellLayoutStore`, which is the LIVE
  // layout, so offering it while previewing a board you have not switched to
  // would silently edit a board you are not looking at.
  const addableCategories = isActiveScene
    ? widgetsByCategory()
        .map((cat) => ({ category: cat.category, types: cat.types.filter((t) => !onBoard.has(t.id)) }))
        .filter((cat) => cat.types.length > 0)
    : [];

  function handleAdd(typeId: string) {
    // Same two steps as SourceCatalog's own drop handler — same cap check,
    // same toast, same wording (WIDGET_LIMIT_MESSAGE is derived from
    // MAX_WIDGETS, never retyped). "left" matches the drop handler's segment
    // choice; there is no drawn-target rail here to infer one from.
    const r = shellLayoutStore.add(typeId, { segment: "left" });
    if (!r.ok && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("tn-toast", { detail: WIDGET_LIMIT_MESSAGE }));
    }
  }

  return (
    <div
      className="tnx-nav-panel"
      id={NAV_PANEL_ID}
      ref={panelRef}
      role="region"
      aria-label={`${scene?.title ?? "Board"} quick settings`}
      // Mirrors .tnx-nav-scrim's own data-open — the signal CSS keys its
      // height/opacity transition off, because it has to flip in lockstep
      // with the real open/close edge. `hidden` deliberately does NOT do
      // that (see the file header): it lags close by HEIGHT_TRANSITION_MS so
      // the a11y tree doesn't lose the region mid-animation, which means it
      // is the wrong signal for "should the CSS transition be running right
      // now" — `openId` itself (not `displayId`, which lags on purpose too)
      // is the one prop that changes on the same tick as the real edge.
      data-open={openId !== null || undefined}
      hidden={!visible}
    >
      <div className="tnx-nav-panel-inner" ref={innerRef}>
        <header className="tnx-nav-panel-head">
          <span className="tnx-nav-panel-icon" aria-hidden>
            {scene?.icon ?? ""}
          </span>
          <h3 className="tnx-nav-panel-title">{scene?.title ?? "Board"}</h3>
          <p className="tnx-nav-panel-blurb">{scene?.blurb ?? ""}</p>
          {/* Only when previewing a scene that is NOT the one on screen — the
              panel's single board-switching affordance, per nav-spec §1.
              Board switching itself already lives in Settings' "Load a board"
              list and ⌘K's Profiles; this is not a second copy of that, it is
              the one-tap "yes, actually take me there" for the board whose
              settings someone is already looking at. */}
          {!isActiveScene && displayId && scene && (
            <button
              type="button"
              className="tnx-nav-panel-switch"
              onClick={() => {
                applyPreset(displayId);
                navPanelStore.close();
              }}
            >
              Open {scene.title} →
            </button>
          )}
        </header>

        <div className="tnx-nav-panel-body">
          <section className="tnx-nav-quick" aria-label="Quick settings">
            <h4 className="tnx-nav-sec-title">Quick settings</h4>
            <label className="tnx-nav-quick-row">
              <input
                type="checkbox"
                checked={chrome.quick.compactCards === true}
                onChange={(e) => {
                  if (displayId) sceneChromeStore.setQuick(displayId, { compactCards: e.target.checked });
                }}
              />
              Compact cards
            </label>
          </section>

          <section className="tnx-nav-widgets" aria-label="Widgets on this board">
            <h4 className="tnx-nav-sec-title">Widgets on this board</h4>
            {widgetTypeIds.length === 0 ? (
              <p>No widgets on this board yet.</p>
            ) : (
              widgetTypeIds.map((typeId) => {
                const type = getWidgetType(typeId);
                if (!type) return null;
                const hidden = chrome.hidden.includes(typeId);
                return (
                  <div className="tnx-nav-widget-row" key={typeId}>
                    <label>
                      <input
                        type="checkbox"
                        checked={!hidden}
                        onChange={(e) => {
                          if (displayId) sceneChromeStore.setHidden(displayId, typeId, !e.target.checked);
                        }}
                      />
                      <span className="tnx-nav-widget-icon" aria-hidden>
                        {type.icon}
                      </span>
                      <span className="tnx-nav-widget-title">{type.title}</span>
                    </label>
                  </div>
                );
              })
            )}

            {isActiveScene && addableCategories.length > 0 && (
              <details className="tnx-nav-widget-add">
                <summary>Add a widget…</summary>
                {addableCategories.map((cat) => (
                  <div key={cat.category}>
                    <div className="tnx-nav-sec-title">{cat.category}</div>
                    {cat.types.map((type) => (
                      <div className="tnx-nav-widget-row" key={type.id}>
                        <button type="button" onClick={() => handleAdd(type.id)}>
                          <span className="tnx-nav-widget-icon" aria-hidden>
                            {type.icon}
                          </span>
                          <span className="tnx-nav-widget-title">{type.title}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </details>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
