// Threat intel / IP reputation. The KEYLESS baseline is Shodan InternetDB
// (`internetdb.shodan.io/<ip>`) — its `tags` + `vulns` (CVE list) are a free
// reputation signal for an IP. Richer, KEYED providers (VirusTotal, AbuseIPDB …)
// are surfaced as 🔒 "needs key" slots and NEVER fabricated. Pure + node-testable
// mappers here (no fetch, no React) so the route stays thin and the widget honest.

import type { TargetKind } from "@/lib/recon/target";

/** Raw Shodan InternetDB response (only the fields we surface). */
export interface InternetDbResponse {
  ip?: string;
  tags?: unknown;
  vulns?: unknown;
}

/** Keyless baseline reputation for a single IP, derived from InternetDB. */
export interface ThreatBaseline {
  ip: string;
  tags: string[];
  /** CVE ids, sorted. */
  vulns: string[];
  /** Any tag or vuln present → worth surfacing. */
  flagged: boolean;
}

/** A documented keyed reputation provider (its fetch is a follow-on). */
export interface ThreatProvider {
  id: string;
  label: string;
  envKey: string;
  supports: TargetKind[];
  /**
   * True only when app/api/recon/threat reads this provider. None does yet. A slot
   * whose key is set but whose provider is not read must NOT show a tick: it would say
   * "configured" over a card that shows none of that provider's data.
   */
  wired: boolean;
}

/**
 * locked  = no key set
 * unwired = a key is set, but nothing reads this provider yet
 * on      = a key is set and the route reads the provider
 */
export type SlotState = "locked" | "unwired" | "on";

/** A provider rendered in the widget — `locked` when its key is absent. */
export interface ProviderSlot {
  id: string;
  label: string;
  envKey: string;
  locked: boolean;
  state: SlotState;
}

/** Top-level result assembled by the route (baseline may be null when dormant). */
export interface ThreatResult {
  ok: boolean;
  ip?: string;
  baseline?: ThreatBaseline;
  providers: ProviderSlot[];
}

/** The keyed providers we document. Each becomes a 🔒 slot until its key is set. */
export const THREAT_PROVIDERS: ThreatProvider[] = [
  { id: "virustotal", label: "VirusTotal", envKey: "VIRUSTOTAL_API_KEY", supports: ["domain", "ip"], wired: false },
  { id: "abuseipdb", label: "AbuseIPDB", envKey: "ABUSEIPDB_API_KEY", supports: ["ip"], wired: false },
  { id: "greynoise", label: "GreyNoise", envKey: "GREYNOISE_API_KEY", supports: ["ip"], wired: false },
  { id: "otx", label: "AlienVault OTX", envKey: "OTX_API_KEY", supports: ["domain", "ip"], wired: false },
  { id: "pulsedive", label: "Pulsedive", envKey: "PULSEDIVE_API_KEY", supports: ["domain", "ip"], wired: false },
  { id: "ipqualityscore", label: "IPQualityScore", envKey: "IPQUALITYSCORE_API_KEY", supports: ["ip"], wired: false },
  { id: "abusech", label: "abuse.ch", envKey: "ABUSECH_API_KEY", supports: ["domain", "ip"], wired: false },
];

/** Pure: keep only non-empty strings, trimmed, from an unknown array. */
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== "string") continue;
    const s = x.trim();
    if (s) out.push(s);
  }
  return out;
}

/** Pure: one InternetDB response → typed baseline. Robust to null/missing arrays. */
export function parseThreatBaseline(json: InternetDbResponse | null | undefined, ip: string): ThreatBaseline {
  const tags = strList(json?.tags);
  const vulns = strList(json?.vulns).sort();
  return { ip, tags, vulns, flagged: tags.length > 0 || vulns.length > 0 };
}

/** Pure: the provider slots for a target kind — `locked` unless its key is in `env`. */
export function providerSlots(kind: TargetKind, env: Record<string, string | undefined>): ProviderSlot[] {
  return THREAT_PROVIDERS.filter((p) => p.supports.includes(kind)).map((p) => {
    const locked = !env[p.envKey];
    const state: SlotState = locked ? "locked" : p.wired ? "on" : "unwired";
    return { id: p.id, label: p.label, envKey: p.envKey, locked, state };
  });
}
