import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/digitraffic-stations.json";
import { normalizeDigitraffic } from "@/lib/sources/digitraffic";
import { CameraArray } from "@/lib/types";

test("normalizes Digitraffic stations, skipping null-geometry and preset-less ones", () => {
  const cams = normalizeDigitraffic(fixture as never);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams).toHaveLength(2); // C00000 (null geom) + C11111 (no presets) skipped
});

test("builds the image URL from the active preset; maps region + availability", () => {
  const [a, b] = normalizeDigitraffic(fixture as never);
  expect(a.id).toBe("digitraffic:C01503");
  expect(a.country).toBe("FI");
  expect(a.region).toBe("Finland");
  expect(a.name).toBe("kt51_Inkoo");
  // First in-collection preset is C0150302 (not the first listed).
  expect(a.imageUrl).toBe("https://weathercam.digitraffic.fi/C0150302.jpg");
  expect(a.mediaType).toBe("jpeg");
  expect(a.available).toBe(true); // GATHERING
  expect(b.available).toBe(false); // REMOVED_TEMPORARILY
  expect(b.imageUrl).toBe("https://weathercam.digitraffic.fi/C9999901.jpg");
});

// Audit 2026-10-16: 17 GATHERING stations had frames from 7 h to ~283 days old and
// were shown live, because the adapter never read /stations/data.
test("a GATHERING station whose newest frame is over an hour old is not live", async () => {
  const { normalizeDigitraffic, presetFrameTimes, MAX_FRAME_AGE_MS } = await import("@/lib/sources/digitraffic");
  const now = Date.parse("2026-10-16T20:45:00Z");
  const times = presetFrameTimes({
    stations: [
      {
        presets: [
          { id: "C0150301", measuredTime: "2026-10-16T20:38:04Z" }, // not in collection
          { id: "C0150302", measuredTime: "2025-12-29T09:00:00Z" }, // ~283 days old
        ],
      },
    ],
  });
  expect(times.get("C0150302")).toBe(Date.parse("2025-12-29T09:00:00Z"));
  const inkoo = normalizeDigitraffic(fixture as never, times, now).find((c) => c.id === "digitraffic:C01503")!;
  expect(inkoo.available).toBe(false);
  expect(inkoo.lastSampledAt).toBe("2025-12-29T09:00:00.000Z");

  const fresh = presetFrameTimes({ stations: [{ presets: [{ id: "C0150302", measuredTime: new Date(now - MAX_FRAME_AGE_MS + 60_000).toISOString() }] }] });
  expect(normalizeDigitraffic(fixture as never, fresh, now).find((c) => c.id === "digitraffic:C01503")!.available).toBe(true);
  // No frame times at all (the read failed): the station flag alone decides, as before.
  expect(normalizeDigitraffic(fixture as never).find((c) => c.id === "digitraffic:C01503")!.available).toBe(true);
});

test("the freshest preset in collection is the one shown", async () => {
  const { normalizeDigitraffic } = await import("@/lib/sources/digitraffic");
  const now = Date.parse("2026-10-16T20:45:00Z");
  const station = {
    type: "Feature",
    id: "C77777",
    geometry: { type: "Point", coordinates: [25, 62, 0] },
    properties: {
      id: "C77777",
      name: "vt9_Test",
      collectionStatus: "GATHERING",
      presets: [
        { id: "C7777701", inCollection: true },
        { id: "C7777702", inCollection: true },
      ],
    },
  };
  const times = new Map([
    ["C7777701", Date.parse("2026-01-01T00:00:00Z")],
    ["C7777702", Date.parse("2026-10-16T20:40:00Z")],
  ]);
  const [cam] = normalizeDigitraffic({ features: [station] } as never, times, now);
  expect(cam.imageUrl).toBe("https://weathercam.digitraffic.fi/C7777702.jpg");
  expect(cam.available).toBe(true);
});
