import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIS_MESSAGE_TYPES,
  AIS_SOURCE,
  STATIC_TTL_MS,
  WORLD_BOX,
  pruneStatics,
  resetAisCollector,
  staticFromClassB,
  staticFromMessage,
  subscriptionMessage,
  withStatic,
  type AisStatic,
  type AisVessel,
} from "@/lib/signals/ais";

// Ship types from AIS message 5 (ShipStaticData), on the same socket and key as the
// positions. Before this, 993 of 1,200 vessels on production carried no type.

describe("the subscription", () => {
  it("asks for both classes of position and the static data, over the whole world, with the key", () => {
    const sub = JSON.parse(subscriptionMessage("k"));
    expect(sub.APIKey).toBe("k");
    expect(sub.FilterMessageTypes).toEqual(["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"]);
    expect(AIS_MESSAGE_TYPES).toEqual(["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "ShipStaticData", "StaticDataReport"]);
    expect(sub.BoundingBoxes).toEqual([WORLD_BOX]);
    expect(WORLD_BOX).toEqual([[-90, -180], [90, 180]]);
  });
});

describe("staticFromMessage", () => {
  it("reads the type and the crew's destination, without the protocol's @ padding", () => {
    expect(staticFromMessage({ Type: 60, Destination: "LONDON@@@@@@@@" }, 5)).toEqual({
      shipType: "passenger",
      destination: "LONDON",
      heardAt: 5,
    });
    expect(staticFromMessage({ Type: 70 }, 5)).toEqual({ shipType: "cargo", heardAt: 5 });
  });

  it("is null when the message says nothing usable", () => {
    expect(staticFromMessage(undefined, 5)).toBeNull();
    expect(staticFromMessage({ Type: 0, Destination: "@@@@" }, 5)).toBeNull();
    expect(staticFromMessage({ Type: null, Destination: null }, 5)).toBeNull();
  });
});

// NO CAPTURE: AISStream needs a socket and the one key (which production holds), so the
// two messages below are built from its published schema (aisstream.io's
// asyncapi: ShipStaticData { ImoNumber, CallSign, Name, Type, Dimension{A,B,C,D},
// Eta{Month,Day,Hour,Minute}, MaximumStaticDraught, Destination } and StaticDataReport
// { PartNumber, ReportA{Valid, Name}, ReportB{Valid, ShipType, CallSign, Dimension} }).
// The values are VALBORG's, from Digitraffic's register capture of 28 Oct 2026, so the
// two feeds can be told apart by their encodings and not by their ship.
const SHIP_STATIC_DATA = {
  Type: 36,
  Destination: "HELSINKI@@@@@@@@@@@@@",
  ImoNumber: 5375462,
  CallSign: "OFNR@@@",
  Dimension: { A: 23, B: 7, C: 2, D: 5 },
  Eta: { Month: 9, Day: 18, Hour: 19, Minute: 0 },
  MaximumStaticDraught: 2.4, // AISStream's is already metres
};

describe("staticFromMessage, the fields of the ship's own report", () => {
  it("reads call sign, IMO, size, draught and ETA", () => {
    expect(staticFromMessage(SHIP_STATIC_DATA, 5)).toEqual({
      shipType: "sailing",
      destination: "HELSINKI",
      callSign: "OFNR",
      imo: 5375462,
      lengthM: 30,
      beamM: 7,
      draughtM: 2.4,
      eta: "09-18T19:00Z",
      heardAt: 5,
    });
  });

  it("leaves out what the ship did not send: 0 is not a value", () => {
    const s = staticFromMessage(
      { Type: 70, ImoNumber: 0, CallSign: "@@@@@@@", Dimension: { A: 0, B: 0, C: 0, D: 0 }, Eta: { Month: 0, Day: 0, Hour: 24, Minute: 60 }, MaximumStaticDraught: 0 },
      5,
    );
    expect(s).toEqual({ shipType: "cargo", heardAt: 5 });
  });

  it("does not keep an IMO number whose check digit fails", () => {
    expect(staticFromMessage({ Type: 70, ImoNumber: 303174162 }, 5)).toEqual({ shipType: "cargo", heardAt: 5 });
  });

  it("keeps a date when only the time is missing", () => {
    expect(staticFromMessage({ Eta: { Month: 10, Day: 28, Hour: 24, Minute: 60 } }, 5)).toEqual({ eta: "10-28", heardAt: 5 });
  });
});

describe("staticFromClassB", () => {
  it("reads a Class B ship's type, call sign and size from part B", () => {
    expect(
      staticFromClassB({ Valid: true, ShipType: 37, CallSign: "MBLC5@@", Dimension: { A: 6, B: 4, C: 1, D: 2 } }, 7),
    ).toEqual({ shipType: "pleasure craft", callSign: "MBLC5", lengthM: 10, beamM: 3, heardAt: 7 });
  });

  it("is null for part A (a name only), an invalid part B, or nothing", () => {
    expect(staticFromClassB({ Valid: false, ShipType: 37, CallSign: "MBLC5" }, 7)).toBeNull();
    expect(staticFromClassB({ Valid: true, ShipType: 0, CallSign: "@@@@@@@", Dimension: { A: 0, B: 0, C: 0, D: 0 } }, 7)).toBeNull();
    expect(staticFromClassB(undefined, 7)).toBeNull();
  });
});

describe("withStatic", () => {
  const v: AisVessel = { MMSI: 1, ShipName: "PEARL OF LONDON", latitude: 51.5, longitude: -0.12 };
  const s: AisStatic = { shipType: "passenger", destination: "LONDON", heardAt: 1 };

  it("adds the type and destination a position lacks", () => {
    expect(withStatic(v, s)).toMatchObject({ shipType: "passenger", destination: "LONDON" });
    expect(withStatic(v, undefined)).toBe(v);
  });

  it("never replaces a feed's own value", () => {
    expect(withStatic({ ...v, shipType: "tug" }, s).shipType).toBe("tug");
  });

  it("joins every field of the ship's report, and keeps a feed's own of each", () => {
    const full: AisStatic = { callSign: "OFNR", imo: 5375462, lengthM: 30, beamM: 7, draughtM: 2.4, eta: "09-18T19:00Z", heardAt: 1 };
    expect(withStatic(v, full)).toMatchObject({ callSign: "OFNR", imo: 5375462, lengthM: 30, beamM: 7, draughtM: 2.4, eta: "09-18T19:00Z" });
    const own = withStatic({ ...v, callSign: "OWN", imo: 9773064, lengthM: 99, beamM: 9, draughtM: 5, eta: "01-01" }, full);
    expect(own).toMatchObject({ callSign: "OWN", imo: 9773064, lengthM: 99, beamM: 9, draughtM: 5, eta: "01-01" });
  });
});

describe("pruneStatics", () => {
  it("forgets a ship not heard for the TTL", () => {
    const m = new Map<number, AisStatic>([
      [1, { shipType: "cargo", heardAt: 0 }],
      [2, { shipType: "tanker", heardAt: STATIC_TTL_MS }],
    ]);
    pruneStatics(m, STATIC_TTL_MS + 1);
    expect([...m.keys()]).toEqual([2]);
  });
});

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = "";
  sent: string[] = [];
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {}
}

describe("the collector joins static data to positions", () => {
  const sockets: FakeWebSocket[] = [];

  beforeEach(() => {
    resetAisCollector();
    sockets.length = 0;
    process.env.AISSTREAM_API_KEY = "test-key";
    vi.stubGlobal("fetch", async () => new Response("", { status: 503 }));
    vi.stubGlobal(
      "WebSocket",
      class extends FakeWebSocket {
        constructor(url: string) {
          super(url);
          sockets.push(this);
        }
      },
    );
  });

  afterEach(() => {
    resetAisCollector();
    vi.unstubAllGlobals();
    delete process.env.AISSTREAM_API_KEY;
  });

  it("serves a vessel heard in both kinds of message with its type", async () => {
    vi.useFakeTimers();
    try {
      const pending = AIS_SOURCE.fetch();
      const ws = sockets[0]!;
      ws.onopen?.();
      ws.onmessage?.({
        data: JSON.stringify({
          MessageType: "ShipStaticData",
          MetaData: { MMSI: 235_000_001, ShipName: "PEARL OF LONDON" },
          Message: { ShipStaticData: { Type: 69, Destination: "WESTMINSTER@@@" } },
        }),
      });
      ws.onmessage?.({
        data: JSON.stringify({
          MessageType: "PositionReport",
          MetaData: { MMSI: 235_000_001, ShipName: "PEARL OF LONDON", latitude: 51.503, longitude: -0.12, time_utc: "2026-10-24 21:22:31.000 +0000 UTC" },
          Message: { PositionReport: { Sog: 4.4, Cog: 28, TrueHeading: 30, NavigationalStatus: 0 } },
        }),
      });
      await vi.advanceTimersByTimeAsync(5000);
      const [f] = await pending;
      expect(f.id).toBe("ais:235000001");
      expect(f.props).toMatchObject({ shipType: "passenger", destination: "WESTMINSTER", speedKt: 4.4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps a Class B part B beside a type 5 report: neither wipes the other", async () => {
    vi.useFakeTimers();
    try {
      const pending = AIS_SOURCE.fetch();
      const ws = sockets[0]!;
      ws.onopen?.();
      const mmsi = 230_108_270;
      ws.onmessage?.({
        data: JSON.stringify({ MessageType: "ShipStaticData", MetaData: { MMSI: mmsi }, Message: { ShipStaticData: SHIP_STATIC_DATA } }),
      });
      ws.onmessage?.({
        data: JSON.stringify({
          MessageType: "StaticDataReport",
          MetaData: { MMSI: mmsi },
          Message: { StaticDataReport: { ReportB: { Valid: true, ShipType: 37, CallSign: "OFNR2@@", Dimension: { A: 6, B: 4, C: 1, D: 2 } } } },
        }),
      });
      ws.onmessage?.({
        data: JSON.stringify({
          MessageType: "PositionReport",
          MetaData: { MMSI: mmsi, ShipName: "VALBORG", latitude: 60.1712, longitude: 24.9621, time_utc: "2026-10-28 22:49:06.000 +0000 UTC" },
          Message: { PositionReport: { Sog: 0, Cog: 330, TrueHeading: 511, NavigationalStatus: 5 } },
        }),
      });
      await vi.advanceTimersByTimeAsync(5000);
      const [f] = await pending;
      // The part B fields win where it sent them; type 5's destination, IMO and ETA stay.
      expect(f.props).toMatchObject({
        shipType: "pleasure craft",
        callSign: "OFNR2",
        lengthM: 10,
        beamM: 3,
        destination: "HELSINKI",
        imo: 5375462,
        draughtM: 2.4,
        eta: "09-18T19:00Z",
        status: "moored",
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
