// lib/analytics/vercelApi.ts
// Server-side client for Vercel's Web Analytics query API.
//
// DESIGN RULE, and the only one that really matters here: this module never throws
// and never returns a number it did not receive. Every failure — no credentials, a
// plan refusal, a dead network, a response that did not parse — comes back as a
// typed, renderable value carrying the upstream's own words. A dashboard that
// silently degrades a refusal into an empty array is worse than one that shows
// nothing, because an empty array draws a chart, and a chart is read as a fact.
//
// The token is read here and nowhere else, and this file is imported only by server
// components. It must never reach the browser: the values are credentials for the
// whole Vercel team, not for this project alone.

import { MAX_DISTINCT_PER_QUERY } from "@/lib/analytics/limits";

const API_ROOT = "https://api.vercel.com/v1/query/web-analytics";

/** Why we have no data, in the caller's terms. */
export type AnalyticsFailure =
  | {
      kind: "no-credentials";
      /** Which env var NAMES are missing. Never a value. */
      missing: string[];
    }
  | {
      kind: "refused";
      status: number;
      /** The upstream `error.message`, verbatim. Rendered in quotes, never paraphrased. */
      message: string;
    }
  | {
      kind: "unreachable";
      /** Our own description — this one is not an upstream quote and must not be shown as one. */
      detail: string;
    };

export type AnalyticsResult<T> = { ok: true; data: T } | { ok: false; failure: AnalyticsFailure };

/** Env var names this capability needs. Exported so the UI can name them without duplicating strings. */
export const ANALYTICS_ENV = [
  "VERCEL_ANALYTICS_TOKEN",
  "VERCEL_ANALYTICS_PROJECT_ID",
  "VERCEL_ANALYTICS_TEAM_ID",
] as const;

interface Credentials {
  token: string;
  projectId: string;
  teamId: string;
}

/**
 * Read the three variables by NAME, rather than defaulting a parameter to the whole
 * `process.env` bag.
 *
 * Two reasons, and the first one cost a green suite to notice. The env-scan guard in
 * tests/unit/sources-status.test.ts finds credential gates by matching the literal text
 * `process.env.<SOME_NAME>` across lib/ and app/ — so passing the bag around hides a gate
 * from the one test written to catch hidden gates, and the suite stays green while the
 * capability goes unregistered. That is precisely the failure the guard was added for
 * (food-security shipped as "keyless" for a release), reintroduced by an innocent bit of
 * dependency injection.
 *
 * Second, Next statically replaces `process.env.<NAME>` at build time. A dynamic lookup
 * through a bag is not the same thing and is not guaranteed to survive bundling.
 *
 * The injectable parameter stays, because the tests need it. It just no longer defaults
 * to something the guard cannot read.
 */
function processEnvCredentials(): Record<string, string | undefined> {
  return {
    VERCEL_ANALYTICS_TOKEN: process.env.VERCEL_ANALYTICS_TOKEN,
    VERCEL_ANALYTICS_PROJECT_ID: process.env.VERCEL_ANALYTICS_PROJECT_ID,
    VERCEL_ANALYTICS_TEAM_ID: process.env.VERCEL_ANALYTICS_TEAM_ID,
  };
}

/** Present and non-blank, matching how lib/sources/keyRequirements.ts judges a key. */
function readCredentials(env: Record<string, string | undefined>): Credentials | string[] {
  const missing = ANALYTICS_ENV.filter((name) => {
    const v = env[name];
    return !(typeof v === "string" && v.trim().length > 0);
  });
  if (missing.length > 0) return [...missing];
  return {
    token: String(env.VERCEL_ANALYTICS_TOKEN).trim(),
    projectId: String(env.VERCEL_ANALYTICS_PROJECT_ID).trim(),
    teamId: String(env.VERCEL_ANALYTICS_TEAM_ID).trim(),
  };
}

export interface QueryOptions {
  since: Date;
  until: Date;
  /** One or two dimensions. The API rejects three. */
  by?: string[];
  /** OData filter, e.g. route eq '/camera/[id]'. */
  filter?: string;
  /** Distinct values returned before the rest are folded into an "Others" row. */
  limit?: number;
}

