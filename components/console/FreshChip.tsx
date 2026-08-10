"use client";
// The freshness chip in a widget header.
//
// Deliberately its own component rather than JSX inside WidgetFrame: the label has
// to AGE (a feed that stops updating must visibly drift from "live" to "4m old" to
// "stale · 2h" with no further reports from the widget), which means a ticking
// clock. Keeping the tick in here means the tick re-renders ~30 characters of text
// instead of re-rendering every widget body on the board twice a minute.
//
// The interesting logic — what counts as stale, what "empty" means, what the
// tooltip says — is pure and unit-tested in lib/console/freshChip.ts.

import { useNow } from "@/lib/shell/useNow";
import { freshChipView, type FreshObservation } from "@/lib/console/freshChip";

/** Fast enough that a 12s feed shows its drift; slow enough to be free. */
const TICK_MS = 10_000;

export default function FreshChip({ obs }: { obs: FreshObservation }) {
  const now = useNow(TICK_MS);
  const view = freshChipView(obs, now);
  return (
    <span className={`tn-cw-fresh tn-fresh-${view.kind}`} title={view.title}>
      {view.label}
    </span>
  );
}
