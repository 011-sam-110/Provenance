"use client";
// One source, one line: dot · label · ＋ · toggle, as the CONSOLE means it.
//
// The drawing is SourceRowView.tsx, shared with the God's eye view's Sources tray. This file
// is what is specific to the console: the ＋ names the dashboard widget and opens the
// placement picker, the popover carries the provenance chip, the locked badge, the widget
// line and the preview hint and is drawn in the shell beside the rail, the row lights its
// marks while you point at it, and a press that lands off a control starts the rail drag.
//
// The detail a row used to show inline — attribution, provenance class, freshness,
// live count — moves into a popover. That is a deliberate density trade and it has
// one cost worth naming: TOUCH HAS NO HOVER. So the popover opens on pointerenter
// AND on focus AND on tap of the label, and the label is a real <button>. Without
// that a phone user could never see where a layer's data comes from, which is the
// claim this product is built on.
//
// The ＋ is a SECOND, ALWAYS-VISIBLE control, not a hover reveal. Toggling a source
// paints it on the map; ＋ puts a widget for it on the dashboard. They are different
// actions on different surfaces, so the row shows both at rest.
//
// A row also lights its marks on the map while you point at it (see
// lib/map/sourceHighlight.ts). The light follows the pointer OR the popover, so a
// phone tap and a keyboard focus light it too. It is held through sourceHoverStore,
// and the hold's release is the effect's cleanup.
//
// A row that is OFF previews instead (lib/shell/sourcePreview.ts): its marks are drawn
// as they would be if it were on, for as long as you point at it, and the toggle, the
// saved board and the link are untouched. The row says so: a ring where its dot is
// while the marks load, and one line in the popover.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
// Side-effect import: getWidgetType reads a registry that the widget modules fill
// on import. ConsoleShell already does this, but CommandPalette repeats it for the
// same reason — a component that asks the registry a question should not depend on
// an ancestor having populated it. It is already in the console graph, so it costs
// no bundle.
import "@/lib/console/widgets";
import { getWidgetType } from "@/lib/console/registry";
import { placementStore } from "@/lib/console/placement";
import { widgetTypeForSource } from "@/lib/console/sourceWidgets";
import { useCapabilityStatus } from "@/lib/sources/useStatus";
import { sourceHoverStore } from "@/lib/shell/sourceHover";
import { sourcePreviewStore, type PreviewStatus } from "@/lib/shell/sourcePreview";
import { explainerFor, confidenceChip, confidenceLabel } from "@/lib/signals/explain";
import { capabilityBadge } from "@/lib/console/widgets/signals";
import type { SourceRowModel } from "@/lib/console/sources/sections";
import SourceRowView from "@/components/shell/sources/SourceRowView";

/**
 * How this layer knows what it knows — one of five grades.
 *
 * It moved into the popover with the rest of the detail, and it had to come with
 * it rather than be dropped: every layer draws the same coloured dot on the map,
 * so without this a seismometer and a news-wire guess look equally authoritative.
 */
function ProvenanceChip({ id }: { id: string }) {
  const e = explainerFor(id);
  if (!e) return null;
  return (
    <span
      className={`tn-layer-prov tn-conf-${e.confidence}`}
      title={`${confidenceLabel(e.confidence)} — ${e.method}`}
      data-confidence={e.confidence}
    >
      {confidenceChip(e.confidence)}
    </span>
  );
}

/**
 * "Locked — needs a key", or "credential refused", for a layer this deployment
 * cannot use right now.
 *
 * Without it a key-gated or refused layer renders zero and is indistinguishable
 * from a dead upstream or a genuinely quiet feed — the visitor concludes the
 * product is broken. The state → badge decision stays the shared capabilityBadge()
 * so this row and the widget's own empty state never disagree.
 */
function LockedBadge({ id }: { id: string }) {
  const status = useCapabilityStatus(id);
  const badge = capabilityBadge(status);
  if (!badge) return null;
  return (
    <span
      className="tn-layer-locked"
      data-state={badge.kind}
      style={
        badge.kind === "refused"
          ? { color: "var(--tn-down-ink)", borderColor: "var(--tn-down)" }
          : undefined
      }
      title={badge.long}
    >
      {badge.icon} {badge.short}
    </span>
  );
}

