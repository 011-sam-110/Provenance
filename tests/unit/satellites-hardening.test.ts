import { afterEach, expect, test, vi } from "vitest";
import * as celestrak from "@/lib/sources/celestrak";
import { GET } from "@/app/api/satellites/route";
import { satellitesPayloadOk } from "@/lib/satellites/useSatellites";

// The landing page asks /api/satellites for EVERY visitor. On 2026-09-14, during a
// traffic spike, the route took 10.4 s to answer `celestrak_unavailable` and sent no
// Cache-Control, so each visitor started a fresh upstream attempt with no timeout.
// CelesTrak blocks addresses that over-fetch, so that pattern can turn an outage into
// a ban. These tests pin the four guards that stop it.

const TLE = [
  "ISS (ZARYA)",
  "1 25544U 98067A   26257.50000000  .00016717  00000-0  10270-3 0  9993",
  "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579 12345",
  "",
].join("\n");

const realFetch = globalThis.fetch;
const reset = () => (celestrak as { __resetCelestrakCache?: () => void }).__resetCelestrakCache?.();

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  reset();
});

function stubFetch(impl: () => Promise<Response>) {
  const calls: RequestInit[] = [];
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    calls.push(init ?? {});
    return impl();
  }) as unknown as typeof fetch;
  return calls;
}

const req = (group: string) => new Request(`https://provenance-online.com/api/satellites?group=${group}`);

test("concurrent misses for one group share ONE upstream fetch", async () => {
  reset();
  const calls = stubFetch(async () => {
    await new Promise((r) => setTimeout(r, 5));
    return new Response(TLE, { status: 200 });
  });
  const results = await Promise.all([
    celestrak.fetchTLEs("visual"),
    celestrak.fetchTLEs("visual"),
    celestrak.fetchTLEs("visual"),
  ]);
  expect(calls.length).toBe(1);
  for (const r of results) expect(r.map((s) => s.noradId)).toEqual(["25544"]);
});

test("the upstream fetch carries a timeout signal", async () => {
  reset();
  const calls = stubFetch(async () => new Response(TLE, { status: 200 }));
  await celestrak.fetchTLEs("stations");
  expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
});

test("a failure is held: a second visitor inside the hold does not re-ask CelesTrak", async () => {
  reset();
  const calls = stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const first = await (await GET(req("stations"))).json();
  const second = await (await GET(req("stations"))).json();
  expect(first.error).toBe("celestrak_unavailable");
  expect(second.error).toBe("celestrak_unavailable");
  expect(calls.length).toBe(1);
});

test("after the failure hold ends, the route asks CelesTrak again", async () => {
  reset();
  const base = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(base);
  const calls = stubFetch(async () => new Response("", { status: 503 }));
  await GET(req("stations"));
  now.mockReturnValue(base + 10 * 60 * 1000 + 1);
  await GET(req("stations"));
  expect(calls.length).toBe(2);
});

test("an unknown group is refused with 400 and never reaches CelesTrak", async () => {
  reset();
  const calls = stubFetch(async () => new Response(TLE, { status: 200 }));
  const res = await GET(req("definitely-not-a-group"));
  expect(res.status).toBe(400);
  expect(calls.length).toBe(0);
});

test("an upstream failure is still a 200 with the celestrak_unavailable contract", async () => {
  reset();
  stubFetch(async () => new Response("", { status: 500 }));
  const res = await GET(req("visual"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toMatchObject({ count: 0, satellites: [], error: "celestrak_unavailable" });
});

test("success is cacheable for an hour; failure only for five minutes", async () => {
  reset();
  stubFetch(async () => new Response(TLE, { status: 200 }));
  const ok = await GET(req("visual"));
  expect(ok.headers.get("Cache-Control")).toContain("s-maxage=3600");
  expect(ok.headers.get("Cache-Control")).toContain("stale-while-revalidate=7200");

  reset();
  stubFetch(async () => new Response("", { status: 500 }));
  const bad = await GET(req("visual"));
  expect(bad.headers.get("Cache-Control")).toContain("s-maxage=300");
  expect(bad.headers.get("Cache-Control")).not.toContain("s-maxage=3600");
});

test("last-good TLEs are served when a refresh fails after the TTL", async () => {
  reset();
  const base = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(base);
  stubFetch(async () => new Response(TLE, { status: 200 }));
  await celestrak.fetchTLEs("visual");
  now.mockReturnValue(base + 3 * 60 * 60 * 1000);
  stubFetch(async () => {
    throw new TypeError("fetch failed");
  });
  const stale = await celestrak.fetchTLEs("visual");
  expect(stale.map((s) => s.noradId)).toEqual(["25544"]);
});

// The other half of that contract is the card. On 2026-09-14 prod answered
// `celestrak_unavailable` on two reads, and the Satellites card read only
// `satellites` (empty), so it showed "Loading satellites…" forever under a green
// "live" chip. These pin that the client reads the route's failure as a failure.
test("the card reads the route's celestrak_unavailable answer as a failed load", async () => {
  reset();
  stubFetch(async () => new Response("", { status: 500 }));
  const body = await (await GET(req("visual"))).json();
  expect(satellitesPayloadOk(body)).toBe(false);
});

test("the card reads a real TLE set as loaded", async () => {
  reset();
  stubFetch(async () => new Response(TLE, { status: 200 }));
  const body = await (await GET(req("visual"))).json();
  expect(satellitesPayloadOk(body)).toBe(true);
});

test("a body that is not a satellites payload is not a load", () => {
  expect(satellitesPayloadOk(null)).toBe(false);
  expect(satellitesPayloadOk({ count: 0, satellites: [] })).toBe(false);
});
