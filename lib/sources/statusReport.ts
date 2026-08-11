// The pure half of GET /api/status: given the layer registry and an env bag,
// produce the capability report. Kept out of the route so the interesting bit —
// what counts as locked, what the totals mean — is unit-tested rather than
// verified by eyeballing JSON.
//
// The report answers one question honestly: for every layer we advertise, is it
// keyless and working, key-gated and configured, or key-gated and locked? A layer
// that renders nothing because we hold no key is NOT a broken layer, and a
// visitor deserves to be told which of the two they are looking at.
//
// TWO THINGS THIS USED TO GET WRONG, both fixed here.
//
// 1. "We hold the key" was published as if it meant "the key works". ACLED came out
//    as `configured` with `missingEnv: []` while acleddata.com answered 403 to a
//    token that had just passed ACLED's own OAuth flow. There is now a `refused`
//    state, reached ONLY from observed evidence (lib/sources/upstreamEvidence.ts) —
//    never from a hardcoded list, and never guessed from silence.
//
// 2. The report was configuration-only. A stranger with curl could see what we had
//    signed up for and nothing about what was arriving. Every entry now carries a
//    `flow` block: when this server process last fetched that layer and how many
//    rows came back. It is OBSERVED, not probed — the numbers come from fetches the
//    app was making anyway, so /api/status starts no upstream request of its own
//    and stays a pure function of the env bag plus an in-memory snapshot.

import {
  capabilityState,
  isUsable,
  keyRequirementFor,
  missingEnvFor,
  stateWithEvidence,
  KEY_REQUIREMENTS,
  NON_SIGNAL_IDS,
  type CapabilityState,
} from "./keyRequirements";
import { credentialVerdict, type UpstreamEvidence } from "./upstreamEvidence";

/**
 * What this server process has actually seen arriving for a layer.
 *
 * Always present, with explicit nulls, because an ABSENT field reads as "does not
 * apply" while a null reads as "we have no record" — and the difference is the
 * whole point. A null here never means the layer is broken; it means this process
 * has not fetched it since it started.
 */
export interface StatusFlow {
  /** Epoch ms the adapter last completed a server-side fetch. Null = not seen here. */
  lastFetchAt: number | null;
  /** Age of that fetch at report time, in ms. */
  lastFetchAgeMs: number | null;
  /** Did it resolve rather than throw? Null before the first one. */
  ok: boolean | null;
  /** Rows it produced. 0 is a real, honest answer. Null means never observed. */
  rows: number | null;
  /** Adapter fetches completed since this process started. */
  fetches: number;
  /** Epoch ms a credentialed host for this capability last answered 2xx. */
  lastUpstreamOkAt: number | null;
  /** True once this process has seen anything at all for the layer. */
  observed: boolean;
}

/** The observation behind a `refused` state. Present only when state === "refused". */
export interface StatusRefusal {
  /** Epoch ms of the most recent refusal. */
  since: number;
  /** The HTTP status the upstream answered. */
  status: number;
  /** The host that answered it. A hostname — never a URL carrying a credential. */
  host: string;
  /** Refusals seen since this process started. */
  count: number;
  /** What was observed, stated as an observation and not as a diagnosis. */
  observed: string;
}

export interface StatusEntry {
  id: string;
  label: string;
  group: string;
  /** See CapabilityState. `configured` means we hold the credential and have seen
   *  nothing against it; `refused` means an upstream we send it to said 401/402/403. */
  state: CapabilityState;
  /** Env var NAMES we are missing. Never values. Empty unless state === "locked".
   *  Deliberately still empty for `refused` — we DO hold them, and that is the point. */
  missingEnv: string[];
  /** What the visitor loses while this is locked or refused. Absent when nothing is. */
  degrades?: string;
  /** Where to get the credential. Absent when nothing is locked or refused. */
  obtain?: string;
  /** The evidence behind a `refused` state. Absent in every other state. */
  refusal?: StatusRefusal;
  /** What has actually arrived, as opposed to what is configured. */
  flow: StatusFlow;
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
    /** Required credential held, and nothing observed against it. */
    layersConfigured: number;
    /** Required credential held, and an upstream answered 401/402/403 to it. */
    layersRefused: number;
    layersLocked: number;
    /**
     * Layers not blocked by a credential — neither missing nor refused.
     *
     * NOT "layers a visitor can use". A layer can be configured, accepted, and
     * still deliver nothing because there is genuinely nothing to report. What is
     * ARRIVING is the per-layer `flow` block below; this number only says "no
     * credential is standing in the way".
     */
    layersNotKeyBlocked: number;
    /** Layers this process has fetched at least once — the denominator for the rest. */
    layersObserved: number;
    /** Observed layers whose last fetch succeeded and returned at least one row. */
    layersDelivering: number;
    /** Observed layers whose last fetch succeeded and returned zero rows.
     *  Honest and often correct: no cyclones in the quiet season is not a fault. */
    layersEmpty: number;
    /** Observed layers whose last adapter fetch threw. */
    layersFailing: number;
  };
  /** How to read every `flow` block and every null in it. */
  evidence: {
    /** "process" — in-memory, this instance only. */
    scope: "process";
    /** Epoch ms observation began, or null if nothing is instrumented yet. */
    since: number | null;
    note: string;
  };
}

