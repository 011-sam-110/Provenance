import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// Volcano alert levels — every volcano an observatory has raised above normal.
//
//   USGS (HANS)  the US observatories (Alaska, Cascades, Hawaii, Yellowstone,
//                California): every volcano above NORMAL, with its ground-hazard alert
//                level (ADVISORY, WATCH, WARNING) and its aviation colour code.
//                US federal work, public domain.
//   JMA          the Japan Meteorological Agency's eruption warnings in force, with
//                the Volcanic Alert Level (1 to 5) or, for a volcano without levels,
//                the warning itself. JMA Public Data License 1.0 (CC BY 4.0
//                compatible); credit "Source: Japan Meteorological Agency".
//
// WHY. GDACS's volcano list was empty on 2026-10-16 (every 2026 volcano event closed),
// and NASA EONET's volcano layer lists eruption EVENTS. An official alert level is a
// different statement: what the observatory tells people near the volcano to do. So
// it is its own layer. That day: 4 USGS volcanoes (Great Sitkin ORANGE / WATCH among
// them) and 12 JMA warnings above Level 1.
//
// The point is the volcano's summit from the observatory's own catalogue (HANS
// getVolcano, JMA volcano_list.json), a named fixed site, so precision is "facility".
// Those coordinates never move, so they are cached for the life of the process.

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const HANS_ELEVATED = "https://volcanoes.usgs.gov/hans-public/api/volcano/getElevatedVolcanoes";
const HANS_VOLCANO = "https://volcanoes.usgs.gov/hans-public/api/volcano/getVolcano/";
const JMA_WARNINGS = "https://www.jma.go.jp/bosai/volcano/data/warning.json";
const JMA_VOLCANOES = "https://www.jma.go.jp/bosai/volcano/const/volcano_list.json";

export const VOLCANO_ALERTS_ATTRIBUTION =
  "Volcano alert levels: USGS Volcano Hazards Program (HANS); Source: Japan Meteorological Agency";

// --- USGS HANS ------------------------------------------------------------------------

interface HansElevated {
  volcano_name?: string;
  vnum?: string;
  obs_abbr?: string;
  obs_fullname?: string;
  sent_utc?: string;
  color_code?: string;
  alert_level?: string;
  notice_url?: string;
}

const HANS_LEVEL_COLOR: Record<string, string> = { ADVISORY: "#facc15", WATCH: "#f97316", WARNING: "#dc2626" };

/** Pure: the elevated list + the coordinates of each volcano (by vnum) → features. */
export function normalizeHans(list: HansElevated[], coords: ReadonlyMap<string, { lat: number; lon: number }>): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const v of Array.isArray(list) ? list : []) {
    const vnum = (v.vnum ?? "").trim();
    const at = coords.get(vnum);
    if (!vnum || !at) continue;
    const level = (v.alert_level ?? "").toUpperCase();
    if (!level || level === "NORMAL") continue;
    const sent = v.sent_utc ? Date.parse(`${v.sent_utc.replace(" ", "T")}Z`) : Number.NaN;
    const name = (v.volcano_name ?? vnum).trim();
    out.push({
      id: `volcano:usgs:${vnum}`,
      ...at,
      title: `${name} — ${level} / ${(v.color_code ?? "").toUpperCase() || "—"}`,
      signalId: "volcano-alerts",
      color: HANS_LEVEL_COLOR[level] ?? "#64748b",
      link: v.notice_url ?? "https://www.usgs.gov/programs/VHP",
      ts: Number.isFinite(sent) ? new Date(sent).toISOString() : undefined,
      props: {
        volcano: name,
        "alert level": `${level} (USGS ground-hazard scale)`,
        "aviation colour": (v.color_code ?? "—").toUpperCase(),
        observatory: v.obs_fullname ?? (v.obs_abbr ?? "").toUpperCase(),
        agency: "USGS",
      },
    });
  }
  return out;
}

