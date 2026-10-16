// Pure: build the Armed Conflict view. Prefer ACLED (rich: event type, country,
// fatalities) when it has data; fall back to keyless GDELT conflict coverage
// (news clusters by article volume) when ACLED is dormant. The widget labels
// honestly which source is live.

import type { SignalFeature } from "@/lib/signals/types";

export type ConflictMode = "acled" | "ucdp" | "gdelt" | "none";

export interface ConflictRow {
  id: string;
  title: string;
  sub: string;
  metricLabel: string;
  metric: number;
  lat: number;
  lon: number;
  feature: SignalFeature;
}

export interface ConflictView {
  mode: ConflictMode;
  sourceLabel: string;
  rows: ConflictRow[];
}

export function conflictView(
  acled: SignalFeature[],
  gdelt: SignalFeature[],
  cap = 12,
): ConflictView {
  if (acled.length > 0) {
    const rows = acled
      .slice()
      .sort((a, b) => Number(b.props?.fatalities ?? 0) - Number(a.props?.fatalities ?? 0))
      .slice(0, cap)
      .map((f) => ({
        id: f.id,
        title: String(f.props?.eventType ?? f.title),
        sub: String(f.props?.country ?? ""),
        metricLabel: "fatalities",
        metric: Number(f.props?.fatalities ?? 0),
        lat: f.lat,
        lon: f.lon,
        feature: f,
      }));
    return { mode: "acled", sourceLabel: "ACLED", rows };
  }
  // Since 2026-10-16 the conflict layer is UCDP's verified events plus warnings. The
  // widget lists the deadliest UCDP events; alerts and advice have no death count to rank.
  const ucdp = gdelt.filter((f) => f.props?.source === "UCDP");
  if (ucdp.length > 0) {
    const rows = ucdp
      .slice()
      .sort((a, b) => Number(b.props?.deaths ?? 0) - Number(a.props?.deaths ?? 0))
      .slice(0, cap)
      .map((f) => ({
        id: f.id,
        title: String(f.props?.sides ?? f.title),
        sub: [f.props?.country, f.props?.date].filter(Boolean).join(" · "),
        metricLabel: "fatalities",
        metric: Number(f.props?.deaths ?? 0),
        lat: f.lat,
        lon: f.lon,
        feature: f,
      }));
    return { mode: "ucdp", sourceLabel: "UCDP · verified events", rows };
  }
  if (gdelt.some((f) => f.props?.articles != null)) {
    // `sub` shows what GDELT coded, ATTRIBUTED. It used to show props.window —
    // a flat "last 4h" that described our ingest, not the event, and defaulted to
    // an even wronger "last 24h" when absent.
    const rows = gdelt.slice(0, cap).map((f) => ({
      id: f.id,
      title: String(f.props?.place ?? f.title),
      sub: f.props?.codedAs ? `GDELT coded: ${f.props.codedAs}` : String(f.props?.timing ?? ""),
      metricLabel: "articles",
      metric: Number(f.props?.articles ?? 0),
      lat: f.lat,
      lon: f.lon,
      feature: f,
    }));
    return { mode: "gdelt", sourceLabel: "GDELT · news coverage", rows };
  }
  return { mode: "none", sourceLabel: "", rows: [] };
}
