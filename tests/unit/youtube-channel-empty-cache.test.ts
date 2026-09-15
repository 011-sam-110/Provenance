import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getChannelLive, __resetYoutubeRegistry } from "@/lib/youtube/registry";

// `?channel=` costs a 100-unit search.list. A channel with nothing live used to be
// re-asked on every open, so 100 opens of a quiet channel spent the whole 10,000-unit
// daily quota — and after that the shared news-channel resolution failed too.
// "Nothing live" is now held for two minutes: short enough that a stream that starts
// soon is still found, long enough that repeated opens cost one search.

const QUIET = "UCLA_DiR1FfKNvjuUpBHmylQ";
const realFetch = globalThis.fetch;
const realKey = process.env.YOUTUBE_API_KEY;
let calls = 0;

beforeEach(() => {
  __resetYoutubeRegistry();
  process.env.YOUTUBE_API_KEY = "test-key";
  calls = 0;
  globalThis.fetch = vi.fn(async () => {
    calls += 1;
    return Response.json({ items: [] });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.YOUTUBE_API_KEY;
  else process.env.YOUTUBE_API_KEY = realKey;
  vi.restoreAllMocks();
});

test("a second open of a quiet channel inside two minutes spends no quota", async () => {
  const base = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(base);
  const first = await getChannelLive(QUIET);
  now.mockReturnValue(base + 60_000);
  const second = await getChannelLive(QUIET);
  expect(first.videos).toEqual([]);
  expect(second.videos).toEqual([]);
  expect(calls).toBe(1);
});

test("after two minutes a quiet channel is asked again, so a new stream is found", async () => {
  const base = Date.now();
  const now = vi.spyOn(Date, "now").mockReturnValue(base);
  await getChannelLive(QUIET);
  now.mockReturnValue(base + 120_001);
  await getChannelLive(QUIET);
  expect(calls).toBe(2);
});