/**
 * Build the query URL. Exported for tests: the encoding of `by` is the part most
 * likely to be silently wrong, and a wrong `by` does not error — it returns a
 * differently-shaped result that would render as a plausible chart of nothing.
 */
export function buildQueryUrl(
  path: "visits/count" | "visits/aggregate",
  creds: Pick<Credentials, "projectId" | "teamId">,
  opts: QueryOptions,
): string {
  const url = new URL(`${API_ROOT}/${path}`);
  url.searchParams.set("projectId", creds.projectId);
  url.searchParams.set("teamId", creds.teamId);
  url.searchParams.set("since", opts.since.toISOString());
  url.searchParams.set("until", opts.until.toISOString());
  if (opts.filter) url.searchParams.set("filter", opts.filter);
  if (opts.limit != null) {
    url.searchParams.set("limit", String(Math.min(opts.limit, MAX_DISTINCT_PER_QUERY)));
  }
  // Repeated `by` params, one per dimension, as the documented cURL examples show.
  for (const dim of opts.by ?? []) url.searchParams.append("by", dim);
  return url.toString();
}

/** Pull the upstream's own error text out of whatever shape it arrived in. */
export function extractApiMessage(body: unknown, status: number): string {
  if (body && typeof body === "object") {
    const err = (body as { error?: unknown }).error;
    if (err && typeof err === "object") {
      const msg = (err as { message?: unknown }).message;
      if (typeof msg === "string" && msg.length > 0) return msg;
    }
  }
  return `HTTP ${status} with no error message in the response body.`;
}

async function request<T>(
  path: "visits/count" | "visits/aggregate",
  opts: QueryOptions,
  env: Record<string, string | undefined> = processEnvCredentials(),
): Promise<AnalyticsResult<T>> {
  const creds = readCredentials(env);
  if (Array.isArray(creds)) return { ok: false, failure: { kind: "no-credentials", missing: creds } };

  const url = buildQueryUrl(path, creds, opts);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${creds.token}` },
      cache: "no-store",
    });
  } catch (e) {
    return {
      ok: false,
      failure: { kind: "unreachable", detail: e instanceof Error ? e.message : "fetch failed" },
    };
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    return { ok: false, failure: { kind: "refused", status: res.status, message: extractApiMessage(body, res.status) } };
  }
  const data = (body as { data?: unknown } | null)?.data;
  if (data === undefined) {
    return {
      ok: false,
      failure: { kind: "unreachable", detail: "The response parsed but carried no `data` field." },
    };
  }
  return { ok: true, data: data as T };
}

/** Total visitors and pageviews across a range. Visitors here ARE de-duplicated over the range. */
export interface VisitsCount {
  visitors: number;
  pageviews: number;
}

export function countVisits(
  opts: QueryOptions,
  env?: Record<string, string | undefined>,
): Promise<AnalyticsResult<VisitsCount>> {
  return request<VisitsCount>("visits/count", opts, env);
}

/**
 * One grouped row. The dimension key varies with `by` (route, country, …) and the
 * time-grouped form carries `timestamp` instead, so callers narrow it themselves.
 */
export type AggregateRow = Record<string, string | number> & { visitors: number; pageviews: number };

export function aggregateVisits(
  opts: QueryOptions,
  env?: Record<string, string | undefined>,
): Promise<AnalyticsResult<AggregateRow[]>> {
  return request<AggregateRow[]>("visits/aggregate", opts, env);
}

/**
 * Read a dimension off a grouped row as a display string.
 *
 * Two real values need care and both were observed in live responses on 2026-08-19:
 * an empty string, which is how a direct visit arrives on referrerHostname, and the
 * literal "Others", which is the API's own bucket for everything past `limit` and
 * must not be mistaken for a hostname or a country.
 */
export function dimensionLabel(row: AggregateRow, dimension: string): string {
  const raw = row[dimension];
  if (raw === undefined || raw === null || raw === "") return "(none)";
  return String(raw);
}

/** True when a row is the API's overflow bucket rather than a real value. */
export function isOthersBucket(row: AggregateRow, dimension: string): boolean {
  return row[dimension] === "Others";
}
