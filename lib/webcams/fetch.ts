import type { Webcam } from "@/lib/types";
import {
  WINDY_REGIONS,
  planPageJobs,
  type WindyListResponse,
  type WindyWebcam,
} from "@/lib/sources/windy";
import { toWebcams, MAX_WEBCAMS, type WebcamMapping } from "@/lib/webcams/normalize";
import { coverageCountLabel, type SignalCoverage } from "@/lib/signals/coverage";

// Network fan-out for the Windy webcams layer.
//
// Live-verified 2026-08-10 against api.windy.com:
//   GET /webcams/api/v3/webcams?bbox={N},{E},{S},{W}&limit=50&offset=0
//       &include=images,location,urls,categories&lang=en
//   header  x-windy-api-key: <key>          → 200, {"total":1417,"webcams":[…]}
// 28 page requests (14 regions × 2 pages) returned 200 and 1,300 rows.
//
// This module owns the network only; the upstream→domain mapping lives in a pure
// function in ./normalize.ts (unit-tested) so one bad row can never empty the
// layer. Dormant-safe: no key, a rejected key, or a dead upstream all resolve to
// an empty sample with an honest note — never a throw, never a 5xx, never
// invented webcams.

const BASE = "https://api.windy.com/webcams/api/v3/webcams";
const INCLUDE = "images,location,urls,categories";
const LIMIT = 50; // free-tier hard cap
const PAGES_PER_REGION = 2; // 2 × 50 = up to 100 webcams/region (offset 0, 50)
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

export interface WebcamSample {
  webcams: Webcam[];
  /** True only when no API key is configured — the layer is legitimately switched off. */
  dormant: boolean;
  pagesOk: number;
  pagesFailed: number;
  /** Distinct upstream HTTP statuses seen on failed pages (e.g. [401] = key rejected). */
  statuses: number[];
  mapping: WebcamMapping | null;
  /**
   * Truncation-honesty record (lib/signals/coverage.ts), lifted from `mapping` so
   * the API route can publish it without reaching into WebcamMapping directly.
   * Undefined only when `mapping` is null — dormant, or every region request
   * failed before toWebcams() ever ran — matching the repo-wide rule that a
   * missing record means "not declared", never "nothing was truncated".
   */
  coverage?: SignalCoverage;
}

/**
 * Pure: a sample → one honest sentence for the API response and the UI. Says
 * what actually happened, including the failure cases, and never claims data we
 * do not have.
 */
export function describeWebcamSample(sample: WebcamSample): string {
  if (sample.dormant) {
    return "Webcams are dormant: WINDY_WEBCAMS_API_KEY is not configured on this deployment.";
  }
  if (sample.webcams.length === 0) {
    if (sample.statuses.includes(401) || sample.statuses.includes(403)) {
      return `Windy rejected the configured API key (HTTP ${sample.statuses.join(", ")}) on all ${sample.pagesFailed} requests, so no webcams could be loaded.`;
    }
    if (sample.pagesFailed > 0) {
      const detail = sample.statuses.length ? ` (HTTP ${sample.statuses.join(", ")})` : " (network error)";
      return `All ${sample.pagesFailed} Windy requests failed${detail}, so no webcams could be loaded.`;
    }
    return "Windy returned no webcams for any region.";
  }
  // coverageCountLabel prints the bare count when the pool never reached
  // MAX_WEBCAMS, and "2,000 of N" when it did — so this sentence tells the same
  // truth the /api/webcams `coverage` field does, not a bare ceiling.
  const countLabel = coverageCountLabel(sample.coverage, sample.webcams.length);
  const parts = [`${countLabel} webcams from ${sample.pagesOk}/${sample.pagesOk + sample.pagesFailed} Windy region requests`];
  const m = sample.mapping;
  if (m && m.invalid > 0) parts.push(`${m.invalid} malformed upstream row${m.invalid === 1 ? "" : "s"} dropped`);
  if (m && m.repaired > 0) parts.push(`${m.repaired} link${m.repaired === 1 ? "" : "s"} repaired`);
  if (sample.pagesFailed > 0) parts.push(`${sample.pagesFailed} region request${sample.pagesFailed === 1 ? "" : "s"} failed`);
  return `${parts.join("; ")}.`;
}

/** Tiny bounded-concurrency map — no deps; runs `fn` over items, `limit` at a time. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

interface PageResult {
  rows: WindyWebcam[];
  ok: boolean;
  status?: number;
}

async function fetchPage(apiKey: string, bbox: [number, number, number, number], offset: number): Promise<PageResult> {
  const url = `${BASE}?bbox=${bbox.join(",")}&limit=${LIMIT}&offset=${offset}&include=${INCLUDE}&lang=en`;
  try {
    const res = await fetch(url, {
      headers: {
        "x-windy-api-key": apiKey,
        Accept: "application/json",
        "User-Agent": "TrafficNerd/2.0 (+https://github.com/011-sam-110/TrafficNerd-V2)",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { rows: [], ok: false, status: res.status };
    const json = (await res.json()) as WindyListResponse;
    return { rows: json?.webcams ?? [], ok: true };
  } catch {
    return { rows: [], ok: false };
  }
}

/**
 * Fetch a global sample of webcams by fanning small bbox queries across world
 * regions (73k webcams cannot be listed, and offset is free-tier-capped at
 * 1000). Never throws.
 */
export async function fetchWebcamSample(
  apiKey: string | undefined = process.env.WINDY_WEBCAMS_API_KEY,
): Promise<WebcamSample> {
  const key = (apiKey ?? "").trim();
  if (!key) {
    return { webcams: [], dormant: true, pagesOk: 0, pagesFailed: 0, statuses: [], mapping: null };
  }

  // Shared with lib/sources/windy.ts's fan-out so a region's `pages` override
  // cannot be honoured on one path and ignored on the other — this is the path
  // /api/webcams actually runs.
  const jobs = planPageJobs(WINDY_REGIONS, PAGES_PER_REGION, LIMIT);

  const pages = await mapPool(jobs, CONCURRENCY, (job) => fetchPage(key, job.bbox, job.offset));

  const rows: WindyWebcam[] = [];
  const statuses = new Set<number>();
  let pagesOk = 0;
  let pagesFailed = 0;
  for (const page of pages) {
    if (page.ok) {
      pagesOk++;
      rows.push(...page.rows);
    } else {
      pagesFailed++;
      if (page.status !== undefined) statuses.add(page.status);
    }
  }

  const mapping = toWebcams(rows, MAX_WEBCAMS);
  return {
    webcams: mapping.webcams,
    dormant: false,
    pagesOk,
    pagesFailed,
    statuses: [...statuses].sort((a, b) => a - b),
    mapping,
    coverage: mapping.coverage,
  };
}
