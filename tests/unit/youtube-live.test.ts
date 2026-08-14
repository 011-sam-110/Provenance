import { afterEach, expect, test, vi } from "vitest";
import {
  chunk,
  parseVideosList,
  parseSearchList,
  pickLiveVideo,
  planRediscovery,
  requestKey,
  resolveLiveVideos,
  COST_SEARCH_LIST,
  COST_VIDEOS_LIST,
  type LiveVideo,
} from "@/lib/youtube/live";
import { NEWS_PROVIDERS, newsChannelRequests, playableRef, resolveEmbed } from "@/lib/console/news/providers";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const NASA = "UCLA_DiR1FfKNvjuUpBHmylQ";

// --- parsers ---------------------------------------------------------------

test("videos.list: a video id that is no longer live is NOT treated as live", () => {
  // The whole failure this module exists to remove. A finished stream keeps a
  // valid video id and returns HTTP 200 — liveBroadcastContent is the truth.
  const json = {
    items: [
      { id: "aaa", snippet: { channelId: NASA, title: "Live now", liveBroadcastContent: "live" } },
      { id: "bbb", snippet: { channelId: NASA, title: "Ended earlier", liveBroadcastContent: "none" } },
      { id: "ccc", snippet: { channelId: NASA, title: "Starts soon", liveBroadcastContent: "upcoming" } },
    ],
  };
  expect(parseVideosList(json).map((v) => v.videoId)).toEqual(["aaa"]);
});

test("parsers survive junk without throwing", () => {
  for (const junk of [null, undefined, {}, { items: null }, { items: [null, 42, {}] }]) {
    expect(parseVideosList(junk)).toEqual([]);
    expect(parseSearchList(junk)).toEqual([]);
  }
});

test("search.list ids are read from the nested id.videoId", () => {
  const json = { items: [{ id: { kind: "youtube#video", videoId: "zzz" }, snippet: { channelId: NASA, title: "T" } }] };
  expect(parseSearchList(json)).toEqual([{ videoId: "zzz", channelId: NASA, title: "T" }]);
});

// --- picking ---------------------------------------------------------------

const candidates: LiveVideo[] = [
  { videoId: "official", channelId: NASA, title: "Live Video from the ISS (Official NASA Broadcast)" },
  { videoId: "hd", channelId: NASA, title: "Live High-Definition Views from the ISS" },
  { videoId: "other", channelId: "UCother", title: "Something else" },
];

test("match picks the intended stream when a channel runs several at once", () => {
  expect(pickLiveVideo(candidates, { channelId: NASA, match: "High-Definition" })?.videoId).toBe("hd");
  expect(pickLiveVideo(candidates, { channelId: NASA, match: "Official NASA" })?.videoId).toBe("official");
});

test("match is a preference, not a filter — an unmatched hint still plays the channel", () => {
  expect(pickLiveVideo(candidates, { channelId: NASA, match: "nothing like this" })?.videoId).toBe("official");
});

test("a channel with nothing live resolves to null", () => {
  expect(pickLiveVideo(candidates, { channelId: "UCnope" })).toBeNull();
});

test("requestKey distinguishes two entries sharing one channel", () => {
  // NASA backs both "NASA TV" and "ISS Live". Keying on channelId alone made the
  // second silently inherit the first one's video.
  const a = requestKey({ channelId: NASA, match: "Official NASA" });
  const b = requestKey({ channelId: NASA, match: "High-Definition" });
  expect(a).not.toBe(b);
  expect(requestKey({ channelId: NASA, match: "HIGH-definition " })).toBe(b);
});

// --- quota plan ------------------------------------------------------------

test("planRediscovery only sends the rotated channels to the expensive call", () => {
  const { resolved, needSearch } = planRediscovery(
    [{ channelId: NASA }, { channelId: "UCgone" }],
    [{ videoId: "official", channelId: NASA, title: "t" }],
  );
  expect(resolved).toHaveLength(1);
  expect(resolved[0].via).toBe("cached");
  expect(needSearch.map((r) => r.channelId)).toEqual(["UCgone"]);
});

test("chunk batches ids for the 50-per-call videos.list limit", () => {
  expect(chunk(Array.from({ length: 120 }, (_, i) => i), 50).map((c) => c.length)).toEqual([50, 50, 20]);
  expect(chunk([], 50)).toEqual([]);
});

// --- network behaviour -----------------------------------------------------

