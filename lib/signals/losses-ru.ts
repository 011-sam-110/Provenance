// lib/signals/losses-ru.ts
// STUB from the war-sources foundation commit (M1). The M3 agent replaces this file:
// relay feeds `losses-ru` + `loss-totals` -> located Russian losses as points, and a
// summary with the claimed-against-documented table.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded } from "@/lib/signals/outcome";

export const LOSSES_RU_SOURCE: SignalSource = {
  id: "losses-ru",
  kind: "event",
  label: "Vehicle losses, Russian",
  group: "Conflict",
  color: "#7a1f14",
  precision: "exact",
  refreshMs: 60 * 60_000,
  attribution: "Documented: WarSpotting (ukr.warspotting.net). Claimed: General Staff of Ukraine",
  sourceUrl: "https://ukr.warspotting.net/",
  async fetch() {
    return degraded<SignalFeature>("not built yet");
  },
};
