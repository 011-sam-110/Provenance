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

import { useId, useState } from "react";
// Side-effect import: getWidgetType reads a registry that the widget modules fill
// on import. ConsoleShell already does this, but CommandPalette repeats it for the
// same reason — a component that asks the registry a question should not depend on
// an ancestor having populated it. It is already in the console graph, so it costs
// no bundle.
import "@/lib/console/widgets";
import { getWidgetType } from "@/lib/console/registry";
import { placementStore } from "@/lib/console/placement";
import { widgetTypeForSource } from "@/lib/console/sourceWidgets";
import type { SourceRowModel } from "@/lib/console/sources/sections";

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
  const popId = useId();

  const widgetType = widgetTypeForSource(row.id);
  // The ＋ names the WIDGET; the row names the SOURCE. The Cameras row stays
  // "Cameras" even when the thing it places is called something else, because the
  // toggle beside it acts on the map layer.
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
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <span className="tn-src-dot" aria-hidden />
      <button
        type="button"
        className="tn-src-label"
        title={row.label}
        aria-expanded={open}
        aria-describedby={open ? popId : undefined}
        onFocus={() => setOpen(true)}
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
      <button
        type="button"
        className="tn-src-toggle"
        role="switch"
        aria-checked={on}
        aria-label={`Show ${row.label} on the map`}
        onClick={onToggle}
      />
      {open ? (
        <div className="tn-src-pop" id={popId} role="tooltip">
          <div className="tn-src-pop-attr">{row.attribution}</div>
          <div className="tn-src-pop-hint">
            {widgetTitle === null ? `${row.group} · map layer only` : `Places: ${widgetTitle}`}
          </div>
        </div>
      ) : null}
    </div>
  );
}
