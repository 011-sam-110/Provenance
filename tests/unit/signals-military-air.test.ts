import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/adsb-mil.json";
import pair from "@/tests/fixtures/adsb-mil-pair.json";
import {
  fetchMilitaryNetworks,
  mergeMilitaryNetworks,
  militaryOutcome,
  normalizeMilitaryAir,
  normalizeMilitaryNetworks,
  MILITARY_AIR_SOURCE,
  MIL_NETWORKS,
} from "@/lib/signals/military-air";
import { readOutcome } from "@/lib/signals/outcome";
import { resolveSignalSources } from "@/lib/signals/sourceLink";
import { rowMetric } from "@/lib/console/signals/signalCard";

test("normalizes military ADS-B, skipping aircraft with no position", () => {
  const out = normalizeMilitaryAir(fixture as never);
  // 6 airborne + 1 grounded (has lat/lon) = 7; the position-less F16 is skipped.
  expect(out).toHaveLength(7);
  expect(new Set(out.map((f) => f.signalId))).toEqual(new Set(["military-air"]));
  expect(out.every((f) => f.id.startsWith("mil:"))).toBe(true);
});

test("maps callsign, type, altitude (incl. 'ground') and speed", () => {
  const out = normalizeMilitaryAir(fixture as never);
  const c17 = out.find((f) => f.props?.typeCode === "C17")!;
  expect(c17.title).toContain("RCH"); // a Reach military callsign
  expect(String(c17.props?.altitude)).toMatch(/ft$/);

  const grounded = out.find((f) => f.id === "mil:abc123")!;
  expect(grounded.props?.altitude).toBe("on ground");
  expect(grounded.props?.speed).toBe("0 kt");
  expect(grounded.ts).toBeUndefined(); // live snapshot, never time-filtered
});

test("declares an altitude metric that resolves to a finite number", () => {
  const out = normalizeMilitaryAir(fixture as never);

  // Source declares the REAL altitude scalar (not the radius proxy).
  const metric = MILITARY_AIR_SOURCE.metric!;
  expect(metric.field).toBe("altitudeFt");
  expect(metric.domain).toEqual([0, 45000]);

  // Airborne C17 (RCH4139 @ 15,000 ft) → the numeric prop is finite and resolves.
  const c17 = out.find((f) => f.props?.typeCode === "C17")!;
  expect(typeof c17.props?.altitudeFt).toBe("number");
  expect(Number.isFinite(c17.props?.altitudeFt as number)).toBe(true);
  const resolved = rowMetric(c17, metric)!;
  expect(resolved.value).toBe(15000);
  expect(resolved.domain).toEqual([0, 45000]);
  expect(resolved.label).toBe("15,000 ft"); // grouped: an altitude is read, not parsed

  // "ground" maps to a genuine 0 ft — still a finite metric, not a dot.
  const grounded = out.find((f) => f.id === "mil:abc123")!;
  expect(grounded.props?.altitudeFt).toBe(0);
  expect(rowMetric(grounded, metric)?.value).toBe(0);
});

// --- two networks, merged (2026-10-16) ----------------------------------------
//
// adsb.fi used to be asked only when adsb.lol failed, so the aircraft only adsb.fi
// saw never reached the map. The fixture holds verbatim rows from both networks'
// /mil feeds captured within seconds of each other.

const both = () => [
  { network: "adsb.lol" as const, json: pair.lol as never },
  { network: "adsb.fi" as const, json: pair.fi as never },
];

test("joins the two networks by hex: one feature per aircraft, each network's own aircraft kept", () => {
  const out = normalizeMilitaryNetworks(both());
  // lol: ae2672 af3be4 ae03ec a3ca1d; fi: ae2672 af3be4 ae26b1 a3ca1d + a junk row with no position.
  expect(out.map((f) => f.id).sort()).toEqual(
    ["mil:a3ca1d", "mil:ae03ec", "mil:ae2672", "mil:ae26b1", "mil:af3be4"],
  );
  const byId = new Map(out.map((f) => [f.id, f]));
  expect(byId.get("mil:ae03ec")!.props?.network).toBe("adsb.lol");
  expect(byId.get("mil:ae26b1")!.props?.network).toBe("adsb.fi");
  expect(byId.get("mil:ae2672")!.props?.network).toBe("adsb.lol + adsb.fi");
});

