import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  normalizeGdacsRss,
  gdacsEventLabel,
  gdacsAlertColor,
  isClosedGdacsEvent,
  GDACS_RSS,
  GDACS_SOURCE,
} from "@/lib/signals/gdacs";
import { rowMetric } from "@/lib/console/signals/signalCard";

// A live capture of https://www.gdacs.org/xml/rss.xml from 2026-10-16 ~20:10 UTC,
// trimmed to at most three items per (event type, iscurrent) pair: 23 of 245 items.
const XML = readFileSync(resolve(__dirname, "../fixtures/gdacs-rss.xml"), "utf8");
const rows = normalizeGdacsRss(XML);

test("reads the RSS: current events only, every hazard type, one row per event and episode", () => {
  // 23 items, 10 of them closed (iscurrent=false).
  expect(rows).toHaveLength(13);
  expect(new Set(rows.map((f) => f.signalId))).toEqual(new Set(["gdacs"]));
  expect(new Set(rows.map((f) => f.props?.hazard))).toEqual(
    new Set(["Tropical cyclone", "Earthquake", "Wildfire", "Flood", "Drought"]),
  );
  expect(new Set(rows.map((f) => f.id)).size).toBe(rows.length);
});

test("a cyclone: its name, alert colour, the event's score and an exact point", () => {
  const champi = rows.find((f) => f.id === "gdacs:1001338:9")!;
  expect(champi.title).toBe("Tropical cyclone CHAMPI-26");
  expect(champi.lat).toBe(11.4);
  expect(champi.lon).toBe(151.4);
  expect(champi.precision).toBe("exact");
  expect(champi.color).toBe(gdacsAlertColor("Orange"));
  expect(champi.props?.alertScore).toBe(2); // event Orange (2), latest episode Green (1)
  expect(champi.props?.country).toBe("Guam");
  expect(champi.ts).toBe("2026-10-14T12:00:00.000Z"); // fromdate: when GDACS opened the event
  expect(champi.link).toBe("https://www.gdacs.org/report.aspx?eventtype=TC&eventid=1001338");
});

test("an earthquake scores 1 on the bar, as its Green alert says, not the RSS's 0", () => {
  const eq = rows.find((f) => f.id === "gdacs:1571917:1740457")!;
  expect(eq.title).toBe("Earthquake in Russia");
  expect(eq.props?.alertLevel).toBe("Green");
  expect(eq.props?.alertScore).toBe(1);
  expect(eq.props?.severity).toContain("Magnitude 6.9M");
  const m = rowMetric(eq, GDACS_SOURCE.metric)!;
  expect(m.value).toBe(1);
  expect(m.domain).toEqual([0, 3]);
});

test("a wildfire and a drought are areas (the layer default), and HTML entities are decoded", () => {
  const fire = rows.find((f) => f.props?.hazard === "Wildfire")!;
  expect(fire.precision).toBeUndefined();
  expect(GDACS_SOURCE.precision).toBe("area");
  const europe = rows.find((f) => f.id === "gdacs:1018332:24")!;
  expect(europe.props?.country).toContain("Bosnia & Herzegovina");
});

// Measured 2026-10-16: 10 of the 12 drought rows were closed, one opened in 2022,
// and all drew as live alerts.
test("a closed event (iscurrent=false) is dropped", () => {
  expect(rows.some((f) => f.id === "gdacs:1027450:11")).toBe(false); // East Africa drought, closed
  expect(isClosedGdacsEvent("False")).toBe(true);
  expect(isClosedGdacsEvent(undefined)).toBe(false);
});

test("an item without a point or an event id is skipped, a repeated event+episode kept once", () => {
  const item = (inner: string) => `<item>${inner}</item>`;
  const xml =
    "<rss><channel>" +
    item("<gdacs:eventid>1</gdacs:eventid><gdacs:episodeid>1</gdacs:episodeid><gdacs:eventtype>FL</gdacs:eventtype>") +
    item("<geo:lat>10</geo:lat><geo:long>20</geo:long><gdacs:eventtype>FL</gdacs:eventtype>") +
    item("<geo:lat>10</geo:lat><geo:long>20</geo:long><gdacs:eventid>2</gdacs:eventid><gdacs:episodeid>1</gdacs:episodeid>") +
    item("<geo:lat>10</geo:lat><geo:long>20</geo:long><gdacs:eventid>2</gdacs:eventid><gdacs:episodeid>1</gdacs:episodeid>") +
    "</channel></rss>";
  expect(normalizeGdacsRss(xml).map((f) => f.id)).toEqual(["gdacs:2:1"]);
});

test("event-type labels and alert-level colours", () => {
  expect(gdacsEventLabel("TC")).toBe("Tropical cyclone");
  expect(gdacsEventLabel("WF")).toBe("Wildfire");
  expect(gdacsEventLabel("??")).toBe("Disaster");
  expect(gdacsAlertColor("Red")).toBe("#dc2626");
  expect(gdacsAlertColor("Orange")).toBe("#f59e0b");
  expect(gdacsAlertColor("Green")).toBe("#16a34a");
});

test("alertLevel maps to the expected magnitude (0–10 ramp)", () => {
  const one = (level: string) =>
    normalizeGdacsRss(
      `<item><geo:lat>1</geo:lat><geo:long>1</geo:long><gdacs:eventid>9</gdacs:eventid><gdacs:alertlevel>${level}</gdacs:alertlevel></item>`,
    )[0]!.props?.magnitude;
  expect(one("Red")).toBe(8);
  expect(one("Orange")).toBe(6);
  expect(one("Green")).toBe(3);
  expect(one("Unknown")).toBe(5);
});

// The request shape is what broke this layer three times (see the header of
// lib/signals/gdacs.ts). It is now ONE request for every hazard type.
test("reads one document for every hazard type, not one request per type", () => {
  expect(GDACS_RSS).toBe("https://www.gdacs.org/xml/rss.xml");
  expect(GDACS_SOURCE.refreshMs).toBeGreaterThanOrEqual(60_000); // robots.txt: Request-rate 1/60
});
