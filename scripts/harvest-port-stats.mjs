#!/usr/bin/env node
// Re-harvest lib/signals/ports.stats.data.ts: three official statistics for the
// curated major ports (lib/signals/ports.data.ts), joined by UN/LOCODE.
//
//   UNCTAD Port Liner Shipping Connectivity Index (US.PLSCI), quarterly, CC BY 3.0 IGO.
//     A bulk .7z download; extracted with the `7z` CLI, or `tar` (bsdtar, as Windows
//     ships it) when 7z is absent.
//   Eurostat mar_go_qm, gross weight of goods handled in main ports, quarterly,
//     thousand tonnes. EU ports only. Reuse allowed with acknowledgement.
//   USACE Waterborne Commerce "Principal Ports" via BTS NTAD (geo.dot.gov), annual
//     tonnage in short tons. US ports only. US Government work.
//
//   node scripts/harvest-port-stats.mjs            write the file
//   node scripts/harvest-port-stats.mjs --dry-run  print what it found
//
// A snapshot: the sources update quarterly or yearly, and the PLSCI comes only as a
// 7z archive that no runtime here can open. Writes NOTHING when any source fails.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const UA = "TrafficNerd/2.0 (+github.com/011-sam-110/TrafficNerd-V2)";
const OUT = "lib/signals/ports.stats.data.ts";
const PLSCI_URL = "https://unctadstat-api.unctad.org/bulkdownload/US.PLSCI/US_PLSCI";
const EUROSTAT_URL =
  "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/mar_go_qm?format=JSON&lang=EN&lastTimePeriod=4&direct=TOTAL&tra_cov=TOTAL&unit=THS_T";
const USACE_URL =
  "https://geo.dot.gov/server/rest/services/Hosted/principal_ports_view/FeatureServer/0/query?where=1%3D1&outFields=portname,rank,total&returnGeometry=false&f=json&resultRecordCount=500";

// Where UNCTAD keys a port by a code other than its UN/LOCODE.
const PLSCI_CODE = { USHOU: "USHKA", USORF: "USNFF" };
// USACE names → our LOCODE. Seattle and Tacoma are one pin (the Northwest Seaport
// Alliance) and are summed.
const USACE_PORTS = {
  "Houston Port Authority, TX": "USHOU",
  "New York, NY & NJ": "USNYC",
  "Port of Long Beach, CA": "USLGB",
  "Virginia, VA, Port of": "USORF",
  "Port of Los Angeles, CA": "USLAX",
  "Port of Savannah, GA": "USSAV",
  "Port of Charleston, SC": "USCHS",
  "Tacoma, WA": "USSEA",
  "Seattle, WA": "USSEA",
};

const locodes = [...readFileSync("lib/signals/ports.data.ts", "utf8").matchAll(/locode: "([A-Z]{5})"/g)].map((m) => m[1]);
if (locodes.length < 50) throw new Error(`only ${locodes.length} LOCODEs in ports.data.ts`);

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
}

// --- UNCTAD PLSCI ---------------------------------------------------------------
const dir = mkdtempSync(join(tmpdir(), "plsci-"));
const archive = join(dir, "plsci.7z");
writeFileSync(archive, Buffer.from(await (await get(PLSCI_URL)).arrayBuffer()));
try {
  execFileSync("7z", ["x", "-y", `-o${dir}`, archive], { stdio: "ignore" });
} catch {
  execFileSync("tar", ["-xf", archive, "-C", dir], { stdio: "ignore" });
}
const csvFile = readdirSync(dir).find((f) => f.endsWith(".csv"));
if (!csvFile) throw new Error("no CSV in the PLSCI archive");
const plsciRows = readFileSync(join(dir, csvFile), "utf8").split(/\r?\n/).slice(1);
rmSync(dir, { recursive: true, force: true });
const byQuarter = new Map(); // "CNSHA|2026Q03" → value
let latest = "";
for (const line of plsciRows) {
  const m = /^(\d{4}Q\d{2}),"[^"]*",([A-Z]{5}),"[^"]*",([\d.]+)/.exec(line);
  if (!m) continue;
  byQuarter.set(`${m[2]}|${m[1]}`, Number(m[3]));
  if (m[1] > latest) latest = m[1];
}
const yearAgo = `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`;
const plsci = {};
for (const loc of locodes) {
  const code = PLSCI_CODE[loc] ?? loc;
  const v = byQuarter.get(`${code}|${latest}`);
  if (v == null) continue;
  const prev = byQuarter.get(`${code}|${yearAgo}`);
  plsci[loc] = { value: Math.round(v * 10) / 10, ...(prev != null ? { yearAgo: Math.round(prev * 10) / 10 } : {}) };
}

