#!/usr/bin/env node
// Writes lib/signals/us-state-anchors.data.ts: one anchor per US state (and DC), at the
// state capital, for layers that know only which state something is in.
//
//   node scripts/gen-us-state-anchors.mjs <path to GeoNames cities15000.txt>
//
// Source: GeoNames cities15000 (https://download.geonames.org/export/dump/, CC BY 4.0):
// the PPLA row of each state (the seat of the first-order division) and the PPLC row for
// DC. Two capitals are too small for cities15000 (Pierre SD, Montpelier VT); their
// coordinates are in HAND below, copied from the same GeoNames records (cities500).

import { readFileSync, writeFileSync } from "node:fs";

const OUT = "lib/signals/us-state-anchors.data.ts";
const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/gen-us-state-anchors.mjs <cities15000.txt>");
  process.exit(1);
}

const NAMES = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const HAND = {
  SD: { capital: "Pierre", lat: 44.3683, lon: -100.351 },
  VT: { capital: "Montpelier", lat: 44.2601, lon: -72.5754 },
};

const found = { ...HAND };
for (const line of readFileSync(path, "utf8").split("\n")) {
  const c = line.split("\t");
  if (c.length < 15 || c[8] !== "US") continue;
  const fcode = c[7];
  const admin1 = c[10];
  if (fcode === "PPLA" && NAMES[admin1] && !found[admin1]) found[admin1] = { capital: c[1], lat: +(+c[4]).toFixed(4), lon: +(+c[5]).toFixed(4) };
  if (fcode === "PPLC" && !found.DC) found.DC = { capital: c[1], lat: +(+c[4]).toFixed(4), lon: +(+c[5]).toFixed(4) };
}
const missing = Object.keys(NAMES).filter((k) => !found[k]);
if (missing.length) {
  console.error(`no capital found for: ${missing.join(", ")}`);
  process.exit(1);
}

const rows = Object.keys(NAMES)
  .sort()
  .map((k) => `  ${k}: { name: ${JSON.stringify(NAMES[k])}, capital: ${JSON.stringify(found[k].capital)}, lat: ${found[k].lat}, lon: ${found[k].lon} },`);

writeFileSync(
  OUT,
  `// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/gen-us-state-anchors.mjs <GeoNames cities15000.txt>
//
// One anchor per US state and DC, at the state capital, from GeoNames (CC BY 4.0). An
// anchor marks the STATE: a layer that knows only the state draws it at "area"
// precision, and the capital is where the mark sits, never where anything happened.

export interface StateAnchor {
  name: string;
  capital: string;
  lat: number;
  lon: number;
}

export const US_STATE_ANCHORS: Readonly<Record<string, StateAnchor>> = {
${rows.join("\n")}
};

/** The anchor for a two-letter state code, or undefined. */
export function stateAnchor(code: string): StateAnchor | undefined {
  return US_STATE_ANCHORS[(code ?? "").trim().toUpperCase()];
}
`,
);
console.log(`wrote ${OUT}: ${rows.length} states`);
