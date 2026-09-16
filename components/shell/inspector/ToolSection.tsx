"use client";
// A section of an Inspector tool: an elevated heading, and the controls it owns
// INDENTED under it.
//
// THE NESTING IS THE POINT, and it is the one thing every tool panel on this rail has
// to get right. Every control belongs to the heading above it, and before this they
// all sat at the same left edge as the headings — so "Terrain" and "SURFACE" read as
// siblings rather than as a section and one of its settings. The indent plus the guide
// rule is what makes the hierarchy visible without a second type size.
//
// ONE COMPONENT RATHER THAN THE MARKUP TWICE. Map settings has three of these and
// Notifications has one; a hand-written copy in each file is how the second one drifts
// from the first, and the drift would be invisible — two panels that are each
// internally consistent and different from each other.
//
// The heading keeps `.tn-src-sec-head`, which is the Sources tab's own class: reused,
// with the elevation (filled bar, accent tick, weight 800) added by the tool-rail CSS
// block rather than by a second class here.

export default function ToolSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="tn-insp-group">
      <h3 className="tn-src-sec-head">
        <span className="tn-src-sec-name">{title}</span>
      </h3>
      <div className="tn-insp-group-body">{children}</div>
    </section>
  );
}