// --- Eurostat ---------------------------------------------------------------------
const eu = await (await get(EUROSTAT_URL)).json();
// The last four quarters: countries report at different speeds, so each port gets its
// own newest quarter. Every dimension but rep_mar and time is fixed by the query, and
// time is the last one, so a value's flat index is rep_mar index * quarters + time index.
if (eu.id.at(-1) !== "time" || eu.id.at(-2) !== "rep_mar") throw new Error(`unexpected Eurostat dimensions ${eu.id}`);
const times = Object.entries(eu.dimension.time.category.index).sort((a, b) => a[1] - b[1]).map(([t]) => t);
const repIndex = eu.dimension.rep_mar.category.index;
const eurostat = {};
for (const [code, i] of Object.entries(repIndex)) {
  const loc = code.slice(-5);
  if (!locodes.includes(loc)) continue;
  for (let t = times.length - 1; t >= 0; t--) {
    const v = eu.value[String(i * times.length + t)];
    if (v == null) continue;
    eurostat[loc] = { period: times[t], thsTonnes: Math.round(Number(v)) };
    break;
  }
}
const euPeriod = times.at(-1);

// --- USACE ------------------------------------------------------------------------
const usace = {};
for (const f of (await (await get(USACE_URL)).json()).features ?? []) {
  const a = f.attributes ?? {};
  const loc = USACE_PORTS[a.portname];
  if (!loc || !Number.isFinite(a.total)) continue;
  const prev = usace[loc];
  usace[loc] = prev
    ? { shortTons: prev.shortTons + a.total, rank: Math.min(prev.rank, a.rank), parts: [...prev.parts, a.portname] }
    : { shortTons: a.total, rank: a.rank, parts: [a.portname] };
}

const counts = `PLSCI ${Object.keys(plsci).length}, Eurostat ${Object.keys(eurostat).length}, USACE ${Object.keys(usace).length} of ${locodes.length} ports`;
console.log(`PLSCI ${latest}, Eurostat up to ${euPeriod}; ${counts}`);
if (Object.keys(plsci).length < 50 || Object.keys(eurostat).length < 8 || Object.keys(usace).length < 6) {
  console.error("a source matched too few ports; nothing written");
  process.exit(1);
}
if (process.argv.includes("--dry-run")) process.exit(0);

const today = new Date().toISOString().slice(0, 10);
const quarterLabel = (q) => `${q.slice(0, 4)} Q${Number(q.slice(5))}`;
writeFileSync(
  OUT,
  `// GENERATED by scripts/harvest-port-stats.mjs — do not hand-edit. Official statistics
// for the curated ports in ports.data.ts, keyed by UN/LOCODE. Harvested ${today}.
// ${counts}.

export const PORT_STATS_HARVESTED = "${today}";

/** UNCTAD Port Liner Shipping Connectivity Index, ${quarterLabel(latest)} (CC BY 3.0 IGO).
 *  UNCTAD's own scale: "Index (average Q1 2023 = 100)". \`yearAgo\` is ${quarterLabel(yearAgo)}. */
export const PLSCI_QUARTER = "${quarterLabel(latest)}";
export const PLSCI: Readonly<Record<string, { value: number; yearAgo?: number }>> = ${JSON.stringify(plsci, null, 2)};

/** Eurostat mar_go_qm: gross weight of goods handled in each port's newest reported
 *  quarter (up to ${euPeriod}), thousand tonnes, all directions and transport types. */
export const EUROSTAT_THS_T: Readonly<Record<string, { period: string; thsTonnes: number }>> = ${JSON.stringify(eurostat, null, 2)};

/** USACE principal ports (BTS NTAD): total tonnage in short tons and national rank.
 *  The catalog gives calendar year 2023 for this edition. */
export const USACE_YEAR = "2023";
export const USACE_TONNAGE: Readonly<Record<string, { shortTons: number; rank: number; parts: string[] }>> = ${JSON.stringify(usace, null, 2)};
`,
);
console.log(`wrote ${OUT}`);
