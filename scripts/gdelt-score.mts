/**
 * Score the candidate discriminator against the human labels.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-score.mts
 *
 * WHAT THE TWO NUMBERS MEAN, because they are easy to swap and the swap flatters.
 *   PRECISION: of the rows the rule DROPS, how many were really junk. Measured
 *     directly, because every row the rule drops is labelled.
 *   RECALL:    of all the junk in the layer, how much the rule catches. NOT measurable
 *     directly, because the rule stays silent on 1014 of 1109 rows and only a sample of
 *     those is labelled. It is ESTIMATED by applying each bucket's labelled junk rate
 *     to that bucket's full population.
 *
 * The estimate is the honest way round and it is unkind to the rule. Reporting recall
 * over the labelled set alone would divide by a denominator made mostly of rows the
 * rule fires on -- which is where they were deliberately sampled from -- and would
 * report a recall near 70% for a rule that reaches under a tenth of the junk.
 *
 * SAMPLE SIZES ARE SMALL in the quiet buckets and the per-bucket rates carry wide error
 * bars. They are printed next to every rate so nobody quotes a percentage without its n.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = join("data", "gdelt-locality", "candidates.json");
const LABELS = join("data", "gdelt-locality", "labels.by-article.json");

interface Row {
  id: string; stamp: string; sourceUrl: string; lat: number; lon: number;
  actionCountry: string; layer: string; place: string;
}
interface ArticleLabel { default: string; why: string; rows?: Record<string, string> }

const JUNK = new Set(["wrong-place", "wrong-event", "not-an-event"]);
const pctOf = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "n/a");

function main() {
  if (!existsSync(LABELS)) throw new Error(`No labels at ${LABELS}.`);
  const rows: Row[] = JSON.parse(readFileSync(CANDIDATES, "utf8"));
  const labels: Record<string, ArticleLabel> = JSON.parse(readFileSync(LABELS, "utf8"));

  // k is places-per-source-URL WITHIN ONE SLOT. Grouping without the slot would make k
  // depend on how big a batch the caller passed -- the trap baseline caught, and the
  // reason GdeltEvent now carries slotStamp.
  const grp = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.stamp}|${r.sourceUrl}`;
    (grp.get(k) ?? grp.set(k, []).get(k)!).push(r);
  }
  const placesOf = new Map<string, number>();
  for (const [k, g] of grp) {
    placesOf.set(k, new Set(g.map((r) => `${r.lat.toFixed(2)},${r.lon.toFixed(2)}`)).size);
  }

  const bucketOf = (p: number) => (p >= 4 ? "4+" : String(p));
  const labelOf = (r: Row): string | undefined => {
    const a = labels[r.sourceUrl];
    if (!a) return undefined;
    return a.rows?.[r.id] ?? a.default;
  };

  interface Cell { total: number; labelled: number; readable: number; junk: number; good: number }
  const cells = new Map<string, Cell>();
  const cell = (b: string) => cells.get(b) ?? cells.set(b, { total: 0, labelled: 0, readable: 0, junk: 0, good: 0 }).get(b)!;

  for (const r of rows) {
    const p = placesOf.get(`${r.stamp}|${r.sourceUrl}`)!;
    const c = cell(bucketOf(p));
    c.total++;
    const l = labelOf(r);
    if (!l) continue;
    c.labelled++;
    if (l === "unreachable") continue;
    c.readable++;
    if (JUNK.has(l)) c.junk++; else c.good++;
  }

  console.log("LABELLED SET, by places-per-URL-per-slot bucket");
  console.log("bucket   rows   labelled  readable   junk   good   junk rate of readable");
  let totRows = 0, totLab = 0, totRead = 0, totJunk = 0, totGood = 0;
  for (const b of ["1", "2", "3", "4+"]) {
    const c = cell(b);
    totRows += c.total; totLab += c.labelled; totRead += c.readable; totJunk += c.junk; totGood += c.good;
    console.log(`  ${b.padEnd(6)} ${String(c.total).padStart(5)} ${String(c.labelled).padStart(9)} ${String(c.readable).padStart(9)} ${String(c.junk).padStart(6)} ${String(c.good).padStart(6)}   ${pctOf(c.junk, c.readable)} (n=${c.readable})`);
  }
  console.log(`  ${"ALL".padEnd(6)} ${String(totRows).padStart(5)} ${String(totLab).padStart(9)} ${String(totRead).padStart(9)} ${String(totJunk).padStart(6)} ${String(totGood).padStart(6)}   ${pctOf(totJunk, totRead)} (n=${totRead})`);

  // --- the rule -----------------------------------------------------------------
  const K = 3;
  const fires = (r: Row) => placesOf.get(`${r.stamp}|${r.sourceUrl}`)! > K;

  const droppedLabelled = rows.filter((r) => fires(r) && labelOf(r) && labelOf(r) !== "unreachable");
  const droppedJunk = droppedLabelled.filter((r) => JUNK.has(labelOf(r)!)).length;
  const droppedGood = droppedLabelled.length - droppedJunk;

  console.log(`\nRULE: drop rows whose source URL is pinned at more than ${K} places in its slot`);
  console.log(`  fires on              ${rows.filter(fires).length} of ${rows.length} rows (${pctOf(rows.filter(fires).length, rows.length)})`);
  console.log(`  labelled and readable ${droppedLabelled.length}`);
  console.log(`  PRECISION             ${pctOf(droppedJunk, droppedLabelled.length)}  (${droppedJunk} junk, ${droppedGood} real events destroyed)`);

  // Estimated recall: each bucket's labelled junk rate applied to its full population.
  let estJunkAll = 0, estJunkCaught = 0;
  for (const b of ["1", "2", "3", "4+"]) {
    const c = cell(b);
    if (!c.readable) continue;
    const est = c.total * (c.junk / c.readable);
    estJunkAll += est;
    if (b === "4+") estJunkCaught += est;
  }
  console.log(`  estimated junk in all ${rows.length} rows: ${Math.round(estJunkAll)} (${pctOf(estJunkAll, rows.length)})`);
  console.log(`  ESTIMATED RECALL      ${pctOf(estJunkCaught, estJunkAll)}  -- the rule reaches only the 4+ bucket`);

  // --- by country size, per the baseline buckets ---------------------------------
  const perCountry = new Map<string, number>();
  for (const r of rows) perCountry.set(r.actionCountry, (perCountry.get(r.actionCountry) ?? 0) + 1);
  const sizeOf = (cc: string) => {
    const n = perCountry.get(cc) ?? 0;
    return n >= 50 ? "loud" : n >= 10 ? "mid" : "quiet";
  };
  console.log(`\nBY COUNTRY SIZE (rows in this 35-window set: loud >=50, mid 10-49, quiet <10)`);
  console.log("size    rows   labelled readable  junk  good  junk rate     rule fires on");
  for (const s of ["loud", "mid", "quiet"]) {
    const inSize = rows.filter((r) => sizeOf(r.actionCountry) === s);
    const lab = inSize.filter((r) => labelOf(r) && labelOf(r) !== "unreachable");
    const junk = lab.filter((r) => JUNK.has(labelOf(r)!)).length;
    const fired = inSize.filter(fires).length;
    console.log(`  ${s.padEnd(6)} ${String(inSize.length).padStart(5)} ${String(inSize.filter((r) => labelOf(r)).length).padStart(9)} ${String(lab.length).padStart(8)} ${String(junk).padStart(5)} ${String(lab.length - junk).padStart(5)}  ${pctOf(junk, lab.length).padEnd(9)} (n=${lab.length})  ${fired} rows (${pctOf(fired, inSize.length)})`);
  }
}

main();
