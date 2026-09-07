"use client";
// In-overlay body for a saved area.
//
// The Inspector tab is the INDEX — every area, one row each. This is the DETAIL, and
// it opens in the same right-edge dossier that a camera, a plane or a country opens
// in. That split is the whole point: the rail stays a list you can scan, and the
// panel that was already the app's detail surface goes on being it.
//
// IT READS THE STORE, NOT THE OVERLAY OBJECT. The object carries only an id; every
// field below is looked up live. So a rename in this panel, a toggle in the Sources
// tab and a load from anywhere all repaint it, and an area removed elsewhere leaves
// an honest "no longer saved" rather than a stale copy of something that is gone.
//
// THE SOURCE LIST HERE IS READ-ONLY, on purpose. Sources are configured in the
// Sources tab, which is already pointed at whichever context is loaded. Two places
// to change one thing is the bug this whole split exists to avoid.

import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { WorldObject } from "@/lib/world";
import { areaSummary, inspectorStore, useInspector } from "@/lib/shell/inspector";
import { scopeStore, WORLD_SCOPE } from "@/lib/shell/scope";
import { mapViewStore } from "@/lib/mapView";
import { overlay } from "@/lib/overlay";

const CARD_STYLE: CSSProperties = {
  padding: "10px",
  borderRadius: 8,
  background: "var(--tn-surface-2, rgba(148,163,184,0.10))",
};
const TITLE_STYLE: CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--tn-text)" };
const NOTE_STYLE: CSSProperties = { fontSize: 11, color: "var(--tn-text-muted)" };
const ROW_STYLE: CSSProperties = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" };
const BTN_STYLE: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  border: "1px solid var(--tn-border)",
  borderRadius: 6,
  padding: "4px 9px",
  background: "transparent",
  color: "var(--tn-text)",
  cursor: "pointer",
};
const LABEL_INPUT_STYLE: CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  width: "100%",
  border: "1px solid var(--tn-border)",
  borderRadius: 6,
  padding: "4px 7px",
  background: "var(--tn-surface, transparent)",
  color: "var(--tn-text)",
};

/** [west, south, east, north] → its centre. */
function bboxCentre(bbox: [number, number, number, number]): { lat: number; lon: number } {
  return { lat: (bbox[1] + bbox[3]) / 2, lon: (bbox[0] + bbox[2]) / 2 };
}

export default function AreaDetail({ object }: { object: WorldObject }) {
  const state = useInspector();
  const area = state.areas.find((a) => a.id === object.id) ?? null;
  const [draft, setDraft] = useState(area?.label ?? "");

  // Follow a rename made anywhere else, but never while this input has focus —
  // overwriting what someone is mid-way through typing is its own small betrayal.
  useEffect(() => {
    if (!area) return;
    if (document.activeElement?.getAttribute("data-tn-area-label") === area.id) return;
    setDraft(area.label);
  }, [area]);

  if (!area) {
    return (
      <div style={{ ...CARD_STYLE, display: "grid", gap: 6 }}>
        <div style={TITLE_STYLE}>Area no longer saved</div>
        <div style={NOTE_STYLE}>
          It was removed while this panel was open. Nothing here is stale — the panel simply has
          nothing left to show.
        </div>
      </div>
    );
  }

  const loaded = state.loaded === area.id;
  const centre = bboxCentre(area.bbox);
  const on = Object.entries(area.sources)
    .filter(([, v]) => v)
    .map(([id]) => id)
    .sort();

  const commitLabel = () => {
    const next = draft.trim();
    // An empty label would leave an unclickable blank row in the index.
    if (!next || next === area.label) {
      setDraft(area.label);
      return;
    }
    inspectorStore.rename(area.id, next);
  };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label style={NOTE_STYLE} htmlFor={`area-label-${area.id}`}>
          Area name
        </label>
        <input
          id={`area-label-${area.id}`}
          data-tn-area-label={area.id}
          style={LABEL_INPUT_STYLE}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(area.label);
              e.currentTarget.blur();
            }
          }}
        />
        <div style={NOTE_STYLE}>{areaSummary(area)}</div>
      </div>

      <div style={{ ...CARD_STYLE, display: "grid", gap: 6 }}>
        <div style={TITLE_STYLE}>Shape</div>
        <div style={NOTE_STYLE}>
          {area.polygon.length} vertices · centre {centre.lat.toFixed(2)}, {centre.lon.toFixed(2)}
        </div>
        <div style={NOTE_STYLE}>
          Drawn, not a bounding box — the console filters on the ring itself, and the box is only
          the cheap first reject.
        </div>
      </div>

      <div style={ROW_STYLE}>
        <button
          type="button"
          style={{
            ...BTN_STYLE,
            borderColor: loaded ? "var(--tn-accent, var(--tn-border))" : "var(--tn-border)",
          }}
          onClick={() => {
            if (loaded) {
              inspectorStore.load(null);
              scopeStore.set(WORLD_SCOPE);
              return;
            }
            inspectorStore.load(area.id);
            scopeStore.set({
              mode: "aoi",
              bbox: area.bbox,
              polygon: area.polygon as [number, number][],
              label: area.label,
            });
          }}
        >
          {loaded ? "Unload — back to World" : "Load this area"}
        </button>
        <button
          type="button"
          style={BTN_STYLE}
          onClick={() => mapViewStore.flyToPoint({ lat: centre.lat, lon: centre.lon, zoom: 6 })}
        >
          Fly to
        </button>
        <button
          type="button"
          style={BTN_STYLE}
          onClick={() => {
            inspectorStore.remove(area.id);
            overlay.close();
          }}
        >
          Remove
        </button>
      </div>

      <div style={{ ...CARD_STYLE, display: "grid", gap: 6 }}>
        <div style={TITLE_STYLE}>Sources on here</div>
        {on.length === 0 ? (
          <div style={NOTE_STYLE}>
            Nothing switched on yet. Cameras and webcams still draw — an area never loads to a
            blank map.
          </div>
        ) : (
          <div style={NOTE_STYLE}>{on.join(", ")}</div>
        )}
        <div style={NOTE_STYLE}>
          Change these in the Sources tab — it is already pointed at this area.
        </div>
      </div>
    </div>
  );
}
