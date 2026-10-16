import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/relay/[feed]/route";
import { RELAY_FEEDS } from "@/lib/relay/feeds";
import { relayBodyDigestHex, signRelay } from "@/lib/relay/protocol";
import { readRelay, resetRelayStore } from "@/lib/relay/store";

const SECRET = "provenance-relay-route-test-secret-0001";
const fixture = (feed: string) =>
  readFileSync(join(__dirname, "..", "fixtures", "relay", `${feed}.json`), "utf8");

async function push(feed: string, body: string, opts: { gzip?: boolean; secret?: string; ts?: number; digest?: string } = {}) {
  const ts = opts.ts ?? Date.now();
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-provenance-timestamp": String(ts),
    "x-provenance-signature": await signRelay(opts.secret ?? SECRET, ts, body),
  };
  if (opts.digest) headers["x-provenance-content-sha256"] = opts.digest;
  let payload: Uint8Array = new TextEncoder().encode(body);
  if (opts.gzip) {
    payload = gzipSync(payload);
    headers["content-encoding"] = "gzip";
  }
  const res = await POST(new Request(`https://provenance-online.com/api/relay/${feed}`, { method: "POST", headers, body: payload as BodyInit }), {
    params: Promise.resolve({ feed }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** A fixture re-dated to `fetchedAt`, so tests do not age out of a feed's window. */
function envelope(feed: string, fetchedAt: string, data?: unknown): string {
  const env = JSON.parse(fixture(feed));
  env.fetchedAt = fetchedAt;
  if (data !== undefined) env.data = data;
  return JSON.stringify(env);
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");

beforeEach(() => {
  resetRelayStore();
  process.env.RELAY_SIGNING_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.RELAY_SIGNING_SECRET;
  resetRelayStore();
});

describe("POST /api/relay/[feed]", () => {
  it("is a 404 for a feed id that is not on the allowlist, before reading the body", async () => {
    const r = await push("not-a-feed", "{}");
    expect(r.status).toBe(404);
  });

  it("is a 401, never a 5xx, while RELAY_SIGNING_SECRET is unset", async () => {
    delete process.env.RELAY_SIGNING_SECRET;
    const r = await push("celestrak", envelope("celestrak", minutesAgo(5)));
    expect(r.status).toBe(401);
    expect(readRelay("celestrak")).toBeNull();
  });

  it("is a 401 for a signature made with another secret", async () => {
    const r = await push("celestrak", envelope("celestrak", minutesAgo(5)), { secret: SECRET + "-other" });
    expect(r.status).toBe(401);
  });

  it("stores a signed snapshot, gzipped on the wire, and the reader sees it", async () => {
    const fetchedAt = minutesAgo(5);
    const r = await push("celestrak", envelope("celestrak", fetchedAt), { gzip: true });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, feed: "celestrak", outcome: "stored" });
    const held = readRelay("celestrak");
    expect(held?.fetchedAt).toBe(Date.parse(fetchedAt));
    expect(held?.data.groups.visual).toContain("ISS (ZARYA)");
  });

  it("answers a probe with what it holds, and with null before the first push", async () => {
    const probe = JSON.stringify({ version: 1, feed: "celestrak", probe: true });
    expect((await push("celestrak", probe)).json).toEqual({ ok: true, feed: "celestrak", held: null });
    const fetchedAt = minutesAgo(5);
    await push("celestrak", envelope("celestrak", fetchedAt));
    const r = await push("celestrak", probe);
    expect(r.json.held.fetchedAt).toBe(new Date(fetchedAt).toISOString());
  });

  it("keeps the newer copy when a delayed older push arrives", async () => {
    await push("celestrak", envelope("celestrak", minutesAgo(5)));
    const r = await push("celestrak", envelope("celestrak", minutesAgo(60)));
    expect(r.json.outcome).toBe("kept-newer");
    expect(readRelay("celestrak")?.fetchedAt).toBe(Date.parse(minutesAgo(5)));
  });

  it("refuses a body that fails the feed's schema with 422 and names the field", async () => {
    const r = await push("celestrak", envelope("celestrak", minutesAgo(5), { groups: { starlink: "1 x" } }));
    expect(r.status).toBe(422);
    expect(r.json.reason).toMatch(/^schema:/);
    expect(readRelay("celestrak")).toBeNull();
  });

  it("refuses a body signed for one feed and posted to another", async () => {
    const r = await push("eea-aqi", envelope("celestrak", minutesAgo(5)));
    expect(r.status).toBe(422);
    expect(r.json.reason).toBe("feed-mismatch");
  });

  it("refuses a declared digest that disagrees with the content", async () => {
    const body = envelope("celestrak", minutesAgo(5));
    const r = await push("celestrak", body, { digest: (await relayBodyDigestHex(body + " ")) });
    expect(r.status).toBe(422);
    expect(r.json.reason).toBe("digest-mismatch");
  });

  it("refuses a body over the feed's own cap with 413, compressed or not", async () => {
    const big = "x".repeat(RELAY_FEEDS["nrcan-magnetic"].maxBytes + 10);
    expect((await push("nrcan-magnetic", big)).status).toBe(413);
    expect((await push("nrcan-magnetic", big, { gzip: true })).status).toBe(413);
  });

  it("accepts every captured fixture through the real route", async () => {
    for (const feed of Object.keys(RELAY_FEEDS)) {
      const r = await push(feed, envelope(feed, minutesAgo(1)));
      expect(r.status, `${feed}: ${JSON.stringify(r.json)}`).toBe(200);
    }
  });
});