test("no API key: dormant, and it does not touch the network", async () => {
  globalThis.fetch = (() => {
    throw new Error("resolveLiveVideos must not call fetch when dormant");
  }) as unknown as typeof fetch;
  const out = await resolveLiveVideos([{ channelId: NASA }], new Map(), undefined);
  expect(out.dormant).toBe(true);
  expect(out.quotaSpent).toBe(0);
  expect(out.resolutions).toEqual([{ channelId: NASA, videoId: null, title: null, via: "unresolved" }]);
});

test("everything still live costs ONE unit, however many channels", async () => {
  const ids = Array.from({ length: 40 }, (_, i) => `ch${i}`);
  const known = new Map(ids.map((c) => [requestKey({ channelId: c }), `vid${c}`]));
  globalThis.fetch = vi.fn(async () =>
    new Response(
      JSON.stringify({
        items: ids.map((c) => ({ id: `vid${c}`, snippet: { channelId: c, title: "t", liveBroadcastContent: "live" } })),
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ) as unknown as typeof fetch;

  const out = await resolveLiveVideos(ids.map((c) => ({ channelId: c })), known, "k");
  expect(out.quotaSpent).toBe(COST_VIDEOS_LIST);
  expect(out.resolutions.every((r) => r.via === "cached")).toBe(true);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
});

test("a rotated channel costs a search, and the answer is the new video", async () => {
  globalThis.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/videos?")) {
      // Old id came back not-live: the stream restarted.
      return new Response(JSON.stringify({ items: [{ id: "old", snippet: { channelId: NASA, title: "t", liveBroadcastContent: "none" } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ items: [{ id: { videoId: "new" }, snippet: { channelId: NASA, title: "fresh" } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const known = new Map([[requestKey({ channelId: NASA }), "old"]]);
  const out = await resolveLiveVideos([{ channelId: NASA }], known, "k");
  expect(out.resolutions[0]).toMatchObject({ videoId: "new", via: "search" });
  expect(out.quotaSpent).toBe(COST_VIDEOS_LIST + COST_SEARCH_LIST);
});

test("an upstream failure resolves to null rather than a stale id or a throw", async () => {
  globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
  const known = new Map([[requestKey({ channelId: NASA }), "old"]]);
  const out = await resolveLiveVideos([{ channelId: NASA }], known, "k");
  // Critically NOT "old": presenting a dead stream as live is the bug, not the fix.
  expect(out.resolutions[0].videoId).toBeNull();
  expect(out.resolutions[0].via).toBe("unresolved");
});

test("resolutions come back in request order", async () => {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 })) as unknown as typeof fetch;
  const reqs = [{ channelId: "a" }, { channelId: "b" }, { channelId: "c" }];
  const out = await resolveLiveVideos(reqs, new Map(), "k");
  expect(out.resolutions.map((r) => r.channelId)).toEqual(["a", "b", "c"]);
});

// --- provider wiring -------------------------------------------------------

test("every YouTube provider now registers a channel id", () => {
  for (const p of NEWS_PROVIDERS) {
    if (p.kind !== "youtube") continue;
    expect(p.channelId, `${p.id} has no channelId`).toMatch(/^UC[A-Za-z0-9_-]{22}$/);
  }
});

test("NASA and ISS share a channel but request different streams", () => {
  const nasa = NEWS_PROVIDERS.find((p) => p.id === "nasa")!;
  const iss = NEWS_PROVIDERS.find((p) => p.id === "iss")!;
  expect(nasa.channelId).toBe(iss.channelId);
  expect(nasa.match).not.toBe(iss.match);
  // ...and both survive deduping into the request list.
  expect(newsChannelRequests().filter((r) => r.channelId === nasa.channelId)).toHaveLength(2);
});

test("embeds prefer the resolved id but fall back to the pinned ref", () => {
  const p = NEWS_PROVIDERS[0];
  expect(playableRef(p, "fresh123")).toBe("fresh123");
  expect(playableRef(p, undefined)).toBe(p.ref);
  expect(resolveEmbed(p, "fresh123").src).toContain("/embed/fresh123");
  expect(resolveEmbed(p, null).src).toContain(`/embed/${p.ref}`);
});

test("no embed anywhere still uses the retired live_stream endpoint", () => {
  // It renders "Error 153". Guarding it here so it cannot come back.
  for (const p of NEWS_PROVIDERS) {
    expect(resolveEmbed(p, "x").src).not.toContain("live_stream");
  }
});
