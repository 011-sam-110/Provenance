// Generate the naked-eye star catalogue the landing page draws behind the globe.
//
// Run with `node scripts/gen-sky.mjs`. Like `gen-icons.mjs`, this is a hand-run
// generator and its committed output — `public/sky/naked-eye.json` — is the actual
// asset. Nothing regenerates during `next build`.
//
// SOURCE: the HYG database v4.4 (`hyg_v44.csv`), by David Nash / astronexus, at
// https://codeberg.org/astronexus/hyg. HYG is a merge of the HIPPARCOS catalogue,
// the Yale Bright Star Catalogue and the Gliese catalogue of nearby stars.
//
// WHY HYG AND NOT THE YALE BRIGHT STAR CATALOGUE. BSC5 is the obvious choice — it
// IS the naked-eye sky, 9,110 stars, and Harvard serves it directly. It was
// rejected on licensing, not on data. Neither Harvard's catalogue page nor the
// catalogue's own ReadMe states any licence, and CDS/VizieR, which distributes the
// same catalogue, says only that the data are "free of usage in a scientific
// context" and that "the commercial usage of the data is subject to rules
// depending of the origin". That is not a grant we can rely on for a public
// product. HYG states its licence outright — CC BY-SA 4.0 — which permits
// commercial use against attribution and share-alike, and HYG carries the Yale
// HR numbers anyway, so nothing is lost. This repo already ships share-alike data
// on those terms: see `lib/sources/serbia.data.ts` and its ODbL line.
//
// The house rule this follows, from `lib/sources/discovered.data.ts`: a licence
// nobody granted is worse than an absent one.
//
// WHAT IS DROPPED, AND WHY:
//   - HYG id 0 is the SUN. It carries mag -26.7 and distance 0, so it passes every
//     magnitude cut, and its ra/dec are 0/0 — it would render as a star at the
//     origin of the celestial sphere. This is the Null Island failure that
//     `tests/unit/country-centroids.test.ts` guards against, and it is pinned here
//     too.
//   - Rows with no magnitude, or no usable ra/dec, are dropped rather than
//     defaulted. A star at a made-up position is worse than a missing star.
//
// PRECISION. Coordinates are rounded to 4 decimal places of degrees (0.36 arcsec).
// At the scale the hero draws the sky, one pixel is roughly 0.05 degrees, so this
// is ~500x finer than anything that can be seen. Magnitude and colour index keep
// 2dp, which is the precision the catalogue itself states.
//
// PROPER MOTION IS NOT APPLIED, and the script measures the cost of that rather
// than asserting it is small — see MAX PROPER MOTION in the generated header.
// Precession IS applied, at render time, in `lib/sky/astro.ts`.

import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";

const HYG_URL =
  "https://codeberg.org/astronexus/hyg/media/branch/main/data/hyg/CURRENT/hyg_v44.csv.gz";
const HYG_VERSION = "v4.4";
const MAG_LIMIT = 6.5; // the naked-eye limit, and what "the sky" means
const OUT = join(process.cwd(), "public", "sky", "naked-eye.json");
const CACHE = join(process.cwd(), ".sky-cache", "hyg_v44.csv");

/** Fetch once, cache on disk — this is a 13 MB download for a hand-run script. */
async function loadCsv() {
  const cached = await stat(CACHE).catch(() => null);
  if (cached) {
    process.stderr.write(`using cached ${CACHE}\n`);
    return readFile(CACHE, "utf8");
  }
  process.stderr.write(`downloading ${HYG_URL}\n`);
  const res = await fetch(HYG_URL);
  if (!res.ok) throw new Error(`HYG download failed: ${res.status} ${res.statusText}`);
  const csv = gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8");
  await mkdir(join(process.cwd(), ".sky-cache"), { recursive: true });
  await writeFile(CACHE, csv);
  return csv;
}

/** Minimal CSV reader. HYG quotes fields containing commas; nothing else is exotic. */
function parseCsv(text) {
  const rows = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line) continue;
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"') quoted = false;
        else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

const round = (n, dp) => Number(n.toFixed(dp));

