// Reads each type code's published figures from EUROCONTROL's Aircraft Performance Database
// and writes scripts/plane-models/dimensions.json. One page a second; run by hand, never in the
// gate. A code the database does not hold, or a page that cannot be read, gets `source: null`,
// so the row is visibly unmeasured and tests/unit/eye-plane-models.test.ts says which.
//
//   node scripts/plane-models/fetch-dimensions.mjs [--only=B738,A320]
//
// Keeps a row's `override`, a figure a person set by hand with its own reason and source (the
// database gives the 737-800's span without winglets, for example).

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "dimensions.json");
const ADSB = readFileSync(join(HERE, "../../lib/sources/adsb.ts"), "utf8");
const page = (code) => `https://learningzone.eurocontrol.int/ilp/customs/ATCPFDB/details.aspx?ICAO=${code}`;

/** The 243 codes the plane pull asks for, read from the list itself so the two cannot drift. */
function requestedCodes() {
  const from = ADSB.indexOf("export const TYPE_BATCHES");
  const to = ADSB.indexOf("];\n\n/**", from) > 0 ? ADSB.indexOf("];\n\n/**", from) : ADSB.indexOf("];\r\n\r\n/**", from);
  return [...new Set([...ADSB.slice(from, to).matchAll(/"([A-Z0-9]{2,4})"/g)].map((m) => m[1]))];
}

/** PURE: the fields of one page. Anything missing is null, never a guess. */
export function parsePage(rawHtml) {
  const text = rawHtml
    .replace(/<(script|style)[\s\S]*?<\/[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
  const number = (label) => {
    const m = text.match(new RegExp(`${label}\\s+([0-9]+(?:[.,][0-9]+)?)\\s*m\\b`, "i"));
    return m ? Number(m[1].replace(",", ".")) : null;
  };
  const between = (label, next) => {
    const m = text.match(new RegExp(`${label}\\s+(.*?)\\s+${next}`, "i"));
    return m ? m[1].trim() : null;
  };
  const spanM = number("Wing Span") ?? number("Rotor diameter");
  const lengthM = number("Length");
  if (spanM == null && lengthM == null) return null;
  const power = between("Power plant", "Performance");
  return {
    spanM,
    lengthM,
    heightM: number("Height"),
    power,
    engines: power ? Number((power.match(/^(\d+)\s*x/i) ?? [])[1]) || null : null,
    classCode: (text.match(/Type of Aircraft Type\s+([A-Z0-9-]{3})\b/i) ?? [])[1] ?? null,
    wing: between("Wing position", "Engine position"),
    engine: between("Engine position", "Tail configuration"),
    tail: between("Tail configuration", "Landing gear"),
  };
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const codes = only ?? requestedCodes();
const rows = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {};
let read = 0;
const missing = [];
for (const code of codes) {
  try {
    const res = await fetch(page(code), { headers: { "user-agent": "Mozilla/5.0 (Provenance plane models; one page a second)" }, signal: AbortSignal.timeout(25_000) });
    const fields = res.ok ? parsePage(await res.text()) : null;
    rows[code] = { ...(fields ?? {}), source: fields ? page(code) : null, ...(rows[code]?.override ? { override: rows[code].override } : {}) };
    if (fields) read++;
    else missing.push(code);
  } catch (e) {
    missing.push(`${code} (${e.message})`);
    rows[code] = { source: null, ...(rows[code]?.override ? { override: rows[code].override } : {}) };
  }
  await new Promise((r) => setTimeout(r, 1000));
}
const sorted = Object.fromEntries(Object.keys(rows).sort().map((k) => [k, rows[k]]));
writeFileSync(OUT, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`read ${read} of ${codes.length}; missing: ${missing.join(", ") || "none"}`);
