// Probe /api/planes and say what it serves and WHERE the aircraft are.
//
// The planes layer once rendered as one or two dense discs while the API said
// "3,000 aircraft" (2026-09-06: 1,311 aircraft from 1 of 40 sweep cells, every one
// between 2 and 15 degrees east). A count cannot show that; a spread can. Per read
// this prints the HTTP status, x-vercel-cache, count, source, the coverage record
// (returned / available / cap / rule / note), staleness, and the spread: distinct
// 10-degree cells, the largest cell's share, a 30-degree longitude histogram and a
// per-continent tally using the same boxes as lib/planes/ops.ts.
//
// usage: node scripts/probe-planes.mjs [--base=URL] [--file=planes.json] [--at=0,30,300]
//   --base   origin to probe (default https://provenance-online.vercel.app)
//   --file   describe a saved /api/planes body instead of fetching
//   --at     seconds at which to read, from now (default "0"). "0,30,300" reads
//            across a revalidation, since the snapshot revalidates every 240 s.
//
// Against a Vercel PREVIEW — a production build running from Vercel's own egress
// IP, which is where the old sweep died — run it under vercel env run so
// VERCEL_OIDC_TOKEN is in the environment; the header below gets past Deployment
// Protection. It is x-vercel-trusted-oidc-idp-token, NOT x-vercel-oidc-token.
// Never disable Deployment Protection to make a run pass, and never print the token.
//   vercel env run --project traffic-nerd-v2 -- node scripts/probe-planes.mjs --base=https://<preview>.vercel.app --at=0,30,300
//
// Makes no adsb.lol calls of its own.

import { readFileSync } from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const base = String(args.base || "https://provenance-online.vercel.app").replace(/\/$/, "");
const at = String(args.at ?? "0")
  .split(",")
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n) && n >= 0);

// Mirror of CONTINENT_BOXES in lib/planes/ops.ts (first match wins). Duplicated
// because this is plain Node with no TypeScript loader; keep the two in step.
const BOXES = [
  { label: "North America", latMin: 7, latMax: 84, lonMin: -170, lonMax: -50 },
  { label: "South America", latMin: -56, latMax: 13, lonMin: -82, lonMax: -34 },
  { label: "Europe", latMin: 36, latMax: 72, lonMin: -25, lonMax: 40 },
  { label: "Middle East", latMin: 12, latMax: 42, lonMin: 34, lonMax: 63 },
  { label: "Africa", latMin: -35, latMax: 37, lonMin: -18, lonMax: 52 },
  { label: "Asia", latMin: 5, latMax: 78, lonMin: 40, lonMax: 180 },
  { label: "Oceania", latMin: -50, latMax: 0, lonMin: 110, lonMax: 180 },
];
function regionOf(lat, lon) {
  for (const b of BOXES) {
    if (lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax) return b.label;
  }
  return "unclassified";
}

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-GB") : String(n));

function describe(label, status, cache, body) {
  const planes = Array.isArray(body?.planes) ? body.planes : [];
  console.log(`\n=== ${label}`);
  console.log(`status ${status}  x-vercel-cache ${cache ?? "-"}  count ${fmt(body?.count)}  source ${body?.source ?? "-"}`);
  const c = body?.coverage;
  if (c) {
    console.log(`coverage: returned ${fmt(c.returned)}  available ${fmt(c.available)}${c.availableExact ? "" : "+"}  cap ${c.cap ?? "-"}  upstreamLimit ${c.upstreamLimit ?? "-"}`);
    console.log(`rule: ${c.rule ?? "-"}`);
    if (c.note) console.log(`note: ${c.note}`);
  } else {
    console.log("coverage: NOT DECLARED (no successful upstream fetch yet)");
  }
  console.log(`staleness: ${body?.staleness ? JSON.stringify(body.staleness) : "fresh"}`);
  if (!planes.length) return;

  const cells = new Map();
  const lonBins = new Array(12).fill(0);
  const regions = new Map();
  let ground = 0;
  for (const p of planes) {
    const key = `${Math.floor((p.lat + 90) / 10)},${Math.floor((p.lon + 180) / 10)}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
    lonBins[Math.min(11, Math.floor((p.lon + 180) / 30))]++;
    const r = regionOf(p.lat, p.lon);
    regions.set(r, (regions.get(r) ?? 0) + 1);
    if (p.meta?.onGround) ground++;
  }
  const largest = Math.max(...cells.values());
  console.log(`spread: ${cells.size} distinct 10-degree cells, largest cell ${fmt(largest)} (${((100 * largest) / planes.length).toFixed(1)}%), on ground ${fmt(ground)}`);
  console.log(`lon 30-degree bins (180W to 180E): ${lonBins.join(" ")}  non-empty ${lonBins.filter(Boolean).length}/12`);
  const order = [...BOXES.map((b) => b.label), "unclassified"];
  console.log(`continents: ${order.map((r) => `${r} ${fmt(regions.get(r) ?? 0)}`).join(" · ")}`);
}

async function readOnce(label) {
  if (args.file) {
    describe(`${label} (file ${args.file})`, "-", "-", JSON.parse(readFileSync(String(args.file), "utf8")));
    return;
  }
  const headers = { Accept: "application/json" };
  if (process.env.VERCEL_OIDC_TOKEN) headers["x-vercel-trusted-oidc-idp-token"] = process.env.VERCEL_OIDC_TOKEN;
  const started = Date.now();
  const res = await fetch(`${base}/api/planes`, { headers, signal: AbortSignal.timeout(90_000) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    console.log(`\n=== ${label}\nstatus ${res.status} in ${Date.now() - started} ms; body is not JSON: ${text.slice(0, 200)}`);
    return;
  }
  describe(`${label} (${Date.now() - started} ms)`, res.status, res.headers.get("x-vercel-cache"), body);
}

const start = Date.now();
for (const s of at.length ? at : [0]) {
  const wait = start + s * 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  await readOnce(`t+${s}s ${args.file ? "" : base}`);
  if (args.file) break;
}
