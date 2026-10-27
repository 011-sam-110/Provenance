import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { HLS_USER_AGENT, hlsUpstreamInit } from "@/lib/proxy/hls-upstream";

// The play check decides which cameras the map calls video, so it must ask an operator
// exactly as /api/hls does. Both call fetchHlsUpstream; these tests pin its request and
// fail if the route grows a fetch of its own again.

describe("the upstream HLS request", () => {
  it("sends the rule's Referer, the house User-Agent, and never follows a redirect", () => {
    const init = hlsUpstreamInit("https://cwwp2.dot.ca.gov/");
    expect(init.headers).toEqual({
      Referer: "https://cwwp2.dot.ca.gov/",
      "User-Agent": HLS_USER_AGENT,
      Accept: "*/*",
    });
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends an empty Referer where the rule has none, and passes a Range through", () => {
    const init = hlsUpstreamInit(undefined, "bytes=0-99");
    expect(init.headers).toMatchObject({ Referer: "", Range: "bytes=0-99" });
  });

  it("is the only fetch /api/hls makes", () => {
    const route = readFileSync(resolve(process.cwd(), "app/api/hls/route.ts"), "utf8");
    expect(route).toContain("fetchHlsUpstream(");
    expect(route).not.toMatch(/\bfetch\(/);
  });
});
