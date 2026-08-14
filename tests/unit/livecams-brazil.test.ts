import { expect, test, vi, afterEach } from "vitest";
import { BRAZIL_CAM_CHANNELS } from "@/lib/console/livecams/brazil.data";
import { listChannelLive, COST_SEARCH_LIST } from "@/lib/youtube/live";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

test("every registered channel has a well-formed id and a seed", () => {
  expect(BRAZIL_CAM_CHANNELS.length).toBeGreaterThan(0);
  for (const c of BRAZIL_CAM_CHANNELS) {
    expect(c.channelId, c.name).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
    expect(c.seedVideoId, c.name).toMatch(/^[A-Za-z0-9_-]{11}$/);
    expect(c.name.trim()).toBe(c.name);
    expect(c.knownStreams).toBeGreaterThan(0);
  }
});

test("channel ids and widget ids are unique", () => {
  const chans = BRAZIL_CAM_CHANNELS.map((c) => c.channelId);
  const ids = BRAZIL_CAM_CHANNELS.map((c) => c.id);
  expect(new Set(chans).size).toBe(chans.length);
  expect(new Set(ids).size).toBe(ids.length);
});

test("the channels excluded during curation stay excluded", () => {
  // Wolkam IT is Vitoria-GASTEIZ, Spain — it matched the Brazilian "Vitória" on
  // name alone. The others are IRL phone streams, not fixed cameras. All five
  // were removed by hand; this guards the removal against a regenerated list.
  const banned = ["UCd8Jm6IpuRLTGrGkPMKX_Yw", "Wolkam", "Gutti", "Olhar Urbano", "Biel Turismo", "Edson IRL"];
  for (const b of banned) {
    expect(BRAZIL_CAM_CHANNELS.some((c) => c.name.includes(b) || c.channelId === b)).toBe(false);
  }
});

test("no location or category is asserted about a stream", () => {
  // Deriving them from titles put a Cubatão train in Natal and read an
  // "Av. Curitiba" in Goioerê as the city of Curitiba. The board shows the
  // broadcaster's own words instead, so these fields must not come back.
  for (const c of BRAZIL_CAM_CHANNELS) {
    expect(Object.keys(c).sort()).toEqual(["channelId", "id", "knownStreams", "name", "seedVideoId"]);
  }
});

test("listChannelLive is dormant-safe and does not call the network without a key", async () => {
  globalThis.fetch = (() => {
    throw new Error("listChannelLive must not call fetch when dormant");
  }) as unknown as typeof fetch;
  const out = await listChannelLive(BRAZIL_CAM_CHANNELS[0].channelId, undefined);
  expect(out.dormant).toBe(true);
  expect(out.videos).toEqual([]);
  expect(out.quotaSpent).toBe(0);
  expect(out.note).toContain("last-known");
});

test("listChannelLive returns every live stream a channel is running", async () => {
  const ch = BRAZIL_CAM_CHANNELS[0].channelId;
  globalThis.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        items: [
          { id: { videoId: "aaaaaaaaaaa" }, snippet: { channelId: ch, title: "Praia 1" } },
          { id: { videoId: "bbbbbbbbbbb" }, snippet: { channelId: ch, title: "Praia 2" } },
          // A collaborator's video that search sometimes returns — not this channel's.
          { id: { videoId: "ccccccccccc" }, snippet: { channelId: "UCsomeoneelse00000000000", title: "Other" } },
        ],
      }),
      { status: 200 },
    ),
  ) as unknown as typeof fetch;

  const out = await listChannelLive(ch, "k");
  expect(out.videos.map((v) => v.videoId)).toEqual(["aaaaaaaaaaa", "bbbbbbbbbbb"]);
  expect(out.quotaSpent).toBe(COST_SEARCH_LIST);
});

test("an upstream failure yields no streams and an honest note, not a throw", async () => {
  globalThis.fetch = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as typeof fetch;
  const out = await listChannelLive(BRAZIL_CAM_CHANNELS[0].channelId, "k");
  expect(out.videos).toEqual([]);
  expect(out.note).toContain("nothing live");
});
