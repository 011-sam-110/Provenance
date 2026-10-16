// Severe storms — tropical cyclones from NASA EONET, plus the US storms EONET never
// carried (since 2026-10-16).
//
// EONET's severe-storm category stayed fresh (JTWC and NHC fixes within hours), so it
// stays. But it is tropical cyclones only, and the layer's name promises more
// (sources-audit/eonet.md). Added, all primary and keyless:
//
//   • NOAA SPC storm reports — tornado, wind-damage and hail reports, with places, for
//     the current and previous convective day (12:00 UTC to 11:59 UTC). Public domain.
//   • NWS Tornado and Severe Thunderstorm WARNINGS — the warned polygons.
//   • Copernicus EMS storm activations — impact-grade, mapped events.

import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { CATEGORIES, readEonetLayer } from "@/lib/signals/eonet";
import { fetchNwsAlerts, nwsAlertsToFeatures } from "@/lib/signals/nws";
import { cemsToFeatures, fetchCemsActivations } from "@/lib/signals/copernicus-ems";
import { fromOutcome, getText, readInput, withInputsOutcome } from "@/lib/signals/multiInput";

export const STORM_COLOR = "#6366f1";
/** A storm report older than this is dropped. The SPC files span two convective days. */
export const SPC_WINDOW_MS = 24 * 60 * 60 * 1000;
export const CEMS_STORM_WINDOW_DAYS = 14;

export const SEVERE_STORMS_ATTRIBUTION =
  "Tropical cyclones: NASA EONET (JTWC, NHC); NOAA Storm Prediction Center; NOAA National Weather Service; " +
  "© European Union, Copernicus Emergency Management Service";

export const SPC_TODAY_URL = "https://www.spc.noaa.gov/climo/reports/today.csv";
export const SPC_YESTERDAY_URL = "https://www.spc.noaa.gov/climo/reports/yesterday.csv";

type SpcKind = "tornado" | "wind" | "hail";

const SPC_STYLE: Record<SpcKind, { label: string; color: string }> = {
  tornado: { label: "Tornado report", color: "#b91c1c" },
  wind: { label: "Wind damage report", color: "#7c3aed" },
  hail: { label: "Hail report", color: "#0891b2" },
};

/** The 12:00 UTC that starts the convective day containing `t`. */
export function convectiveDayStart(t: number): number {
  const d = new Date(t - 12 * 60 * 60 * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12);
}

/**
 * Pure: one SPC daily report CSV → features.
 *
 * The file is three CSV blocks, each with its own header row: tornado (`F_Scale`),
 * wind (`Speed`, mph) and hail (`Size`, hundredths of an inch). `Time` is HHMM UTC
 * inside the convective day that starts at `dayStart` (12:00 UTC): a time before 1200
 * belongs to the next calendar day. The comment, the last column, may hold commas.
 */
export function parseSpcReports(csv: string, dayStart: number): SignalFeature[] {
  const out: SignalFeature[] = [];
  let kind: SpcKind | null = null;
  for (const raw of csv.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Time,/i.test(line)) {
      const second = line.split(",")[1]?.trim().toLowerCase();
      kind = second === "f_scale" ? "tornado" : second === "speed" ? "wind" : second === "size" ? "hail" : null;
      continue;
    }
    if (!kind) continue;
    const p = line.split(",");
    if (p.length < 7) continue;
    const [time, value, location, county, state, latS, lonS] = p.map((x) => x.trim());
    const comment = p.slice(7).join(",").trim();
    const lat = Number(latS);
    const lon = Number(lonS);
    if (!latS || !lonS || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const hhmm = /^\d{1,4}$/.test(time) ? time.padStart(4, "0") : null;
    let ts: string | undefined;
    if (hhmm) {
      const h = Number(hhmm.slice(0, 2));
      const m = Number(hhmm.slice(2));
      const dayOffset = h < 12 ? 24 : 0;
      ts = new Date(dayStart - 12 * 3_600_000 + (dayOffset + h) * 3_600_000 + m * 60_000).toISOString();
    }
    const style = SPC_STYLE[kind];
    const measure =
      kind === "hail" && /^\d+$/.test(value)
        ? `${(Number(value) / 100).toFixed(2)} in`
        : kind === "wind" && /^\d+$/.test(value)
          ? `${value} mph`
          : kind === "tornado" && value && value.toUpperCase() !== "UNK"
            ? value
            : null;
    out.push({
      id: `severeStorms:spc:${new Date(dayStart).toISOString().slice(0, 10)}:${kind}:${time}:${lat},${lon}`,
      lat,
      lon,
      title: `${style.label}${measure ? ` (${measure})` : ""} — ${location}, ${state}`,
      signalId: "severeStorms",
      color: style.color,
      ts,
      props: {
        source: "NOAA SPC storm reports",
        report: kind,
        ...(measure ? { measured: measure } : {}),
        county: county || "—",
        state: state || "—",
        remarks: comment || "—",
      },
    });
  }
  return out;
}

async function readSpc(now: number): Promise<SignalFeature[]> {
  const today = convectiveDayStart(now);
  const [a, b] = await Promise.all([getText(SPC_TODAY_URL, 20_000), getText(SPC_YESTERDAY_URL, 20_000)]);
  return [...parseSpcReports(a, today), ...parseSpcReports(b, today - 24 * 3_600_000)].filter((f) => {
    const t = f.ts ? Date.parse(f.ts) : Number.NaN;
    return !Number.isFinite(t) || now - t <= SPC_WINDOW_MS;
  });
}

export const SEVERE_STORMS_SOURCE: SignalSource = {
  id: "severeStorms",
  precision: "exact",
  label: "Severe storms",
  group: "Natural hazards",
  color: STORM_COLOR,
  // Wind in knots from EONET's cyclone fixes. SPC and NWS rows carry no windKt and
  // render as a plain dot, which is honest: their scales differ.
  metric: CATEGORIES.severeStorms.metric,
  refreshMs: 10 * 60 * 1000,
  attribution: SEVERE_STORMS_ATTRIBUTION,
  async fetch() {
    const now = Date.now();
    const [eonet, spc, nws, cems] = await Promise.all([
      readEonetLayer(CATEGORIES.severeStorms).then((f) => fromOutcome("NASA EONET", f)),
      readInput("storms:spc", "NOAA SPC", () => readSpc(now), now),
      readInput("storms:nws", "NWS warnings", async () => nwsAlertsToFeatures(await fetchNwsAlerts(now), "severeStorms"), now),
      readInput("storms:cems", "Copernicus EMS", async () =>
        cemsToFeatures(await fetchCemsActivations(now), {
          category: "Storm",
          signalId: "severeStorms",
          color: STORM_COLOR,
          maxAgeDays: CEMS_STORM_WINDOW_DAYS,
          now,
        }),
      now),
    ]);
    const features = [...eonet.features, ...spc.features, ...nws.features, ...cems.features];
    return withInputsOutcome([eonet, spc, nws, cems], features, now);
  },
};
