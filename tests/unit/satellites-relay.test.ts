import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as celestrak from "@/lib/sources/celestrak";
import { GET } from "@/app/api/satellites/route";
import { putRelay, resetRelayStore } from "@/lib/relay/store";

// CelesTrak firewalls the production IP (2026-10-16), so lib/sources/celestrak.ts falls
// back to the TLEs provenance-1 relays, and serves whichever copy CelesTrak issued later.
// These pin the fallback and that the 2 h TTL and the stop rule still apply to both.

const ISS = [
  "ISS (ZARYA)",
  "1 25544U 98067A   26289.50000000  .00016717  00000-0  10270-3 0  9993",
  "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 12345",
].join("\n");
const HUBBLE = [
  "HST",
  "1 20580U 90037B   26289.50000000  .00001000  00000-0  50000-4 0  9991",
  "2 20580  28.4700 100.0000 0002500  90.0000 270.0000 15.10000000 10000",
].join("\n");

const H = 60 * 60 * 1000;
const realFetch = globalThis.fetch;
let calls = 0;

function stubFetch(impl: () => Promise<Response>) {
  calls = 0;
  globalThis.fetch = vi.fn(async () => {
    calls += 1;
    return impl();
  }) as unknown as typeof fetch;
}

const relay = (fetchedAt: number, groups: Record<string, string> = { visual: ISS, stations: ISS }) =>
  putRelay("celestrak", { groups }, fetchedAt, fetchedAt + 1000);

beforeEach(() => {
  resetRelayStore();
  celestrak.__resetCelestrakCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  resetRelayStore();
  celestrak.__resetCelestrakCache();
});

test("a fresh relayed set is served without dialling CelesTrak at all", async () => {
  stubFetch(async () => new Response(HUBBLE, { status: 200 }));
  relay(Date.now() - 30 * 60 * 1000);
  const sats = await celestrak.fetchTLEs("visual");
  expect(sats.map((s) => s.noradId)).toEqual(["25544"]);
  expect(calls).toBe(0);
});

test("when CelesTrak refuses this server, the route serves the relayed set instead of celestrak_unavailable", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  relay(Date.now() - 3 * H); // older than the TTL, so CelesTrak is tried first
  const body = await (await GET(new Request("https://provenance-online.com/api/satellites?group=stations"))).json();
  expect(calls).toBe(1);
  expect(body.error).toBeUndefined();
  expect(body.count).toBe(1);
  expect(body.satellites[0].noradId).toBe("25544");
});

test("our own fetch wins over an older relayed copy", async () => {
  stubFetch(async () => new Response(HUBBLE, { status: 200 }));
  relay(Date.now() - 3 * H);
  expect((await celestrak.fetchTLEs("visual")).map((s) => s.noradId)).toEqual(["20580"]);
  // ...and a relayed copy issued after our fetch wins over it.
  relay(Date.now() + 1000);
  expect((await celestrak.fetchTLEs("visual")).map((s) => s.noradId)).toEqual(["25544"]);
});

test("a relayed set older than the feed's max age is not served", async () => {
  stubFetch(async () => new Response("", { status: 503 }));
  relay(Date.now() - 4 * 24 * H);
  await expect(celestrak.fetchTLEs("visual")).rejects.toThrow();
  expect(celestrak.relayedTLEs("visual")).toBeUndefined();
});

test("a group missing from the push falls through to the normal failure", async () => {
  stubFetch(async () => new Response("", { status: 503 }));
  relay(Date.now() - 30 * 60 * 1000, { visual: ISS });
  await expect(celestrak.fetchTLEs("stations")).rejects.toThrow();
  expect((await celestrak.fetchTLEs("visual")).length).toBe(1);
});

test("a push that lands after the halt is served at once", async () => {
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  await expect(celestrak.fetchTLEs("visual")).rejects.toThrow();
  relay(Date.now() - 3 * H);
  expect((await celestrak.fetchTLEs("visual")).length).toBe(1);
  expect(calls).toBe(1); // halted: CelesTrak was not asked again
});