async function main() {
  const rows = parseCsv((await loadCsv()).replace(/\r/g, ""));
  const head = rows[0].map((h) => h.replace(/"/g, ""));
  const col = Object.fromEntries(head.map((h, i) => [h, i]));
  for (const need of ["id", "ra", "dec", "mag", "ci", "proper", "bayer", "con", "hr", "hip", "pmra", "pmdec"]) {
    if (!(need in col)) throw new Error(`HYG column "${need}" is missing — the schema moved`);
  }

  const stars = [];
  const names = {};
  let droppedSun = 0;
  let droppedNoMag = 0;
  let droppedNoPos = 0;
  let maxPmDeg = 0;
  let maxPmName = "";

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length < head.length) continue;

    // The Sun. Dropping it is not an optimisation, it is a correctness fix.
    if (row[col.id] === "0") {
      droppedSun++;
      continue;
    }

    const mag = Number(row[col.mag]);
    if (row[col.mag] === "" || !Number.isFinite(mag)) {
      droppedNoMag++;
      continue;
    }
    if (mag > MAG_LIMIT) continue;

    const raHours = Number(row[col.ra]);
    const dec = Number(row[col.dec]);
    if (!Number.isFinite(raHours) || !Number.isFinite(dec) || Math.abs(dec) > 90) {
      droppedNoPos++;
      continue;
    }

    // HYG stores RA in HOURS. Everything downstream of here is degrees.
    const raDeg = raHours * 15;
    const ci = Number(row[col.ci]);

    // Measure, do not assume, how much ignoring proper motion costs. pmra/pmdec are
    // mas/yr; pmra is already the on-sky rate (it carries the cos(dec) factor).
    const pmra = Number(row[col.pmra]);
    const pmdec = Number(row[col.pmdec]);
    if (Number.isFinite(pmra) && Number.isFinite(pmdec)) {
      const masPerYear = Math.hypot(pmra, pmdec);
      const degIn30Years = (masPerYear * 30) / 3_600_000;
      if (degIn30Years > maxPmDeg) {
        maxPmDeg = degIn30Years;
        maxPmName = row[col.proper] || row[col.bayer] + " " + row[col.con] || `HYG ${row[col.id]}`;
      }
    }

    const proper = row[col.proper];
    const bayer = row[col.bayer];
    const con = row[col.con];
    let name = null;
    if (proper || bayer) {
      name = {};
      if (proper) name.n = proper;
      if (bayer) name.b = bayer;
      if (con) name.c = con;
      if (row[col.hr]) name.hr = Number(row[col.hr]);
      if (row[col.hip]) name.hip = Number(row[col.hip]);
    }

    stars.push({
      row: [
        round(((raDeg % 360) + 360) % 360, 4),
        round(dec, 4),
        round(mag, 2),
        Number.isFinite(ci) ? round(ci, 2) : 0,
      ],
      name,
    });
  }

  // Brightest first, so the draw loop can stop early at a magnitude cut and the
  // name lookup for a hover scans the stars you could actually have hovered.
  // The name travels WITH its star through the sort — keying names by a pre-sort
  // index and sorting afterwards silently renames every star in the sky.
  stars.sort((a, b) => a.row[2] - b.row[2]);
  for (let i = 0; i < stars.length; i++) {
    if (stars[i].name) names[i] = stars[i].name;
  }
  const rowsOut = stars.map((s) => s.row);

  const payload = {
    _provenance: {
      dataset: `HYG database ${HYG_VERSION}`,
      author: "David Nash (astronexus)",
      source: "https://codeberg.org/astronexus/hyg",
      file: HYG_URL,
      licence: "CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)",
      derivedFrom:
        "HIPPARCOS catalogue, Yale Bright Star Catalogue (Hoffleit & Warren 1991), Gliese catalogue of nearby stars",
      retrieved: new Date().toISOString().slice(0, 10),
      equinox: "J2000",
      epoch: "J2000.0",
      magnitudeLimit: MAG_LIMIT,
      rows: rowsOut.length,
      order: "brightest first, by visual magnitude",
      columns: ["raDeg", "decDeg", "vmag", "colourIndexBV"],
      notes: [
        "RA converted from hours (as HYG stores it) to degrees.",
        "HYG id 0 is the Sun and is excluded; it would otherwise render at RA 0 / Dec 0.",
        "Proper motion is NOT applied. Measured worst case in this subset is stated below.",
        "Precession from J2000 to the render date is applied at runtime in lib/sky/astro.ts.",
      ],
      maxProperMotionDegPer30Years: round(maxPmDeg, 4),
      maxProperMotionStar: maxPmName,
      dropped: { sun: droppedSun, noMagnitude: droppedNoMag, noPosition: droppedNoPos },
    },
    stars: rowsOut,
    names,
  };

  await mkdir(join(process.cwd(), "public", "sky"), { recursive: true });
  // One star per line: 9k rows of JSON are not readable, but they ARE diffable, and
  // that is the property `data/discovery/*.json` is pretty-printed for.
  const body =
    "{\n" +
    `"_provenance": ${JSON.stringify(payload._provenance, null, 2)},\n` +
    '"stars": [\n' +
    rowsOut.map((s) => JSON.stringify(s)).join(",\n") +
    "\n],\n" +
    `"names": ${JSON.stringify(payload.names)}\n` +
    "}\n";
  await writeFile(OUT, body);

  const bytes = Buffer.byteLength(body);
  process.stderr.write(
    `wrote ${OUT}\n` +
      `  stars:   ${rowsOut.length} (mag <= ${MAG_LIMIT})\n` +
      `  named:   ${Object.keys(payload.names).length}\n` +
      `  bytes:   ${bytes} (${(bytes / 1024).toFixed(0)} KB)\n` +
      `  dropped: sun=${droppedSun} noMag=${droppedNoMag} noPos=${droppedNoPos}\n` +
      `  max proper motion over 30y: ${maxPmDeg.toFixed(4)} deg (${maxPmName})\n`,
  );
}

main().catch((err) => {
  process.stderr.write(String(err?.stack || err) + "\n");
  process.exit(1);
});