/** Pure: HANS getVolcano → the summit, or null. */
export function hansCoords(v: { latitude?: number; longitude?: number } | null): { lat: number; lon: number } | null {
  const lat = Number(v?.latitude);
  const lon = Number(v?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}

// --- JMA --------------------------------------------------------------------------------

interface JmaVolcanoWarning {
  reportDatetime?: string;
  eventId?: string;
  volcanoInfos?: { type?: string; items?: { name?: string; code?: string; condition?: string }[] }[];
}
interface JmaVolcano {
  code?: string;
  latlon?: [string, string];
  name_en?: string;
}

/**
 * JMA's warning words → English. The Volcanic Alert Levels are JMA's own five; a
 * volcano without levels gets a warning by area instead. Unknown wording is kept in
 * Japanese rather than guessed at.
 */
const JMA_WORDS: [RegExp, string, string][] = [
  [/レベル５|レベル5/, "Level 5: evacuate", "#7f1d1d"],
  [/レベル４|レベル4/, "Level 4: the elderly and others evacuate", "#dc2626"],
  [/レベル３|レベル3/, "Level 3: do not approach the volcano", "#f97316"],
  [/レベル２|レベル2/, "Level 2: do not approach the crater", "#facc15"],
  [/居住地域/, "Danger to residential areas (no alert levels at this volcano)", "#dc2626"],
  [/入山危険/, "Danger on the volcano (no alert levels at this volcano)", "#f97316"],
  [/火口周辺危険/, "Danger near the crater (no alert levels at this volcano)", "#facc15"],
  [/周辺海域警戒/, "Warning for the surrounding sea (submarine volcano)", "#facc15"],
];

/** Level 1 and "be aware it is an active volcano": normal, not an alert. */
const JMA_NORMAL = /レベル１|レベル1|活火山であることに留意/;

const JMA_CONDITION: Record<string, string> = { 継続: "continued", 引上げ: "raised", 引下げ: "lowered", 切替: "changed", 発表: "issued" };

/** Pure: warning.json + volcano_list.json → every JMA warning above normal. */
export function normalizeJmaVolcano(warnings: JmaVolcanoWarning[], volcanoes: JmaVolcano[]): SignalFeature[] {
  const byCode = new Map((Array.isArray(volcanoes) ? volcanoes : []).map((v) => [String(v.code ?? ""), v]));
  const out: SignalFeature[] = [];
  for (const w of Array.isArray(warnings) ? warnings : []) {
    const code = String(w.eventId ?? "").trim();
    const v = byCode.get(code);
    const lat = Number(v?.latlon?.[0]);
    const lon = Number(v?.latlon?.[1]);
    if (!v || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const info = (w.volcanoInfos ?? []).find((i) => (i.type ?? "").includes("対象火山"));
    const item = info?.items?.[0];
    const word = (item?.name ?? "").trim();
    if (!word || JMA_NORMAL.test(word)) continue;
    const known = JMA_WORDS.find(([re]) => re.test(word));
    const name = (v.name_en ?? code).trim();
    const t = Date.parse(w.reportDatetime ?? "");
    out.push({
      id: `volcano:jma:${code}`,
      lat,
      lon,
      title: `${name} — ${known ? known[1] : word}`,
      signalId: "volcano-alerts",
      color: known?.[2] ?? "#facc15",
      link: "https://www.jma.go.jp/bosai/map.html#contents=volcano&lang=en",
      ts: Number.isFinite(t) ? new Date(t).toISOString() : undefined,
      props: {
        volcano: name,
        "alert level": known ? known[1] : word,
        "JMA wording": word,
        change: JMA_CONDITION[item?.condition ?? ""] ?? (item?.condition || "—"),
        agency: "JMA",
      },
    });
  }
  return out;
}

// --- fetching ---------------------------------------------------------------------------

const COORDS = new Map<string, { lat: number; lon: number }>();
let jmaVolcanoes: JmaVolcano[] | null = null;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

const why = (e: unknown) =>
  (e as Error)?.name === "TimeoutError" ? "timeout" : /^http \d+$/.test((e as Error)?.message ?? "") ? (e as Error).message : "fetch failed";

async function readHans(): Promise<{ ok: boolean; rows: SignalFeature[]; reason?: string }> {
  try {
    const list = (await getJson(HANS_ELEVATED)) as HansElevated[];
    for (const v of Array.isArray(list) ? list.slice(0, 40) : []) {
      const vnum = (v.vnum ?? "").trim();
      if (!vnum || COORDS.has(vnum) || !/^\d+$/.test(vnum)) continue;
      const c = hansCoords((await getJson(HANS_VOLCANO + vnum).catch(() => null)) as never);
      if (c) COORDS.set(vnum, c);
    }
    return { ok: true, rows: normalizeHans(list, COORDS) };
  } catch (e) {
    return { ok: false, rows: [], reason: why(e) };
  }
}

async function readJma(): Promise<{ ok: boolean; rows: SignalFeature[]; reason?: string }> {
  try {
    const [warnings, list] = await Promise.all([
      getJson(JMA_WARNINGS) as Promise<JmaVolcanoWarning[]>,
      jmaVolcanoes ? Promise.resolve(jmaVolcanoes) : (getJson(JMA_VOLCANOES) as Promise<JmaVolcano[]>),
    ]);
    if (Array.isArray(list) && list.length) jmaVolcanoes = list;
    return { ok: true, rows: normalizeJmaVolcano(warnings, list) };
  } catch (e) {
    return { ok: false, rows: [], reason: why(e) };
  }
}

/** Pure: the two agencies' reads → the layer. One failing keeps the other's alerts. */
export function volcanoLayerFrom(
  reads: { agency: string; ok: boolean; rows: SignalFeature[]; reason?: string }[],
  at: number,
): SignalFeature[] {
  const rows = reads.flatMap((r) => r.rows);
  const failed = reads.filter((r) => !r.ok);
  if (failed.length === reads.length) return degraded(failed[0]?.reason ?? "upstream read failed", at);
  if (failed.length) return degradedWith(rows, `partial: ${failed.map((f) => `${f.agency} (${f.reason})`).join(", ")} failed`, at);
  return observed(rows, at);
}

export const VOLCANO_ALERTS_SOURCE: SignalSource = {
  id: "volcano-alerts",
  // A volcano's summit from the observatory's catalogue: a named, fixed site.
  precision: "facility",
  label: "Volcano alert levels (USGS, JMA)",
  group: "Natural hazards",
  color: "#b91c1c",
  refreshMs: 30 * 60 * 1000,
  attribution: VOLCANO_ALERTS_ATTRIBUTION,
  async fetch() {
    const at = Date.now();
    const [usgs, jma] = await Promise.all([readHans(), readJma()]);
    return volcanoLayerFrom([{ agency: "USGS", ...usgs }, { agency: "JMA", ...jma }], at);
  },
};
