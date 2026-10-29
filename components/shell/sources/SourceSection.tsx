"use client";
// One section of the Sources rail: a heading and a two-column grid of bullet rows.
//
// The heading carries two numbers and they answer different questions. The plain
// count says how big this section is, which is what you need while scanning for
// something. The "N on" only appears when it is non-zero and says how much of it
// is currently painting the map, which is what you need when the map looks busy
// and you want to know why.

import { useEffect, useRef } from "react";
import type { SourceRowModel, SourceSectionModel } from "@/lib/console/sources/sections";
import SourceRow from "@/components/shell/sources/SourceRow";
import { sourceHoverStore } from "@/lib/shell/sourceHover";
import { previewIdsForSection } from "@/lib/shell/sourcePreview";

export default function SourceSection({
  section,
  isOn,
  isPlaced,
  onToggle,
  onDragHandle,
}: {
  section: SourceSectionModel;
  isOn: (id: string) => boolean;
  isPlaced: (id: string) => boolean;
  onToggle: (id: string) => void;
  onDragHandle: (e: React.PointerEvent, row: SourceRowModel) => void;
}) {
  const onCount = section.rows.filter((r) => isOn(r.id)).length;
  // Pointing at the heading lights every source in the section that is switched on and
  // previews the ones that are off. Mouse and pen only: a heading is not a button, so a
  // tap on it does nothing.
  const litIds = previewIdsForSection(section.rows);
  const releaseRef = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRef.current?.(), []);

  return (
    <section className="tn-src-sec" data-section={section.id}>
      <h3
        className="tn-src-sec-head"
        onPointerEnter={(e) => {
          if (e.pointerType === "touch" || litIds.length === 0) return;
          releaseRef.current?.();
          releaseRef.current = sourceHoverStore.hold(litIds);
        }}
        onPointerLeave={() => {
          releaseRef.current?.();
          releaseRef.current = null;
        }}
      >
        <span className="tn-src-sec-name">{section.title}</span>
        <span className="tn-src-sec-n tn-num">{section.rows.length}</span>
        {onCount > 0 ? <span className="tn-src-sec-on tn-num">{onCount} on</span> : null}
      </h3>
      <div className="tn-src-rows">
        {section.rows.map((row) => (
          <SourceRow
            key={row.id}
            row={row}
            on={isOn(row.id)}
            placed={isPlaced(row.id)}
            onToggle={() => onToggle(row.id)}
            onDragHandle={onDragHandle}
          />
        ))}
      </div>
    </section>
  );
}
