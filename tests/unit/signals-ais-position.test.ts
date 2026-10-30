import { describe, expect, it } from "vitest";
// VERBATIM AISStream frames, 2026-10-28 23:18Z, on the whole-world subscription: the
// confirmation, three Class A positions, four Class B (standard) and two Class B
// (extended) positions, a ShipStaticData and two StaticDataReports.
import capture from "@/tests/fixtures/aisstream-frames.json";
import locations from "@/tests/fixtures/digitraffic-ais-locations.json";
import register from "@/tests/fixtures/digitraffic-ais-vessels.json";
import { normalizeDigitraffic, type DigitrafficLocations, type DigitrafficVessel } from "@/lib/signals/aisDigitraffic";
import {
  VESSEL_TTL_MS,
  WARM_MS,
  chokepointFor,
  consoleStream,
  mergeVessels,
  newestPerMmsi,
  positionFromMessage,
  streamState,
  vesselFeature,
  type AisVessel,
} from "@/lib/signals/ais";

interface Frame {
  MessageType: string;
  MetaData: Record<string, unknown> & { MMSI: number };
}
const frames = (capture.frames as string[]).map((f) => JSON.parse(f) as Frame);
const byType = (t: string) => frames.filter((f) => f.MessageType === t);
const mmsiOf = (f: Frame) => f.MetaData.MMSI;

describe("positionFromMessage", () => {
  it("reads a Class A report, with its navigational status", () => {
    const f = byType("PositionReport").find((x) => mmsiOf(x) === 368028720)!;
    expect(positionFromMessage(f)).toEqual({
      MMSI: 368028720,
      ShipName: "MISS NEW YORK       ",
      latitude: 40.68898,
      longitude: -74.04842,
      Sog: 5.5,
      Cog: 206.6,
      TrueHeading: 511,
      NavigationalStatus: 15,
      time_utc: "2026-10-28 23:18:28.49557987 +0000 UTC",
      aisClass: "A",
    });
  });

  it("reads a standard Class B report: no navigational status, class B", () => {
    const f = byType("StandardClassBPositionReport").find((x) => mmsiOf(x) === 525100576)!;
    const v = positionFromMessage(f)!;
    expect(v).toMatchObject({ MMSI: 525100576, ShipName: "SRI KAWIT PANCING   ", latitude: -6.62353, longitude: 111.20199, Sog: 4.9, Cog: 234.3, aisClass: "B" });
    expect(v).not.toHaveProperty("NavigationalStatus");
  });

  it("reads an extended Class B report from the same fields", () => {
    const f = byType("ExtendedClassBPositionReport").find((x) => mmsiOf(x) === 338501908)!;
    const v = positionFromMessage(f)!;
    expect(v).toMatchObject({ MMSI: 338501908, latitude: 33.84933, longitude: -118.40035, Sog: 0, Cog: 100, aisClass: "B" });
    expect(v).not.toHaveProperty("NavigationalStatus");
  });

  it("passes a heading through, 511 ('not available') included", () => {
    const a = byType("PositionReport").find((x) => mmsiOf(x) === 244750440)!;
    expect(positionFromMessage(a)!.TrueHeading).toBe(511);
    const b = byType("StandardClassBPositionReport").find((x) => mmsiOf(x) === 368176370)!;
    expect(positionFromMessage(b)!.TrueHeading).toBe(357);
    // The vessel feature reads 511 as no heading, and the name is trimmed.
    expect(vesselFeature(positionFromMessage(a)!)!.props?.heading).toBe("—");
    expect(vesselFeature(positionFromMessage(byType("PositionReport").find((x) => mmsiOf(x) === 368028720)!)!)!.title).toBe("MISS NEW YORK");
  });

  it("maps every position frame in the capture and nothing else", () => {
    const positions = frames.map(positionFromMessage).filter((v): v is AisVessel => v != null);
    expect(positions).toHaveLength(3 + 4 + 2);
    expect(positions.filter((v) => v.aisClass === "A")).toHaveLength(3);
    expect(positions.filter((v) => v.aisClass === "B")).toHaveLength(6);
  });

  it("gives null for the confirmation and for static data", () => {
    expect(positionFromMessage(byType("SubscriptionConfirmation")[0])).toBeNull();
    expect(byType("ShipStaticData")).toHaveLength(1);
    expect(positionFromMessage(byType("ShipStaticData")[0])).toBeNull();
    expect(byType("StaticDataReport")).toHaveLength(2);
    for (const f of byType("StaticDataReport")) expect(positionFromMessage(f)).toBeNull();
  });

  it("gives null without an MMSI, or without a numeric position", () => {
    const f = byType("PositionReport")[0];
    const withMeta = (patch: Record<string, unknown>) => ({ ...f, MetaData: { ...f.MetaData, ...patch } });
    expect(positionFromMessage(withMeta({ MMSI: undefined }))).toBeNull();
    expect(positionFromMessage(withMeta({ MMSI: 0 }))).toBeNull();
    expect(positionFromMessage(withMeta({ latitude: "53.1" }))).toBeNull();
    expect(positionFromMessage(withMeta({ longitude: Number.NaN }))).toBeNull();
    expect(positionFromMessage(withMeta({ latitude: undefined }))).toBeNull();
    expect(positionFromMessage({ ...f, MetaData: undefined })).toBeNull();
    expect(positionFromMessage(null)).toBeNull();
    expect(positionFromMessage("PositionReport")).toBeNull();
    expect(positionFromMessage({})).toBeNull();
  });

  it("survives a frame whose message body is missing", () => {
    const f = byType("PositionReport")[0];
    const v = positionFromMessage({ MessageType: "PositionReport", MetaData: f.MetaData })!;
    expect(v.MMSI).toBe(244750440);
    expect(v.Sog).toBeUndefined();
  });
});

