// components/console/Segment.tsx
"use client";
import type { SegmentId } from "@/lib/console/types";
import { useShellLayout, shellLayoutStore } from "@/lib/console/store";
import { widgetsInSegment } from "@/lib/console/reducers";
import { dropIndex } from "@/lib/console/resize";
import { getWidgetType } from "@/lib/console/registry";
import WidgetFrame from "@/components/console/WidgetFrame";

export default function Segment({ id }: { id: SegmentId }) {
  const layout = useShellLayout();
  const widgets = widgetsInSegment(layout, id);
  const onDrop = (e: React.DragEvent) => {
    const wid = e.dataTransfer.getData("text/tn-widget");
    if (!wid) return;
    e.preventDefault();
    const cards = ([...e.currentTarget.querySelectorAll("[data-widget-id]")] as HTMLElement[])
      .filter((c) => c.dataset.widgetId !== wid);
    const rects = cards.map((c) => c.getBoundingClientRect());
    const idx = dropIndex({ x: e.clientX, y: e.clientY }, rects);
    shellLayoutStore.move(wid, id, idx);
  };
  return (
    <div className="tn-seg" data-segment={id}
         onDragOver={(e) => { if (e.dataTransfer.types.includes("text/tn-widget")) e.preventDefault(); }}
         onDrop={onDrop}>
      {widgets.length === 0 && <p className="tn-seg-empty">Drop a widget here, or add one with ⌘K</p>}
      {widgets.map((w) => (
        <div key={w.id} data-widget-id={w.id} className="tn-seg-slot" style={{ gridColumn: `span ${w.width}` }}>
          {/* h3 completes the outline the page had none of: h1 product (top bar) →
              h2 region (this column) → h3 widget. It is visually hidden and lives
              HERE rather than on the frame's own visible title because
              WidgetFrame.tsx is owned elsewhere; the tidy end-state is for that
              `<span className="tn-cw-title">` to become the h3 and for this line to
              go away. Until then a screen reader hears the widget's name twice when
              reading linearly — the price of being able to navigate by heading at
              all. */}
          <h3 className="tn-sr-only">{getWidgetType(w.type)?.title ?? w.type}</h3>
          <WidgetFrame instance={w} />
        </div>
      ))}
    </div>
  );
}
