import { describe, expect, it } from "vitest";
import { CAMSLOT_WIDGET, camslotTitle } from "@/lib/console/widgets/camslot";

// WHAT THIS GUARDS. WidgetFrame renders `type.title` for every instance, so four
// camera walls on the Streets board all read "CAMERA WALL" while their configs said
// London, Madrid and Prague. `titleOf` is the registry hook that lets an instance
// name itself; the frame falls back to `type.title` when it returns undefined.
//
// The contract has exactly one hard rule: it must never return "". An empty string
// is not a fallback — the frame would render a blank header and the widget would be
// less identifiable than before the fix. Every case below asserts it, including the
// ones that are supposed to return undefined.

/** Anything `titleOf` returns must be either undefined or non-empty. Asserted on
 *  every case rather than only the interesting ones, because "" can only arrive
 *  through a path nobody expected it on. */
function neverBlank(out: string | undefined): string | undefined {
  expect(out).not.toBe("");
  if (out !== undefined) expect(out.trim().length).toBeGreaterThan(0);
  return out;
}

const webcam = (id: string, t?: string) => (t ? { k: "webcam", id, t } : { k: "webcam", id });

describe("camslotTitle — name present", () => {
  it("returns the slot's own name, which is the whole point", () => {
    expect(neverBlank(camslotTitle({ name: "London", streams: [] }))).toBe("London");
  });

  it("the name wins over a stream that also has a title", () => {
    const out = camslotTitle({
      name: "London",
      streams: [webcam("windy:1420893641", "London: Trafalgar Square")],
    });
    expect(neverBlank(out)).toBe("London");
  });

  it("a whitespace-only name is not a name — it falls through, never to \"\"", () => {
    expect(neverBlank(camslotTitle({ name: "   ", streams: [] }))).toBeUndefined();
  });

  it("a padded name is trimmed", () => {
    expect(neverBlank(camslotTitle({ name: "  Madrid  ", streams: [] }))).toBe("Madrid");
  });
});

describe("camslotTitle — no name, one stream", () => {
  it("borrows the single webcam's own title", () => {
    const out = camslotTitle({ streams: [webcam("windy:1345327762", "Prague: Wenceslas Square")] });
    expect(neverBlank(out)).toBe("Prague: Wenceslas Square");
  });

  it("a lone webcam with no title falls back to the widget type, not to an id", () => {
    // "Webcam 1345327762" is a worse header than "Camera wall": it looks like a
    // name while telling the user nothing about where the picture is.
    expect(neverBlank(camslotTitle({ streams: [webcam("windy:1345327762")] }))).toBeUndefined();
  });

  it("a lone road camera has no cheap title in config, so it falls back", () => {
    // A `cam` ref carries an id and nothing else; resolving it means the camera
    // poller, which is a React hook. A header is not worth a fetch.
    expect(neverBlank(camslotTitle({ streams: [{ k: "cam", id: "tfl:JamCams_00001" }] }))).toBeUndefined();
  });

  it("a lone YouTube stream falls back", () => {
    expect(neverBlank(camslotTitle({ streams: [{ k: "yt", videoId: "dQw4w9WgXcQ" }] }))).toBeUndefined();
  });
});

describe("camslotTitle — no name, several streams", () => {
  it("a rotating slot has no single subject, so it does not borrow the first one's", () => {
    const out = camslotTitle({
      streams: [
        webcam("windy:1420893641", "London: Trafalgar Square"),
        webcam("windy:1606332744", "Madrid: Plaza Canalejas"),
      ],
    });
    expect(neverBlank(out)).toBeUndefined();
  });

  it("an empty slot falls back", () => {
    expect(neverBlank(camslotTitle({ streams: [] }))).toBeUndefined();
  });

  it("two streams where only ONE carries a title still falls back", () => {
    const out = camslotTitle({
      streams: [webcam("windy:1420893641", "London: Trafalgar Square"), webcam("windy:1606332744")],
    });
    expect(neverBlank(out)).toBeUndefined();
  });
});

describe("camslotTitle — garbage config", () => {
  // Config rides inside `?c=` share links, so a stranger's JSON reaches this
  // function. It must be total: never throw, never return "".
  const junk: unknown[] = [
    {},
    { name: 42, streams: "nope" },
    { name: null, streams: null },
    { streams: [null, 7, "cam", { k: "nope" }] },
    { name: "", streams: [{ k: "webcam", id: "windy:1", t: "   " }] },
    { streams: [{ k: "webcam", id: "windy:1", t: "" }] },
    { streams: { 0: webcam("windy:1", "Nope") } },
    { name: ["London"], streams: [] },
  ];

  for (const [i, raw] of junk.entries()) {
    it(`survives junk config #${i} and never returns ""`, () => {
      expect(() => camslotTitle(raw as Record<string, unknown>)).not.toThrow();
      expect(neverBlank(camslotTitle(raw as Record<string, unknown>))).toBeUndefined();
    });
  }

  it("a webcam whose only title is whitespace falls back rather than blanking the header", () => {
    const out = camslotTitle({ streams: [{ k: "webcam", id: "windy:1", t: "  \t " }] });
    expect(neverBlank(out)).toBeUndefined();
  });

  it("an over-long name is truncated by the sanitizer but stays non-empty", () => {
    const out = neverBlank(camslotTitle({ name: "x".repeat(500), streams: [] }));
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(80);
  });
});

describe("the registry entry actually carries it", () => {
  // Wiring test, not a logic test: `titleOf` only fixes anything if it is on the
  // object WidgetFrame reads. The four Streets walls stayed identical for exactly
  // this reason — `CamslotConfig.name` existed and was rendered nowhere.
  it("CAMSLOT_WIDGET exposes titleOf and it is the function under test", () => {
    const meta = CAMSLOT_WIDGET as { titleOf?: (c: Record<string, unknown>) => string | undefined };
    expect(typeof meta.titleOf).toBe("function");
    expect(meta.titleOf!({ name: "London", streams: [] })).toBe("London");
    expect(meta.titleOf!({ streams: [] })).toBeUndefined();
  });

  it("still declares a type title for the frame to fall back to", () => {
    expect(CAMSLOT_WIDGET.title.length).toBeGreaterThan(0);
  });
});
