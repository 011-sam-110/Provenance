import {
  buildBriefPrompt,
  composeHeuristicBrief,
  parseBriefResponse,
  type BriefPayload,
  type BriefSnapshot,
} from "@/lib/brief";
import { INSTABILITY_SOURCE, FACTOR_WEIGHTS, type FactorKey } from "@/lib/signals/instability";

export const dynamic = "force-dynamic";

// GET /api/brief — a daily world brief grounded ONLY in the live Country
// Instability Index.
//
// KEYLESS BY DEFAULT. The brief is computed in pure code from the index we
// already serve (generatedBy: 'heuristic'). If FREELLMAPI_BASE_URL +
// FREELLMAPI_KEY are set, a model writes it up instead (generatedBy: 'model'),
// and a failed model call falls back to the heuristic rather than to nothing.
//
// `brief: null` is only ever returned together with `dormant: true` and a
// human-readable `reason`. The old {brief:null, dormant:false} state — claiming
// to be live while delivering nothing — is gone.

const GOOD_TTL_MS = 30 * 60 * 1000;
const EMPTY_TTL_MS = 5 * 60 * 1000; // retry a dormant/failed brief sooner

let cache: { payload: BriefPayload; at: number } | null = null;

// Mirrors FACTOR_LABEL in lib/signals/instability.ts (not exported there). Typed
// as Record<FactorKey, string>, so adding a factor breaks the build here rather
// than silently dropping it out of the coverage note.
const FACTOR_LABELS: Record<FactorKey, string> = {
  conflict: "armed conflict",
  food: "food insecurity",
  displacement: "displacement",
  outages: "internet outages",
};
const ALL_FACTOR_LABELS = (Object.keys(FACTOR_WEIGHTS) as FactorKey[]).map((k) => FACTOR_LABELS[k]);

/** How many ranked countries the brief reasons over. */
const RANKED_WINDOW = 10;

interface SnapshotResult {
  snapshot: BriefSnapshot;
  /** True when the index itself could not be read (as opposed to reading empty). */
  unreachable: boolean;
}

async function buildSnapshot(): Promise<SnapshotResult> {
  const dateIso = new Date().toISOString().slice(0, 10);
  let feats;
  try {
    feats = await INSTABILITY_SOURCE.fetch(); // already ranked, densest first
  } catch {
    return { snapshot: { topInstability: [], totalRanked: 0, dateIso }, unreachable: true };
  }

  const ranked = feats
    .map((f) => ({
      country: String(f.props?.country ?? f.title ?? "").trim(),
      score: Number(f.props?.score ?? 0),
      // instability.ts joins drivers with " › ", strongest first.
      drivers: String(f.props?.drivers ?? "")
        .split("›")
        .map((s) => s.trim())
        .filter(Boolean),
    }))
    .filter((c) => c.country !== "" && Number.isFinite(c.score));

  const present = new Set<string>();
  for (const c of ranked) for (const d of c.drivers) present.add(d);
  const factorsMissing = ALL_FACTOR_LABELS.filter((label) => !present.has(label));

  return {
    snapshot: {
      topInstability: ranked.slice(0, RANKED_WINDOW),
      totalRanked: ranked.length,
      factorsMissing: ranked.length > 0 ? factorsMissing : [],
      dateIso,
    },
    unreachable: false,
  };
}

async function tryModel(snapshot: BriefSnapshot): Promise<string | null> {
  const base = (process.env.FREELLMAPI_BASE_URL ?? "").trim().replace(/\/$/, "");
  const key = (process.env.FREELLMAPI_KEY ?? "").trim();
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "auto",
        messages: [{ role: "user", content: buildBriefPrompt(snapshot) }],
        temperature: 0.3,
        max_tokens: 220,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    return parseBriefResponse(await res.json());
  } catch {
    return null;
  }
}

async function build(): Promise<BriefPayload> {
  const generatedAt = Date.now();
  const { snapshot, unreachable } = await buildSnapshot();

  if (snapshot.topInstability.length === 0) {
    return {
      brief: null,
      dormant: true,
      generatedAt,
      reason: unreachable
        ? "The Country Instability Index could not be reached, so there is no data to summarise. This is an upstream outage, not a configuration problem."
        : "The Country Instability Index returned no countries above its reporting floor, so there is nothing to summarise today.",
    };
  }

  const modelBrief = await tryModel(snapshot);
  if (modelBrief) {
    return { brief: modelBrief, dormant: false, generatedAt, generatedBy: "model" };
  }

  const heuristic = composeHeuristicBrief(snapshot);
  if (heuristic) {
    return { brief: heuristic, dormant: false, generatedAt, generatedBy: "heuristic" };
  }

  return {
    brief: null,
    dormant: true,
    generatedAt,
    reason: "The Country Instability Index returned no usable country scores, so there is nothing to summarise today.",
  };
}

export async function GET() {
  if (cache) {
    const ttl = cache.payload.brief ? GOOD_TTL_MS : EMPTY_TTL_MS;
    if (Date.now() - cache.at < ttl) return Response.json(cache.payload);
  }
  const payload = await build();
  cache = { payload, at: Date.now() };
  return Response.json(payload);
}
