// lib/signals/forces-near-nato.ts
// STUB from the war-sources foundation commit (M1). The M4 agent replaces this file:
// the curated sites in forces-near-nato.data.ts -> one feature per site, each carrying
// its quoted claim, who made it, the date and the article link. No relay feed.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { compiled } from "@/lib/signals/outcome";

/** When the curated list was last edited. The M4 agent keeps this current. */
export const COMPILED_AT = Date.parse("2026-10-30T00:00:00Z");

export const FORCES_NEAR_NATO_SOURCE: SignalSource = {
  id: "forces-near-nato",
  kind: "asset",
  label: "Forces near NATO",
  group: "Conflict",
  color: "#464b37",
  precision: "area",
  refreshMs: 24 * 60 * 60_000,
  attribution: "Sites and claims from the reporting each one cites",
  async fetch() {
    return compiled<SignalFeature>([], COMPILED_AT);
  },
};
