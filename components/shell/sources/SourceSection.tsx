"use client";
// One section of the Sources rail: a heading and a two-column grid of bullet rows.
//
// The heading carries two numbers and they answer different questions. The plain
// count says how big this section is, which is what you need while scanning for
// something. The "N on" only appears when it is non-zero and says how much of it
// is currently painting the map, which is what you need when the map looks busy
// and you want to know why.

import type { SourceRowModel, SourceSectionModel } from "@/lib/console/sources/sections";
import SourceRow from "@/components/shell/sources/SourceRow";

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

  return (
    <section className="tn-src-sec" data-section={section.id}>
      <h3 className="tn-src-sec-head">
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
