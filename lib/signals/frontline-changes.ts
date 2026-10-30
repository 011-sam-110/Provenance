// lib/signals/frontline-changes.ts
// STUB from the war-sources foundation commit (M1). The M2 agent replaces this file:
// relay feed `frontline-changes` -> one feature per DeepState change with a map link.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded } from "@/lib/signals/outcome";

export const FRONTLINE_CHANGES_SOURCE: SignalSource = {
  id: "frontline-changes",
  kind: "event",
  label: "Front line changes",
  group: "Conflict",
  color: "#e0a020",
  precision: "area",
  refreshMs: 30 * 60_000,
  attribution: "Front line changes: DeepState (deepstatemap.live)",
  sourceUrl: "https://deepstatemap.live/en",
  async fetch() {
    return degraded<SignalFeature>("not built yet");
  },
};
