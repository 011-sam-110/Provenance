// lib/signals/losses-ua.ts
// STUB from the war-sources foundation commit (M1). The M3 agent replaces this file:
// relay feed `losses-ua` -> located Ukrainian losses as diamond points, labelled as the
// Russian side's documentation.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded } from "@/lib/signals/outcome";

export const LOSSES_UA_SOURCE: SignalSource = {
  id: "losses-ua",
  kind: "event",
  label: "Vehicle losses, Ukrainian",
  group: "Conflict",
  color: "#1f4f8a",
  precision: "exact",
  refreshMs: 60 * 60_000,
  attribution: "Documented by the Russian side: LostArmour (lostarmour.info), via creamy-caprice.net",
  sourceUrl: "https://lostarmour.info/",
  async fetch() {
    return degraded<SignalFeature>("not built yet");
  },
};