/** What the popover says about a switched-off row's preview. Idle and waiting say nothing. */
const PREVIEW_HINT: Partial<Record<PreviewStatus, string>> = {
  loading: "Preview only. Switch it on to keep it on the map.",
  ready: "Preview only. Switch it on to keep it on the map.",
  failed: "No preview right now.",
  empty: "Nothing to show right now.",
  unavailable: "Switch it on to see them.",
};

/** The popover's width in px (`.tn-src-pop`), for keeping it inside its host. */
const POP_W = 232;
const EDGE = 8;

/** Where the popover is drawn: in this host (the console shell), beside the rail or over the rows above. */
interface PopPlace {
  host: HTMLElement;
  /** "side": beside the rail, level with the row. "above": over the rows above it (the phone sheet). */
  mode: "side" | "above";
}

export default function SourceRow({
  row,
  on,
  placed,
  onToggle,
  onDragHandle,
}: {
  row: SourceRowModel;
  on: boolean;
  placed: boolean;
  onToggle: () => void;
  onDragHandle: (e: React.PointerEvent, row: SourceRowModel) => void;
}) {
  const [open, setOpen] = useState(false);
  // Pointing at the row with a mouse or pen. Not `open` alone: a click on the label
  // toggles `open`, which would switch the light off under a desktop user who is
  // still pointing at it. A touch tap never sets this, so there the light follows the
  // popover.
  const [hovered, setHovered] = useState(false);
  const popId = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PopPlace | null>(null);

  // On or off: an off row previews. A tap or a keyboard focus (the popover is open and
  // the pointer is not on the row) reads at once; a resting pointer waits 250 ms first.
  const active = (open || hovered) && !row.widgetOnly;
  const immediate = open && !hovered;
  useEffect(
    () => (active ? sourceHoverStore.hold([row.id], { immediate }) : undefined),
    [active, immediate, row.id],
  );
  // This row's preview status, while the pointer is on it or on its heading: a read that
  // is still running after you moved on shows nothing here. It re-renders on a status
  // change only, never per frame.
  const status = useSyncExternalStore(
    sourcePreviewStore.subscribe,
    () => sourcePreviewStore.shown(row.id),
    () => "idle" as PreviewStatus,
  );
  // An ON row behaves as it always did; only an off row has a preview to report.
  const previewStatus: PreviewStatus = !on && !row.widgetOnly ? status : "idle";
  const previewHint = PREVIEW_HINT[previewStatus];

  // THE POPOVER NEVER SITS OVER THE ROWS BELOW THE ONE YOU ARE ON, and it takes no pointer
  // events (`.tn-src-pop`). It used to hang under its row and was a hoverable box on top of
  // the next rows, so moving down the list landed on it and the list felt stuck. It is drawn
  // in the shell, outside the rail's own scrolling box, and placed beside the rail, level
  // with its row; on the phone the rail is a sheet with nothing beside it, so it goes over
  // the rows ABOVE. Placed when it opens, again if its text grows (the preview line arrives
  // after it opens) and while the list scrolls under it: events, never a frame loop.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const row = rowRef.current;
    const host = row?.closest<HTMLElement>(".tn-cw-shell") ?? row?.closest<HTMLElement>(".tn-terminal") ?? null;
    setPlace(host ? { host, mode: window.matchMedia("(max-width: 768px)").matches ? "above" : "side" } : null);
  }, [open]);

  const fit = useCallback(() => {
    const pop = popRef.current;
    const row = rowRef.current;
    if (!pop || !row || !place) return;
    const h = place.host.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    const rail = row.closest(".tn-rail")?.getBoundingClientRect();
    let left: number;
    let top: number;
    if (place.mode === "side") {
      pop.style.width = "";
      const popH = pop.offsetHeight;
      left = Math.min((rail?.right ?? r.right) - h.left + 10, Math.max(EDGE, h.width - POP_W - EDGE));
      top = Math.max(EDGE, Math.min(r.top - h.top - 4, h.height - popH - EDGE));
    } else {
      // The sheet is as wide as the screen, so the popover takes its width: wide is short, and
      // short leaves room above the row without reaching up over the map strip, which is the
      // only place a tap's marks can be seen. No room above the row: below it.
      pop.style.width = `${Math.round(h.width - 2 * EDGE)}px`;
      const popH = pop.offsetHeight;
      const sheetTop = (rail?.top ?? h.top) - h.top;
      left = EDGE;
      top = r.top - h.top - popH - 6;
      if (top < sheetTop + EDGE) top = r.bottom - h.top + 6;
      top = Math.max(EDGE, Math.min(top, h.height - popH - EDGE));
    }
    pop.style.left = `${Math.round(left)}px`;
    pop.style.top = `${Math.round(top)}px`;
  }, [place]);

  // Direct style writes, so none of this costs a render.
  useLayoutEffect(() => {
    fit();
  }, [fit, previewHint]);
  useEffect(() => {
    if (!place) return;
    document.addEventListener("scroll", fit, { capture: true, passive: true });
    window.addEventListener("resize", fit);
    return () => {
      document.removeEventListener("scroll", fit, { capture: true });
      window.removeEventListener("resize", fit);
    };
  }, [place, fit]);

  const widgetType = widgetTypeForSource(row.id);
  // The ＋ names the WIDGET; the row names the SOURCE. A camera row stays "Live
  // cams" / "Static cams" even though the thing it places is called something else,
  // because the toggle beside it acts on the map layer.
  //
  // NO SILENT FALLBACK TO row.label. If the registry has no widget of this type,
  // the ＋ would be claiming to place something that does not exist, so it says so
  // and disables itself rather than naming the source and failing on click.
  const widgetTitle = getWidgetType(widgetType)?.title ?? null;

  return (
    <SourceRowView
      row={row}
      on={on}
      rowRef={rowRef}
      rowProps={{
        "data-preview": previewStatus === "idle" ? undefined : previewStatus,
        "aria-busy": previewStatus === "loading" ? true : undefined,
        // Mouse and pen only. A finger fires enter, down, up, leave in that order, so
        // counting it here opened the popover and shut it again before the click arrived,
        // and a second tap re-opened what it meant to close. For touch the click alone
        // decides: a tap opens, the next tap on the label closes, and moving focus away
        // (a tap elsewhere) closes it too.
        onPointerEnter: (e) => {
          if (e.pointerType === "touch") return;
          setOpen(true);
          setHovered(true);
        },
        onPointerLeave: (e) => {
          if (e.pointerType === "touch") return;
          setOpen(false);
          setHovered(false);
        },
      }}
      slot={{
        placed,
        disabled: widgetTitle === null,
        ariaLabel:
          widgetTitle === null
            ? `${row.label} has no dashboard widget`
            : `Place ${widgetTitle} on the dashboard`,
        onPress: () => {
          if (widgetTitle === null) return;
          placementStore.ask({ type: widgetType, label: widgetTitle });
        },
      }}
      // A widget-only row has no map layer, so it has no toggle (see SourceRowView).
      onToggle={row.widgetOnly ? undefined : onToggle}
      toggleLabel={`Show ${row.label} on the map`}
      open={open}
      popoverId={popId}
      labelProps={{
        // KEYBOARD focus only. A tap focuses the button before the click arrives (Chrome),
        // so opening here as well made the click's toggle shut the popover again and a
        // phone tap lit nothing. The click does the opening for a tap; `:focus-visible`
        // is true for a Tab and false for a press, and iOS Safari never focuses on a tap.
        onFocus: (e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        },
        onBlur: () => setOpen(false),
        onClick: () => setOpen((o) => !o),
      }}
      // A press that lands on a control is that control's, not the drag's.
      // Without this the toggle and the ＋ would both begin a drag on the way down.
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onDragHandle(e, row);
      }}
      pop={
        open && place
          ? createPortal(
              <div ref={popRef} className="tn-src-pop" id={popId} role="tooltip" style={{ left: 0, top: 0 }}>
                <div className="tn-src-pop-grades">
                  <ProvenanceChip id={row.id} />
                  <LockedBadge id={row.id} />
                </div>
                <div className="tn-src-pop-attr">{row.attribution}</div>
                <div className="tn-src-pop-hint">
                  {widgetTitle === null ? `${row.group} · map layer only` : `Places: ${widgetTitle}`}
                </div>
                {previewHint ? <div className="tn-src-pop-hint">{previewHint}</div> : null}
              </div>,
              place.host,
            )
          : null
      }
    />
  );
}
