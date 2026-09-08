/**
 * Phase A of the GDELT geocoding-error audit: turn recorded windows into a labelling
 * worksheet, and score candidate discriminators against it once it is labelled.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-audit.mts extract
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-audit.mts score
 *
 * REPLAY ONLY. This script never touches the network. Windows come from
 * `.gdelt-cache/`, written by scripts/gdelt-record.mts, and a missing recording is a
 * thrown error — never a silent fall-through to a live fetch. Two people must be able
 * to disagree about a row and settle it by reading the same bytes.
 *
 * WHAT A CANDIDATE IS. Not every row in the export: the rows a reader actually sees.
 * That means `selectLayerEvents` with the production constants, per layer, so the audit
 * measures the shipped population rather than a hypothetical one. Rows killed by
 * MIN_TYPED_ACTOR are already gone before this script looks — the 37% untyped-actor
 * problem is solved and is not what this audit is about.
 *
 * COUNTING GRANULARITY, stated because the baseline store counts differently and the
 * two halves would otherwise disagree silently. This counts PER 15-MINUTE SLOT,
 * deduping within the slot exactly as selectLayerEvents does. The baseline buckets per
 * UTC HOUR. A row appearing in two slots of one hour is TWO candidates here and ONE
 * count there. Neither is wrong; they answer different questions. Do not compare totals.
 *
 * THE EXTRA COLUMNS. GdeltEvent deliberately does not carry Actor1Geo/Actor2Geo — the
 * production adapter has no use for them. The strongest hypothesis about wrong pins is
 * about exactly those columns, so this script re-parses the raw row for them rather
 * than widening the shared type before anything is measured.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  parseGdeltExport, selectLayerEvents, GDELT_LAYERS, geoPrecision,
} from "@/lib/signals/gdelt";

const CACHE = ".gdelt-cache";
const MANIFEST = join(CACHE, "manifest.json");
const OUT_DIR = join("data", "gdelt-locality");
const CANDIDATES = join(OUT_DIR, "candidates.json");
const LABELS = join(OUT_DIR, "labels.json");

/** Actor geography columns the production adapter does not parse. 0-based, GDELT 2.0. */
const C_A1_GEO_TYPE = 35, C_A1_GEO_NAME = 36, C_A1_GEO_COUNTRY = 37;
const C_A2_GEO_TYPE = 43, C_A2_GEO_NAME = 44, C_A2_GEO_COUNTRY = 45;
const C_A1_NAME = 6, C_A1_COUNTRY = 7, C_A2_NAME = 16, C_A2_COUNTRY = 17;
const C_ID = 0;

/** The columns above, keyed by GlobalEventID, for rows that survived selection. */
interface ActorGeo {
  a1Name: string; a1Country: string; a1GeoType: string; a1GeoName: string; a1GeoCountry: string;
  a2Name: string; a2Country: string; a2GeoType: string; a2GeoName: string; a2GeoCountry: string;
}

/** One row awaiting a human verdict. `label` is filled in by reading the source URL. */
interface Candidate extends ActorGeo {
  stamp: string;
  layer: string;
  id: string;
  eventCode: string;
  rootCode: string;
  quadClass: string;
  place: string;
  actionCountry: string;
  geoType: string;
  precision: string;
  lat: number;
  lon: number;
  numArticles: number;
  numSources: number;
  avgTone: number;
  eventDate?: string;
  ts?: string;
  sourceUrl: string;
  domain: string;
  /** Filled during labelling: good | wrong-place | wrong-event | not-an-event | unreachable */
  label?: string;
  note?: string;
}

const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

function readManifest(): Record<string, { file: string; rows: number }> {
  if (!existsSync(MANIFEST)) {
    throw new Error(
      `No recordings at ${MANIFEST}. This script is replay-only by design.\n` +
      `Record first:  node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-record.mts --latest=4`,
    );
  }
  return JSON.parse(readFileSync(MANIFEST, "utf8"));
}

