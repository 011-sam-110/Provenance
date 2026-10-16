/**
 * Gliders & FLARM (lib/signals/ogn.ts), from the Open Glider Network.
 *
 * tests/fixtures/ogn-lxml.xml holds nine verbatim markers from
 * https://live.glidernet.org/lxml.php captured 2026-10-16T20:14Z from provenance-1,
 * chosen to cover every rule; tests/fixtures/ogn-ddb.json holds the three matching
 * entries of OGN's device database (verbatim). Where a test changes a privacy flag or
 * an age, it does so on a copy and says so.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import ddbJson from "@/tests/fixtures/ogn-ddb.json";
import { GLIDERS_SOURCE, MAX_FIX_AGE_S, normalizeOgn, parseDdb, parseLxml } from "@/lib/signals/ogn";
import { getSignal } from "@/lib/signals/registry";
import { resolveSignalSources } from "@/lib/signals/sourceLink";

const xml = readFileSync(resolve(__dirname, "../fixtures/ogn-lxml.xml"), "utf8");
const markers = parseLxml(xml);
const ddb = parseDdb(ddbJson);

describe("parseLxml / parseDdb", () => {
  it("reads every marker's fourteen fields", () => {
    expect(markers).toHaveLength(9);
    expect(markers.every((m) => m.length === 14)).toBe(true);
    expect(markers[0].slice(0, 4)).toEqual(["52.026402", "9.571070", "1F", "OO-YLS"]);
  });

  it("reads the DDB's tracked / identified choices by device id", () => {
    expect(ddb.get("DDAA0E")).toEqual({ tracked: true, identified: true });
    expect(ddb.size).toBe(3);
  });
});

describe("normalizeOgn", () => {
  const out = normalizeOgn(markers, ddb);
  const byTitle = (t: string) => out.find((f) => f.title.startsWith(t));

  it("keeps gliders, a paraglider and a helicopter, and drops what ADS-B already draws", () => {
    // Kept: OO-YLS and N2985H (gliders in the DDB), an unregistered glider, the
    // paraglider DanZPG2, an unregistered helicopter. Dropped: OE-FPK (type 8, 713 km/h),
    // an ADS-B jet (type 9), N344AA (type 0) and a static object (type 15).
    expect(out).toHaveLength(5);
    expect(out.map((f) => f.props?.type).sort()).toEqual(
      ["Glider / motor glider", "Glider / motor glider", "Glider / motor glider", "Helicopter", "Paraglider"],
    );
    expect(out.some((f) => String(f.props?.registration).includes("N344AA"))).toBe(false);
    expect(out.some((f) => String(f.props?.registration).includes("OE-FPK"))).toBe(false);
  });

  it("shows a known device's registration and competition id, with its live numbers", () => {
    const f = byTitle("OO-YLS")!;
    expect(f.title).toBe("OO-YLS — Glider / motor glider");
    expect(f.props).toMatchObject({ registration: "OO-YLS", competitionId: "1F", altitude: "220 m", altitudeM: 220, lastFix: "12 s ago" });
    expect(f.signalId).toBe("gliders");
  });

  it("never shows the hash OGN puts in place of an unknown device's registration", () => {
    const anon = out.filter((f) => f.props?.registration === "—");
    expect(anon).toHaveLength(2);
    for (const f of anon) {
      expect(f.title).not.toMatch(/[0-9a-f]{7,8}/);
      expect(f.props?.competitionId).toBeUndefined();
    }
  });

  it("drops a device whose owner opted out of tracking (DDB copy with tracked = N)", () => {
    const optedOut = parseDdb({ devices: (ddbJson as { devices: object[] }).devices.map((d) => ({ ...d, tracked: "N" })) });
    const r = normalizeOgn(markers, optedOut);
    expect(r.some((f) => f.title.startsWith("OO-YLS"))).toBe(false);
    expect(r).toHaveLength(2); // only the two devices OGN does not know remain
  });

  it("hides the identity of a device whose owner opted out of identification (copy with identified = N)", () => {
    const hidden = parseDdb({ devices: (ddbJson as { devices: object[] }).devices.map((d) => ({ ...d, identified: "N" })) });
    const r = normalizeOgn(markers, hidden);
    expect(r).toHaveLength(5);
    expect(r.every((f) => f.props?.registration === "—" && f.props?.competitionId === undefined)).toBe(true);
  });

  it("hides every registration when the DDB could not be read", () => {
    const r = normalizeOgn(markers, null);
    expect(r).toHaveLength(5);
    expect(r.every((f) => f.props?.registration === "—")).toBe(true);
  });

  it("drops a fix older than OGN's own ten-minute online rule (copy with the age changed)", () => {
    const old = markers.map((m) => (m[3] === "OO-YLS" ? [...m.slice(0, 6), String(MAX_FIX_AGE_S), ...m.slice(7)] : m));
    expect(normalizeOgn(old, ddb).some((f) => f.title.startsWith("OO-YLS"))).toBe(false);
  });
});

describe("the layer", () => {
  it("is registered as an exact-precision Aviation layer with an altitude metric", () => {
    expect(getSignal("gliders")).toBe(GLIDERS_SOURCE);
    expect(GLIDERS_SOURCE.precision).toBe("exact");
    expect(GLIDERS_SOURCE.group).toBe("Aviation");
    expect(GLIDERS_SOURCE.metric?.field).toBe("altitudeM");
  });

  it("credits OGN and names the ODbL, as OGN's data-usage page asks", () => {
    expect(GLIDERS_SOURCE.attribution).toMatch(/Open Glider Network/);
    expect(GLIDERS_SOURCE.attribution).toMatch(/ODbL/);
    const [chip] = resolveSignalSources({ signalId: "gliders" });
    expect(chip).toMatchObject({ label: "Open Glider Network", href: "https://www.glidernet.org/" });
    expect(chip.licence?.label).toBe("ODbL");
  });
});
