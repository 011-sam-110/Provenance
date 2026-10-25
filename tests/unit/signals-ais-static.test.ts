import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AIS_MESSAGE_TYPES,
  AIS_SOURCE,
  CHOKEPOINTS,
  STATIC_TTL_MS,
  pruneStatics,
  resetAisCollector,
  staticFromMessage,
  subscriptionMessage,
  withStatic,
  type AisStatic,
  type AisVessel,
} from "@/lib/signals/ais";

// Ship types from AIS message 5 (ShipStaticData), on the same socket and key as the
// positions. Before this, 993 of 1,200 vessels on production carried no type.

describe("the subscription", () => {
  it("asks for positions and static data, over every chokepoint, with the key", () => {
    const sub = JSON.parse(subscriptionMessage("k"));
    expect(sub.APIKey).toBe("k");
    expect(sub.FilterMessageTypes).toEqual(["PositionReport", "ShipStaticData"]);
    expect(AIS_MESSAGE_TYPES).toEqual(["PositionReport", "ShipStaticData"]);
    expect(sub.BoundingBoxes).toEqual(CHOKEPOINTS.map((c) => c.bbox));
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
});