function actorGeoById(tsv: string): Map<string, ActorGeo> {
  const out = new Map<string, ActorGeo>();
  for (const rawLine of tsv.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < 61) continue;
    const t = (i: number) => (c[i] ?? "").trim();
    out.set(t(C_ID), {
      a1Name: t(C_A1_NAME), a1Country: t(C_A1_COUNTRY),
      a1GeoType: t(C_A1_GEO_TYPE), a1GeoName: t(C_A1_GEO_NAME), a1GeoCountry: t(C_A1_GEO_COUNTRY),
      a2Name: t(C_A2_NAME), a2Country: t(C_A2_COUNTRY),
      a2GeoType: t(C_A2_GEO_TYPE), a2GeoName: t(C_A2_GEO_NAME), a2GeoCountry: t(C_A2_GEO_COUNTRY),
    });
  }
  return out;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function extract() {
  const manifest = readManifest();
  const stamps = Object.keys(manifest).sort();
  if (!stamps.length) throw new Error(`${MANIFEST} is empty — record some windows first.`);

  const candidates: Candidate[] = [];
  for (const stamp of stamps) {
    const file = manifest[stamp].file;
    if (!existsSync(file)) {
      throw new Error(`Manifest lists ${stamp} but ${file} is missing. Re-record it; do not skip it.`);
    }
    const tsv = readFileSync(file, "utf8");
    const events = parseGdeltExport(tsv);
    const geo = actorGeoById(tsv);

    for (const [layer, meta] of Object.entries(GDELT_LAYERS)) {
      for (const e of selectLayerEvents(events, meta)) {
        const g = geo.get(e.id);
        candidates.push({
          stamp, layer,
          id: e.id,
          eventCode: e.eventCode,
          rootCode: e.rootCode,
          quadClass: e.quadClass,
          place: e.place,
          actionCountry: e.countryCode,
          geoType: e.geoType,
          precision: geoPrecision(e.geoType),
          lat: e.lat, lon: e.lon,
          numArticles: e.numArticles,
          numSources: e.numSources,
          avgTone: Number(e.avgTone.toFixed(2)),
          eventDate: e.eventDate,
          ts: e.ts,
          sourceUrl: e.sourceUrl,
          domain: domainOf(e.sourceUrl),
          a1Name: g?.a1Name ?? "", a1Country: g?.a1Country ?? "",
          a1GeoType: g?.a1GeoType ?? "", a1GeoName: g?.a1GeoName ?? "", a1GeoCountry: g?.a1GeoCountry ?? "",
          a2Name: g?.a2Name ?? "", a2Country: g?.a2Country ?? "",
          a2GeoType: g?.a2GeoType ?? "", a2GeoName: g?.a2GeoName ?? "", a2GeoCountry: g?.a2GeoCountry ?? "",
        });
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(CANDIDATES, JSON.stringify(candidates, null, 1), "utf8");

  // Report the shape of the population, because sample design depends on it.
  const byLayer = new Map<string, number>();
  const byStamp = new Map<string, number>();
  const byCountry = new Map<string, number>();
  let mismatch = 0, noActorGeo = 0;
  for (const c of candidates) {
    byLayer.set(c.layer, (byLayer.get(c.layer) ?? 0) + 1);
    byStamp.set(c.stamp, (byStamp.get(c.stamp) ?? 0) + 1);
    byCountry.set(c.actionCountry, (byCountry.get(c.actionCountry) ?? 0) + 1);
    const actorCountries = [c.a1GeoCountry, c.a2GeoCountry].filter(Boolean);
    if (!actorCountries.length) noActorGeo++;
    else if (!actorCountries.includes(c.actionCountry)) mismatch++;
  }

  console.log(`candidates: ${candidates.length}  (per 15-min slot, deduped within slot)`);
  console.log(`windows:    ${stamps.length}`);
  for (const [s, n] of [...byStamp].sort()) console.log(`  ${s}  ${n}`);
  console.log(`layers:`);
  for (const [l, n] of byLayer) console.log(`  ${l.padEnd(9)} ${n}`);
  console.log(`distinct ActionGeo countries: ${byCountry.size}`);
  console.log(`top countries:`);
  for (const [cc, n] of [...byCountry].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${cc.padEnd(4)} ${n}`);
  }
  console.log(`\nFirst look at the actor-geography hunch. UNLABELLED, so it proves nothing:`);
  console.log(`  no actor carries a geo country:                  ${noActorGeo} (${pct(noActorGeo, candidates.length)})`);
  console.log(`  ActionGeo country in NO actor geo country:       ${mismatch} (${pct(mismatch, candidates.length)})`);
  console.log(`\nwrote ${CANDIDATES}`);
}

/**
 * Print articles and their pins for labelling.
 *
 * GROUPED BY SOURCE URL ON PURPOSE. Reading an article once settles two different
 * questions for every row it produced: whether a real event of that type happened at
 * all (`not-an-event`), and whether each individual pin is where it happened
 * (`wrong-place`). Labelling row-by-row would mean reading the same article five times
 * and inviting five inconsistent verdicts on the same text.
 *
 * STRATIFIED, because the sample has to answer two questions and only one of them is
 * about the rows the rule fires on. Precision needs labelled rows from the 4+ bucket;
 * RECALL needs labelled rows from the 1-, 2- and 3-place buckets, where the rule stays
 * silent. A sample drawn only from the loud bucket can report a precision and cannot
 * report a recall, and would flatter any rule.
 */
function worksheet() {
  const candidates: Candidate[] = JSON.parse(readFileSync(CANDIDATES, "utf8"));
  const bucketArg = process.argv.find((a) => a.startsWith("--bucket="))?.slice(9);
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 8);
  const offset = Number(process.argv.find((a) => a.startsWith("--offset="))?.slice(9) ?? 0);

  const grp = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const k = `${c.stamp} ${c.sourceUrl}`;
    (grp.get(k) ?? grp.set(k, []).get(k)!).push(c);
  }

  const groups = [...grp.entries()].map(([k, rows]) => {
    const places = new Set(rows.map((r) => `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`)).size;
    return { stamp: k.split(" ")[0], url: rows[0].sourceUrl, rows, places };
  });

  const inBucket = (p: number) => {
    if (!bucketArg) return true;
    if (bucketArg === "4+") return p >= 4;
    return p === Number(bucketArg);
  };
  const picked = groups.filter((g) => inBucket(g.places)).slice(offset, offset + limit);

  console.log(`# ${picked.length} article(s), bucket=${bucketArg ?? "all"}, offset=${offset}\n`);
  for (const g of picked) {
    const art = readArticle(g.url);
    console.log(`URL      ${g.url}`);
    console.log(`SLOT     ${g.stamp}   PLACES ${g.places}   ROWS ${g.rows.length}`);
    console.log(`FETCH    ${art?.outcome ?? "NOT FETCHED"}`);
    if (art?.outcome === "ok") {
      console.log(`TITLE    ${art.title.slice(0, 160)}`);
      if (art.description) console.log(`DESC     ${art.description.slice(0, 260)}`);
      console.log(`LEDE     ${art.text.split("\n").slice(0, 3).join(" ").slice(0, 520)}`);
    }
    console.log(`PINS`);
    for (const r of g.rows) {
      console.log(`  ${r.id}  ${r.layer.padEnd(8)} ${r.eventCode.padEnd(5)} ${r.actionCountry.padEnd(3)} ${r.place.slice(0, 44).padEnd(44)} art=${r.numArticles} src=${r.numSources}`);
    }
    console.log("");
  }
}

interface CachedArticle { url: string; outcome: string; title: string; description: string; text: string }

function readArticle(url: string): CachedArticle | undefined {
  const key = createHash("sha1").update(url).digest("hex").slice(0, 16);
  const f = join(".gdelt-cache", "articles", `${key}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : undefined;
}

function score() {
  if (!existsSync(LABELS)) {
    throw new Error(
      `No labels at ${LABELS}. Phase A3 scores discriminators against HUMAN labels;\n` +
      `there is nothing honest to score before the rows have been read against their sources.`,
    );
  }
  throw new Error("score() is not implemented yet — labelling is not finished.");
}

const cmd = process.argv[2];
if (cmd === "extract") extract();
else if (cmd === "worksheet") worksheet();
else if (cmd === "score") score();
else {
  console.error("usage: gdelt-audit.mts <extract|worksheet|score>");
  process.exitCode = 2;
}
