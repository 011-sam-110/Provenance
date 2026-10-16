import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// Tsunami messages — the latest bulletins of NOAA's two Tsunami Warning Centers.
//
//   PTWC (Honolulu)  the Pacific and Caribbean, and Hawaii.
//   NTWC (Palmer)    the US and Canadian coasts (Alaska, West and East Coast).
//
// GDACS lists no tsunamis (its event list does not accept the TS type), so until
// 2026-10-16 the map had no tsunami message at all. That day both centres had issued
// an information statement for the M7.0 off Kamchatka at 03:46 UTC.
//
// Each centre's Atom feed holds its LATEST bulletin: a warning, an advisory, a watch,
// a threat message or an information statement (an earthquake happened and poses no
// tsunami threat, or a warning is in force somewhere else). A bulletin is shown for
// 24 hours after it was issued; a later bulletin (a cancellation, say) replaces it in
// the feed. The point is the earthquake that caused it.
//
// US federal work (NOAA NWS), public domain.

export const TSUNAMI_FEEDS = [
  { centre: "PTWC", url: "https://www.tsunami.gov/events/xml/PHEBAtom.xml" },
  { centre: "NTWC", url: "https://www.tsunami.gov/events/xml/PAAQAtom.xml" },
] as const;
export const TSUNAMI_SHOW_HOURS = 24;
const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";

export const TSUNAMI_ATTRIBUTION = "Tsunami messages © NOAA NWS Tsunami Warning Centers (PTWC, NTWC)";

/** Category → colour, most urgent first. */
const CATEGORY_COLOR: [RegExp, string][] = [
  [/warning/i, "#dc2626"],
  [/advisory/i, "#f97316"],
  [/watch/i, "#facc15"],
  [/threat/i, "#f97316"],
  [/information/i, "#2563eb"],
];

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

/** One labelled value from the bulletin summary ("<strong>Category:</strong> Information<br/>"). */
function summaryField(summary: string, label: string): string | undefined {
  const m = new RegExp(`<strong>\\s*${label}:?\\s*</strong>([\\s\\S]*?)(?:<br\\s*/?>|<strong>|<b>|</div>)`, "i").exec(summary);
  const v = m ? strip(m[1]!) : "";
  return v || undefined;
}

/** Pure: one centre's Atom feed → its bulletins issued in the last 24 hours. */
export function normalizeTsunamiAtom(xml: string, centre: string, now: number): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const chunk of xml.split(/<entry>/).slice(1)) {
    const entry = chunk.split("</entry>")[0] ?? "";
    const lat = Number(/<geo:lat>([^<]+)<\/geo:lat>/.exec(entry)?.[1]);
    const lon = Number(/<geo:long>([^<]+)<\/geo:long>/.exec(entry)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const updated = /<updated>([^<]+)<\/updated>/.exec(entry)?.[1]?.trim();
    const t = updated ? Date.parse(updated) : Number.NaN;
    if (!Number.isFinite(t) || t < now - TSUNAMI_SHOW_HOURS * 3_600_000) continue;
    const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(entry)?.[1] ?? "";
    const category = summaryField(summary, "Category") ?? "Message";
    const region = strip(/<title>([\s\S]*?)<\/title>/.exec(entry)?.[1] ?? "") || summaryField(summary, "Affected Region") || "Unknown region";
    const bulletin = /<link[^>]*rel="alternate"[^>]*href="([^"]+)"/.exec(entry)?.[1];
    const id = /<id>urn:uuid:([^<]+)<\/id>/.exec(entry)?.[1]?.trim() ?? `${centre}:${updated}`;
    const note = (/<b>Note:<\/b>([\s\S]*?)<br/.exec(summary)?.[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({
      id: `tsunami:${centre}:${id}`,
      lat,
      lon,
      title: `Tsunami ${category.toLowerCase()} (${centre}): ${region}`,
      signalId: "tsunami-alerts",
      color: CATEGORY_COLOR.find(([re]) => re.test(category))?.[1] ?? "#64748b",
      link: bulletin ?? "https://www.tsunami.gov/",
      ts: new Date(t).toISOString(),
      props: {
        category,
        centre: centre === "PTWC" ? "Pacific Tsunami Warning Center (PTWC)" : "National Tsunami Warning Center (NTWC)",
        region,
        earthquake: summaryField(summary, "Preliminary Magnitude") ?? "—",
        ...(note ? { note } : {}),
      },
    });
  }
  return out;
}

/** Pure: two centres' reads → the layer. One centre failing keeps the other's bulletins. */
export function tsunamiLayerFrom(
  reads: { centre: string; ok: boolean; rows: SignalFeature[]; reason?: string }[],
  at: number,
): SignalFeature[] {
  const rows = reads.flatMap((r) => r.rows);
  const failed = reads.filter((r) => !r.ok);
  if (failed.length === reads.length) return degraded(failed[0]?.reason ?? "upstream read failed", at);
  if (failed.length) return degradedWith(rows, `partial: ${failed.map((f) => `${f.centre} (${f.reason})`).join(", ")} failed`, at);
  return observed(rows, at);
}

export const TSUNAMI_SOURCE: SignalSource = {
  id: "tsunami-alerts",
  // The epicentre of the earthquake the bulletin is about.
  precision: "exact",
  label: "Tsunami messages (NOAA)",
  group: "Natural hazards",
  color: "#2563eb",
  refreshMs: 5 * 60 * 1000, // a warning is issued minutes after a quake
  attribution: TSUNAMI_ATTRIBUTION,
  async fetch() {
    const at = Date.now();
    const reads = await Promise.all(
      TSUNAMI_FEEDS.map(async ({ centre, url }) => {
        try {
          const res = await fetch(url, {
            headers: { "User-Agent": UA, Accept: "application/atom+xml, application/xml" },
            signal: AbortSignal.timeout(15_000),
          });
          if (!res.ok) return { centre, ok: false, rows: [], reason: `http ${res.status}` };
          return { centre, ok: true, rows: normalizeTsunamiAtom(await res.text(), centre, at) };
        } catch (e) {
          return { centre, ok: false, rows: [], reason: (e as Error)?.name === "TimeoutError" ? "timeout" : "fetch failed" };
        }
      }),
    );
    return tsunamiLayerFrom(reads, at);
  },
};
