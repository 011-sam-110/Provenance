"use client";
// One source, one line: dot · label · ＋ · toggle.
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
// A row that is ON also lights its marks on the map while you point at it (see
// lib/map/sourceHighlight.ts). The light follows the pointer OR the popover, so a
// phone tap and a keyboard focus light it too. It is held through sourceHoverStore,
// and the hold's release is the effect's cleanup.

import { useEffect, useId, useState } from "react";
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
import { explainerFor, confidenceChip, confidenceLabel } from "@/lib/signals/explain";
import { capabilityBadge } from "@/lib/console/widgets/signals";
import type { SourceRowModel } from "@/lib/console/sources/sections";

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

  const lit = (open || hovered) && on && !row.widgetOnly;
  useEffect(() => (lit ? sourceHoverStore.hold([row.id]) : undefined), [lit, row.id]);

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
    <div
      className="tn-src-row"
      data-source-row={row.id}
      data-on={on}
      style={{ ["--tn-src-dot" as string]: row.color }}
      // A press that lands on a control is that control's, not the drag's.
      // Without this the toggle and the ＋ would both begin a drag on the way down.
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) return;
        onDragHandle(e, row);
      }}
      // Mouse and pen only. A finger fires enter, down, up, leave in that order, so
      // counting it here opened the popover and shut it again before the click arrived,
      // and a second tap re-opened what it meant to close. For touch the click alone
      // decides: a tap opens, the next tap on the label closes, and moving focus away
      // (a tap elsewhere) closes it too.
      onPointerEnter={(e) => {
        if (e.pointerType === "touch") return;
        setOpen(true);
        setHovered(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "touch") return;
        setOpen(false);
        setHovered(false);
      }}
    >
      <span className="tn-src-dot" aria-hidden />
      <button
        type="button"
        className="tn-src-label"
        title={row.label}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        // KEYBOARD focus only. A tap focuses the button before the click arrives (Chrome),
        // so opening here as well made the click's toggle shut the popover again and a
        // phone tap lit nothing. The click does the opening for a tap; `:focus-visible`
        // is true for a Tab and false for a press, and iOS Safari never focuses on a tap.
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
      >
        {row.label}
      </button>
      <button
        type="button"
        className="tn-src-add"
        data-source-add={row.id}
        data-placed={placed}
        disabled={widgetTitle === null}
        aria-label={
          widgetTitle === null
            ? `${row.label} has no dashboard widget`
            : `Place ${widgetTitle} on the dashboard`
        }
        onClick={() => {
          if (widgetTitle === null) return;
          placementStore.ask({ type: widgetType, label: widgetTitle });
        }}
      >
        ＋
      </button>
      {/*
        A widget-only row has no map layer, so it has no toggle. Rendering a
        switch labelled "Show X on the map" beside something the map cannot draw
        would be a control that lies; worse, the rail's onToggle falls through to
        signalsStore for any id it does not recognise, so the switch would have
        written a phantom signal and then reported itself as off.
      */}
      {row.widgetOnly ? (
        <span className="tn-src-toggle-none" aria-hidden />
      ) : (
        <button
          type="button"
          className="tn-src-toggle"
          role="switch"
          aria-checked={on}
          aria-label={`Show ${row.label} on the map`}
          onClick={onToggle}
        />
      )}
      {open ? (
        <div className="tn-src-pop" id={popId} role="tooltip">
          <div className="tn-src-pop-grades">
            <ProvenanceChip id={row.id} />
            <LockedBadge id={row.id} />
          </div>
          <div className="tn-src-pop-attr">{row.attribution}</div>
          <div className="tn-src-pop-hint">
            {widgetTitle === null ? `${row.group} · map layer only` : `Places: ${widgetTitle}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