describe("newestPerMmsi", () => {
  const v = (mmsi: number, t: string, lat = 51.5, lon = 0): AisVessel => ({ MMSI: mmsi, latitude: lat, longitude: lon, time_utc: t });

  it("keeps the newer report of a ship, whichever feed is first", () => {
    const old = v(1, "2026-10-28 23:00:00.000 +0000 UTC");
    const fresh = v(1, "2026-10-28 23:05:00.000 +0000 UTC");
    expect(newestPerMmsi([[old], [fresh]])).toEqual([fresh]);
    expect(newestPerMmsi([[fresh], [old]])).toEqual([fresh]);
    expect(newestPerMmsi([null, undefined, [old, v(2, "2026-10-28 23:01:00.000 +0000 UTC")]])).toHaveLength(2);
  });

  it("applies `keep` before it compares, so a refused report never displaces an accepted one", () => {
    const inside = v(1, "2026-10-28 23:00:00.000 +0000 UTC", 51.5, 0);
    const newerOutside = v(1, "2026-10-28 23:05:00.000 +0000 UTC", 10, 10);
    const keep = (x: AisVessel) => x.latitude === 51.5;
    expect(newestPerMmsi([[inside], [newerOutside]], keep)).toEqual([inside]);
    expect(newestPerMmsi([[inside], [newerOutside]])).toEqual([newerOutside]);
  });

  it("drops a row with no MMSI or no position", () => {
    expect(newestPerMmsi([[{ latitude: 1, longitude: 1 }, { MMSI: 3 }, { MMSI: 4, latitude: 1, longitude: null }]])).toEqual([]);
  });
});

describe("mergeVessels still means what it meant before the world was heard", () => {
  // The loop as it stood before newestPerMmsi: the chokepoint test inline.
  const before = (...feeds: (AisVessel[] | null | undefined)[]): AisVessel[] => {
    const by = new Map<number, AisVessel>();
    const at = (x: AisVessel) => {
      const t = Date.parse((x.time_utc ?? "").replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}).*$/, "$1T$2Z"));
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    };
    for (const feed of feeds) {
      for (const x of feed ?? []) {
        if (!x.MMSI || typeof x.latitude !== "number" || typeof x.longitude !== "number") continue;
        if (!chokepointFor(x.latitude, x.longitude)) continue;
        const prev = by.get(x.MMSI);
        if (!prev || at(x) > at(prev)) by.set(x.MMSI, x);
      }
    }
    return [...by.values()];
  };
  const NOW = Date.parse("2026-10-16T20:07:51Z");
  const dt = normalizeDigitraffic(locations as DigitrafficLocations, register as DigitrafficVessel[], NOW, VESSEL_TTL_MS);
  const heard = frames.map(positionFromMessage).filter((x): x is AisVessel => x != null);

  it("gives the same vessels, in the same order, on the Digitraffic fixtures and the world capture", () => {
    expect(mergeVessels(dt)).toEqual(before(dt));
    expect(mergeVessels(heard, dt)).toEqual(before(heard, dt));
    expect(mergeVessels(dt, heard, null, undefined)).toEqual(before(dt, heard, null, undefined));
    // Of the 30 Digitraffic rows, 25 are in the Gulf of Finland box; the capture's are all elsewhere.
    expect(mergeVessels(heard, dt)).toHaveLength(25);
  });
});

describe("consoleStream", () => {
  it("drops Class B and keeps Class A and the rows with no class", () => {
    const a: AisVessel = { MMSI: 1, aisClass: "A" };
    const b: AisVessel = { MMSI: 2, aisClass: "B" };
    const none: AisVessel = { MMSI: 3, source: "Digitraffic" };
    expect(consoleStream([a, b, none])).toEqual([a, none]);
  });

  it("leaves the world capture's Class A ships only", () => {
    const heard = frames.map(positionFromMessage).filter((x): x is AisVessel => x != null);
    expect(consoleStream(heard).map((x) => x.MMSI).sort()).toEqual([244028325, 244750440, 368028720]);
  });
});

describe("streamState", () => {
  const T0 = Date.parse("2026-10-28T23:00:00Z");
  const base = { hasKey: true, connected: true, failure: undefined, refusedAt: null as number | null, firstOpenAt: T0 };

  it("off without a key, whatever else is true", () => {
    expect(streamState({ ...base, hasKey: false }, T0 + WARM_MS * 5)).toBe("off");
    expect(streamState({ ...base, hasKey: false, refusedAt: T0 }, T0)).toBe("off");
  });

  it("down when the key was refused, or the socket is gone with a failure on record", () => {
    expect(streamState({ ...base, refusedAt: T0 }, T0 + 1)).toBe("down");
    expect(streamState({ ...base, connected: false, failure: "socket closed" }, T0 + 1)).toBe("down");
    expect(streamState({ ...base, connected: false, failure: "socket closed", firstOpenAt: null }, T0)).toBe("down");
    // Connected with an old failure is not down, and neither is a socket still opening with none.
    expect(streamState({ ...base, failure: "socket error" }, T0 + WARM_MS)).toBe("live");
    expect(streamState({ ...base, connected: false, firstOpenAt: null }, T0)).toBe("warming");
  });

  it("warming for the first two minutes after the first open, or before there was one", () => {
    expect(streamState({ ...base, firstOpenAt: null }, T0)).toBe("warming");
    expect(streamState(base, T0)).toBe("warming");
    expect(streamState(base, T0 + WARM_MS - 1)).toBe("warming");
  });

  it("live after that", () => {
    expect(streamState(base, T0 + WARM_MS)).toBe("live");
    expect(streamState(base, T0 + 60 * 60_000)).toBe("live");
  });
});
