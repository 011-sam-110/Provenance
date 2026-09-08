import { describe, expect, it } from "vitest";
import { BASEMAPS, DARK_FALLBACK_STYLE, DARK_STYLE_URL, type BasemapKey } from "@/lib/basemaps";

/**
 * The hero globe's basemap, pinned.
 *
 * WHY THIS FILE EXISTS. On 2026-09-08 the landing page was serving its hero globe with
 * a diagonal "API KEY REQUIRED · carto.com/basemaps/apikey" watermark repeated across
 * the whole sphere, in production, behind a headline reading "You already paid for
 * this." CARTO had begun stamping unauthenticated tiles from basemaps.cartocdn.com.
 *
 * NOTHING COULD HAVE CAUGHT IT, and that is the part worth fixing rather than the URL.
 * The watermarked tiles came back HTTP 200 at a normal size, so there was no failed
 * request, no console error, and lib/map/resilience.ts never fired because nothing
 * failed. The only detector was a person looking at the page.
 *
 * A unit test cannot look at a picture, so it pins the next-best thing: the hero's
 * basemap must not be served by a host that does this to us. That is a weaker check
 * than "is there a watermark", and it is deliberately weaker — see the note on the
 * last case about what still has to be done by eye.
 */
describe("hero basemap", () => {
  it("is not served by CARTO, which watermarks unauthenticated tiles", () => {
    expect(DARK_STYLE_URL).not.toMatch(/cartocdn\.com/);
    expect(JSON.stringify(DARK_FALLBACK_STYLE)).not.toMatch(/cartocdn\.com/);
  });

  it("uses a keyless style URL with no credential in it", () => {
    // A key smuggled into the URL would silence the watermark and put a secret in the
    // client bundle to do it. If this layer ever needs a key, that is a decision to
    // take deliberately and not a way to make this file pass.
    expect(DARK_STYLE_URL).toMatch(/^https:\/\//);
    expect(DARK_STYLE_URL).not.toMatch(/[?&](api_?key|key|token|access_token)=/i);
  });

  it("keeps an INLINE floor under the remote style", () => {
    // The hero's style is a URL now, so for the first time it can fail on the style
    // document itself — and HeroGlobe adds every signal layer inside `style.load`, so
    // that failure costs the data as well as the basemap. The floor has to be an
    // object rather than another URL for the same reason fallbackBasemap() only ever
    // falls back to inline styles: a remote style is exactly what just failed.
    expect(typeof DARK_FALLBACK_STYLE).toBe("object");
    expect(DARK_FALLBACK_STYLE.version).toBe(8);
    // It must paint a ground. An empty style renders the page background through the
    // canvas, which on the light landing sections is WHITE — the exact regression
    // lib/basemaps.ts warns about beside this style.
    const bg = DARK_FALLBACK_STYLE.layers.find((l) => l.type === "background");
    expect(bg).toBeDefined();
  });

  it("does not smuggle the hero back into the basemap switcher", () => {
    // Dark left the registry with the console's dark skin. Every switcher iterates
    // Object.keys(BASEMAPS), so re-adding it here would put the night stage in the
    // console's basemap list as a side effect of a marketing-page fix.
    expect(Object.keys(BASEMAPS)).not.toContain("dark" as BasemapKey);
  });

  it("WARNING: cannot detect a watermark, only a known-bad host", () => {
    // Kept as an executable comment. A provider that starts stamping its tiles
    // tomorrow serves them with the same 200 and the same byte-ish size, and every
    // assertion above still passes. The check that would have caught the CARTO
    // change is visual — scripts/verify-provenance.mjs shoots the hero, and somebody
    // has to look at it. Do not read a green suite here as "the hero looks right".
    expect(DARK_STYLE_URL).toBeTypeOf("string");
  });
});
