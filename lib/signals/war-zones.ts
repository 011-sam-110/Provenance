// lib/signals/war-zones.ts
// STUB from the war-sources foundation commit (M1). The M2 agent replaces this file:
// relay feed `war-zones` -> area features (Russian-held, contested, retaken) drawn only
// over each war zone, attack-direction points, and a summary with the held-area series.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded } from "@/lib/signals/outcome";

export const WAR_ZONES_SOURCE: SignalSource = {
  id: "war-zones",
  kind: "event",
  label: "War zones",
  group: "Conflict",
  color: "#b23a2b",
  precision: "area",
  refreshMs: 30 * 60_000,
  attribution: "Front line: DeepState (deepstatemap.live)",
  sourceUrl: "https://deepstatemap.live/en",
  async fetch() {
    return degraded<SignalFeature>("not built yet");
  },
};