const EVIDENCE_NOTE =
  "Observed, never probed. Every flow figure comes from fetches this server process " +
  "was already making to serve /api/signals/<id>; GET /api/status starts no upstream " +
  "request of its own. Evidence is per-process and in memory, so a redeploy, a cold " +
  "start or a second instance begins from nothing: null means 'not seen by this " +
  "process', never 'did not happen'. A refused state means a host we send that " +
  "credential to answered 401/402/403 — what we saw, not why.";

interface RegistryLike {
  id: string;
  label: string;
  group: string;
  refreshMs?: number;
  attribution?: string;
}

/** Pure: evidence for one id → the published flow block. */
export function flowFor(ev: UpstreamEvidence | undefined, now: number): StatusFlow {
  return {
    lastFetchAt: ev?.lastFetchAt ?? null,
    lastFetchAgeMs: ev?.lastFetchAt != null ? Math.max(0, now - ev.lastFetchAt) : null,
    ok: ev?.lastFetchOk ?? null,
    rows: ev?.lastRows ?? null,
    fetches: ev?.fetches ?? 0,
    lastUpstreamOkAt: ev?.lastUpstreamOkAt ?? null,
    observed:
      ev != null && (ev.fetches > 0 || ev.lastUpstreamOkAt != null || ev.lastRefusalAt != null),
  };
}

/** Pure: the refusal record, worded as an observation rather than a diagnosis. */
function refusalFor(ev: UpstreamEvidence): StatusRefusal | null {
  if (ev.lastRefusalAt == null || ev.lastRefusalStatus == null) return null;
  const host = ev.lastRefusalHost ?? "the upstream";
  const plural = ev.refusals === 1 ? "refusal" : "refusals";
  return {
    since: ev.lastRefusalAt,
    status: ev.lastRefusalStatus,
    host,
    count: ev.refusals,
    observed:
      `${host} answered HTTP ${ev.lastRefusalStatus} to a server-side request carrying ` +
      `this deployment's credential (${ev.refusals} such ${plural} since this process ` +
      `started, and no 2xx from it since). The credential is present; it is not being accepted.`,
  };
}

function entryFor(
  src: RegistryLike,
  env: Record<string, string | undefined>,
  evidence: Record<string, UpstreamEvidence>,
  now: number,
): StatusEntry {
  const ev = evidence[src.id];
  const state = stateWithEvidence(capabilityState(src.id, env), credentialVerdict(ev, now));
  const missingEnv = missingEnvFor(src.id, env);
  const req = keyRequirementFor(src.id);
  const refusal = state === "refused" && ev ? refusalFor(ev) : null;
  return {
    id: src.id,
    label: src.label,
    group: src.group,
    state,
    missingEnv,
    // Shown whenever the credential is absent OR refused — for an enhancement that
    // reads as "this works, a key would make it better", which is the truth we were
    // getting wrong by calling it locked. For a refused layer `degrades` is exactly
    // what the reader needs: the key is set, and this is what you are losing anyway.
    ...((state === "locked" || state === "upgradable" || state === "refused") && req
      ? { degrades: req.degrades, obtain: req.obtain }
      : {}),
    ...(refusal ? { refusal } : {}),
    flow: flowFor(ev, now),
    ...(src.refreshMs != null ? { refreshMs: src.refreshMs } : {}),
    ...(src.attribution ? { attribution: src.attribution } : {}),
  };
}

/** Everything /api/status needs beyond the registry and the env bag. Optional so the
 *  report degrades to configuration-only when nothing has been observed yet. */
export interface StatusReportOptions {
  /** Capability id → what this process has observed. See lib/sources/upstreamEvidence.ts. */
  evidence?: Record<string, UpstreamEvidence>;
  /** Epoch ms observation began. Null when nothing is instrumented. */
  observingSince?: number | null;
}

export function buildStatusReport(
  signals: RegistryLike[],
  env: Record<string, string | undefined>,
  now: number,
  opts: StatusReportOptions = {},
): StatusReport {
  const evidence = opts.evidence ?? {};
  const layers = signals.map((s) => entryFor(s, env, evidence, now));

  // The non-layer capabilities are described entirely by the requirements table,
  // so they are synthesised from it rather than from a registry.
  const capabilities = KEY_REQUIREMENTS.filter((r) => NON_SIGNAL_IDS.has(r.id)).map((r) =>
    entryFor({ id: r.id, label: r.label, group: "Capability" }, env, evidence, now),
  );

  const count = (s: CapabilityState) => layers.filter((l) => l.state === s).length;
  const layersKeyless = count("keyless");
  const layersConfigured = count("configured") + count("enhanced");
  const layersRefused = count("refused");
  const layersLocked = count("locked");
  const observed = layers.filter((l) => l.flow.observed);

  return {
    generatedAt: now,
    layers,
    capabilities,
    summary: {
      layersRegistered: layers.length,
      layersKeyless,
      layersConfigured,
      layersRefused,
      layersLocked,
      layersNotKeyBlocked: layers.filter((l) => isUsable(l.state)).length,
      layersObserved: observed.length,
      layersDelivering: observed.filter((l) => l.flow.ok === true && (l.flow.rows ?? 0) > 0).length,
      layersEmpty: observed.filter((l) => l.flow.ok === true && l.flow.rows === 0).length,
      layersFailing: observed.filter((l) => l.flow.ok === false).length,
    },
    evidence: {
      scope: "process",
      since: opts.observingSince ?? null,
      note: EVIDENCE_NOTE,
    },
  };
}