test("draws the fresher position for an aircraft both saw, and links to that network's map", () => {
  const merged = mergeMilitaryNetworks(both());
  const ae2672 = merged.find((m) => m.row.hex === "ae2672")!;
  // adsb.lol seen_pos 0.348 s, adsb.fi 0.15 s → adsb.fi's position is drawn.
  expect(ae2672.from).toBe("adsb.fi");
  expect(ae2672.row.lat).toBe(21.763733);
  const f = normalizeMilitaryNetworks(both()).find((x) => x.id === "mil:ae2672")!;
  expect(f.link).toBe("https://globe.adsb.fi/?icao=ae2672");
});

test("keeps adsb.lol on a tie, and still takes adsb.fi's type description and owner", () => {
  const f = normalizeMilitaryNetworks(both()).find((x) => x.id === "mil:a3ca1d")!;
  expect(f.link).toBe("https://globe.adsb.lol/?icao=a3ca1d");
  expect(f.props?.type).toBe("PIPER PA-28-140/150/160/180");
  expect(f.props?.owner).toBe("US AIR FORCE");
});

test("never shows a database note as an owner", () => {
  const out = normalizeMilitaryAir(
    { ac: [{ hex: "0b4300", r: "FAG130", t: "UH1", ownOp: "(Hex also used by EC30 TG-LYA)", lat: 14.68, lon: -90.57 }] },
    "adsb.fi",
  );
  expect(out[0].props?.owner).toBeUndefined();
});

test("an adsb.fi row's source chips name adsb.fi and link its home page, as its terms require", () => {
  const f = normalizeMilitaryNetworks(both()).find((x) => x.id === "mil:ae26b1")!;
  const chips = resolveSignalSources({ signalId: "military-air", link: f.link, sourceUrl: MILITARY_AIR_SOURCE.sourceUrl });
  expect(chips).toEqual([
    { href: "https://globe.adsb.fi/?icao=ae26b1", label: "adsb.fi", scope: "record", licence: undefined },
    { href: "https://adsb.fi/", label: "adsb.fi", scope: "provider", licence: undefined },
  ]);
  const lol = normalizeMilitaryNetworks(both()).find((x) => x.id === "mil:ae03ec")!;
  expect(resolveSignalSources({ signalId: "military-air", link: lol.link, sourceUrl: MILITARY_AIR_SOURCE.sourceUrl })[0].label).toBe("adsb.lol");
});

test("is observed when one network answers and the other fails, and degraded only when both fail", () => {
  const one = militaryOutcome([
    { network: "adsb.lol", error: "adsb.lol http 429" },
    { network: "adsb.fi", json: pair.fi as never },
  ]);
  expect(readOutcome(one)?.ok).toBe(true);
  expect(one).toHaveLength(4);
  const none = militaryOutcome([
    { network: "adsb.lol", error: "adsb.lol http 429" },
    { network: "adsb.fi", error: "adsb.fi TimeoutError" },
  ]);
  expect(none).toEqual([]);
  expect(readOutcome(none)?.ok).toBe(false);
  expect(readOutcome(none)?.reason).toContain("adsb.fi TimeoutError");
});

test("asks both networks every cycle, not the second only on failure", async () => {
  const asked: string[] = [];
  const answers = await fetchMilitaryNetworks({
    fetchImpl: async (url) => {
      asked.push(url);
      return new Response(JSON.stringify({ ac: [] }), { status: 200 });
    },
  });
  expect(asked.sort()).toEqual(MIL_NETWORKS.map((n) => n.url).sort());
  expect(answers.every((a) => a.json)).toBe(true);
});
