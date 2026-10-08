"use client";
// A line in the detail panel of a USGS or EMSC earthquake: is the same event in the
// other layer? Reads both lists through the shared, ref-counted feed (the one the map
// and the cards poll), so it works with the layers off and opens no second loop, and
// says nothing until both have been read.
//
// All the logic is in lib/signals/quakeTwin.ts (pure, unit-tested). This file only
// draws it, in the muted style of the panel's coordinates line.

import { useSignalFeed } from "@/lib/console/signals/useSignalFeed";
import { quakeTwinView, twinLayerOf, twinLines, type QuakeFacts } from "@/lib/signals/quakeTwin";

/** Mount only for a layer `twinLayerOf` knows: the hooks below must always run. */
export default function QuakeTwin({ signalId, facts }: { signalId: string; facts: QuakeFacts }) {
  const other = twinLayerOf(signalId) ?? signalId;
  const theirs = useSignalFeed(other);
  const ours = useSignalFeed(signalId);
  const view = quakeTwinView(signalId, facts, theirs, ours);
  const lines = twinLines(view, signalId);
  if (!lines) return null;
  return (
    <div
      data-testid="quake-twin"
      data-verdict={view.kind}
      style={{ marginTop: 10, fontSize: 12, lineHeight: 1.4, color: "var(--tn-text-muted)" }}
    >
      <div style={{ fontWeight: 600, color: "var(--tn-text)" }}>{lines.headline}</div>
      {lines.note && <div>{lines.note}</div>}
      {lines.caveat && <div style={{ fontStyle: "italic" }}>{lines.caveat}</div>}
    </div>
  );
}
