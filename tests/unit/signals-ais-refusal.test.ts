import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AIS_SOURCE, isAisCredentialError, resetAisCollector } from "@/lib/signals/ais";
import { readEvidence, resetEvidence } from "@/lib/sources/upstreamEvidence";

// --- the pure decision function --------------------------------------------
// AISStream answers a rejected credential with exactly `{"error": "Api Key Is
// Not Valid"}` over the WebSocket (aisstream/issues#174) and closes. This is the
// ONE thing that may legitimately become a recorded refusal; a malformed
// subscription or a throttling error is a different failure and must not.

describe("isAisCredentialError", () => {
  test("matches AISStream's real invalid-key text", () => {
    expect(isAisCredentialError("Api Key Is Not Valid")).toBe(true);
  });

  test("matches case-insensitively and on close variants", () => {
    expect(isAisCredentialError("API KEY IS NOT VALID")).toBe(true);
    expect(isAisCredentialError("invalid api key")).toBe(true);
    expect(isAisCredentialError("Unauthorized: bad api key")).toBe(true);
  });

  test("does not match unrelated AISStream error frames", () => {
    expect(isAisCredentialError("Subscription Object Is Malformed")).toBe(false);
    expect(isAisCredentialError("Too many subscription updates")).toBe(false);
  });

  test("does not match absent/empty text", () => {
    expect(isAisCredentialError(undefined)).toBe(false);
    expect(isAisCredentialError(null)).toBe(false);
    expect(isAisCredentialError("")).toBe(false);
  });
});

// --- the wired failure path --------------------------------------------------
// Exercised through AIS_SOURCE.fetch() itself (collectAis/the socket are not
// exported) against a fake global WebSocket, so this proves the actual wiring
// rather than just the predicate above.

class FakeWebSocket {
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  binaryType = "";
  closed = false;
  sent: string[] = [];
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
}

describe("AIS_SOURCE.fetch credential-refusal wiring", () => {
  const sockets: FakeWebSocket[] = [];

  beforeEach(() => {
    // The stream is a process-wide singleton now; each case starts with none.
    resetAisCollector();
    resetEvidence();
    sockets.length = 0;
    process.env.AISSTREAM_API_KEY = "test-key";
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

  test("records a refusal when AISStream rejects the credential, and still resolves to []", async () => {
    const fetchPromise = AIS_SOURCE.fetch();
    expect(sockets).toHaveLength(1);
    const ws = sockets[0]!;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ error: "Api Key Is Not Valid" }) });

    const out = await fetchPromise;
    expect(out).toEqual([]); // dormant-safe contract: never throws, never partial-crashes

    const ev = readEvidence("ais");
    expect(ev?.refusals).toBe(1);
    expect(ev?.lastRefusalStatus).toBe(401);
    expect(ev?.lastRefusalHost).toBe("stream.aisstream.io");
  });

  test("a closed socket with no PositionReports and no error frame is NOT recorded as a refusal", async () => {
    const fetchPromise = AIS_SOURCE.fetch();
    const ws = sockets[0]!;
    ws.onopen?.();
    ws.onclose?.(); // e.g. the upstream just closed the connection — not a credential verdict

    const out = await fetchPromise;
    expect(out).toEqual([]);
    expect(readEvidence("ais")).toBeUndefined(); // ledger untouched — no false refusal
  });

  test("an unrelated error frame (not about the key) is NOT recorded as a refusal", async () => {
    const fetchPromise = AIS_SOURCE.fetch();
    const ws = sockets[0]!;
    ws.onopen?.();
    ws.onmessage?.({ data: JSON.stringify({ error: "Subscription Object Is Malformed" }) });
    ws.onclose?.();

    const out = await fetchPromise;
    expect(out).toEqual([]);
    expect(readEvidence("ais")).toBeUndefined();
  });
});

// --- the long-lived stream ----------------------------------------------------
// The socket used to open and close inside every fetch, listening for 4.5 s, so
// prod served 15 to 26 vessels over nine chokepoints. It now stays open and every
// fetch reads what it has heard. These cases drive the real collector with a fake
// socket.

describe("AIS_SOURCE.fetch keeps one socket open across fetches", () => {
  const sockets: FakeWebSocket[] = [];
  const report = (mmsi: number, lat: number, lon: number) =>
    JSON.stringify({
      MessageType: "PositionReport",
      MetaData: { MMSI: mmsi, ShipName: `SHIP ${mmsi}`, latitude: lat, longitude: lon, time_utc: "2026-10-16 19:00:00.000 +0000 UTC" },
      Message: { PositionReport: { Sog: 10, Cog: 90, TrueHeading: 90, NavigationalStatus: 0 } },
    });

  beforeEach(() => {
    resetAisCollector();
    sockets.length = 0;
    process.env.AISSTREAM_API_KEY = "test-key";
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

  test("the second fetch opens no socket and returns everything heard so far", async () => {
    vi.useFakeTimers();
    try {
      const first = AIS_SOURCE.fetch();
      const ws = sockets[0]!;
      ws.onopen?.();
      expect(JSON.parse(ws.sent[0]!).APIKey).toBe("test-key");
      ws.onmessage?.({ data: report(1, 50, 0) }); // English Channel
      await vi.advanceTimersByTimeAsync(5000); // the cold-start window
      expect((await first).map((f) => f.id)).toEqual(["ais:1"]);

      ws.onmessage?.({ data: report(2, 25, 56) }); // Hormuz
      const second = await AIS_SOURCE.fetch();
      expect(sockets).toHaveLength(1);
      expect(ws.closed).toBe(false);
      expect(second.map((f) => f.id).sort()).toEqual(["ais:1", "ais:2"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a vessel not heard for longer than the TTL drops out", async () => {
    vi.useFakeTimers();
    try {
      const first = AIS_SOURCE.fetch();
      const ws = sockets[0]!;
      ws.onopen?.();
      ws.onmessage?.({ data: report(1, 50, 0) });
      await vi.advanceTimersByTimeAsync(5000);
      await first;
      await vi.advanceTimersByTimeAsync(21 * 60_000);
      ws.onmessage?.({ data: report(2, 50, 1) });
      expect((await AIS_SOURCE.fetch()).map((f) => f.id)).toEqual(["ais:2"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
