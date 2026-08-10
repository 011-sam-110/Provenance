// The pure half of GET /api/status: given the layer registry and an env bag,
// produce the capability report. Kept out of the route so the interesting bit —
// what counts as locked, what the totals mean — is unit-tested rather than
// verified by eyeballing JSON.
//
// The report answers one question honestly: for every layer we advertise, is it
// keyless and working, key-gated and configured, or key-gated and locked? A layer
// that renders nothing because we hold no key is NOT a broken layer, and a
// visitor deserves to be told which of the two they are looking at.

import {
  capabilityState,
  isUsable,
  keyRequirementFor,
  missingEnvFor,
  KEY_REQUIREMENTS,
  NON_SIGNAL_IDS,
  type CapabilityState,
} from "./keyRequirements";

export interface StatusEntry {
  id: string;
  label: string;
  group: string;
  /** See CapabilityState. `configured` means we HOLD the credential — not that the
   *  upstream accepts it. Liveness belongs to the freshness chip. */
  state: CapabilityState;
  /** Env var NAMES we are missing. Never values. Empty unless state === "locked". */
  missingEnv: string[];
  /** What the visitor loses while this is locked. Absent when nothing is locked. */
  degrades?: string;
  /** Where to get the credential. Absent when nothing is locked. */
  obtain?: string;
  /** Expected refresh cadence in ms, for layers that have one. */
  refreshMs?: number;
  attribution?: string;
}

export interface StatusReport {
  generatedAt: number;
  layers: StatusEntry[];
  /** Key-gated capabilities that are not map layers (webcams, equities, the brief). */
  capabilities: StatusEntry[];
  summary: {
    layersRegistered: number;
    layersKeyless: number;
    layersConfigured: number;
    layersLocked: number;
    /**
     * Layers not blocked by a missing credential.
     *
     * NOT "layers a visitor can use", which is what this field used to claim. A
     * layer can be fully configured and still deliver nothing — because the
     * upstream rejects the credential (ACLED 403s a token that passes its own
     * OAuth flow), because the socket opens and sends no frames (AIS), or because
     * there is genuinely nothing to report. Whether data is ARRIVING is the
     * freshness chip's question, observed per layer in the browser; this number
     * only says "no key is standing in the way".
     */
    layersNotKeyBlocked: number;
  };
}

interface RegistryLike {
  id: string;
  label: string;
  group: string;
  refreshMs?: number;
  attribution?: string;
}

function entryFor(src: RegistryLike, env: Record<string, string | undefined>): StatusEntry {
  const state = capabilityState(src.id, env);
  const missingEnv = missingEnvFor(src.id, env);
  const req = keyRequirementFor(src.id);
  return {
    id: src.id,
    label: src.label,
    group: src.group,
    state,
    missingEnv,
    // Shown whenever a credential is absent — for an enhancement that reads as
    // "this works, a key would make it better", which is the truth we were
    // getting wrong by calling it locked.
    ...((state === "locked" || state === "upgradable") && req
      ? { degrades: req.degrades, obtain: req.obtain }
      : {}),
    ...(src.refreshMs != null ? { refreshMs: src.refreshMs } : {}),
    ...(src.attribution ? { attribution: src.attribution } : {}),
  };
}

export function buildStatusReport(
  signals: RegistryLike[],
  env: Record<string, string | undefined>,
  now: number,
): StatusReport {
  const layers = signals.map((s) => entryFor(s, env));

  // The non-layer capabilities are described entirely by the requirements table,
  // so they are synthesised from it rather than from a registry.
  const capabilities = KEY_REQUIREMENTS.filter((r) => NON_SIGNAL_IDS.has(r.id)).map((r) =>
    entryFor({ id: r.id, label: r.label, group: "Capability" }, env),
  );

  const count = (s: CapabilityState) => layers.filter((l) => l.state === s).length;
  const layersKeyless = count("keyless");
  const layersConfigured = count("configured") + count("enhanced");
  const layersLocked = count("locked");

  return {
    generatedAt: now,
    layers,
    capabilities,
    summary: {
      layersRegistered: layers.length,
      layersKeyless,
      layersConfigured,
      layersLocked,
      layersNotKeyBlocked: layers.filter((l) => isUsable(l.state)).length,
    },
  };
}
