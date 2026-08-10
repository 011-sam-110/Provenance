import { describe, expect, test } from "vitest";
import { repairUrl, toWebcams, type WebcamMapping } from "@/lib/webcams/normalize";
import { describeWebcamSample, fetchWebcamSample, type WebcamSample } from "@/lib/webcams/fetch";
import type { WindyWebcam } from "@/lib/sources/windy";

// The row that emptied the whole layer. Captured VERBATIM from a live
// api.windy.com/webcams/api/v3/webcams/1644848004 response on 2026-08-10 (HTTP
// 200) — `urls.provider` has no scheme, which z.string().url() rejects. Under
// the old whole-array WebcamArray.parse() this ONE row threw and took all ~1,180
// good webcams with it, which is why /api/webcams served 0 with a working key.
const REAL_BAD_ROW: WindyWebcam = {
  webcamId: 1644848004,
  title: "Providenciales › South-east: Long Bay Beach",
  status: "active",
  urls: {
    detail: "https://windy.com/webcams/1644848004",
    edit: "https://webcams-admin.windy.com/webcams/1644848004",
    provider: "www.villaesencia.com/live",
  },
  location: {
    latitude: 21.78836,
    longitude: -72.15353,
    country_code: "TC",
    region: "Providenciales",
    city: "Providenciales",
  },
};

// Also captured live on 2026-08-10 from the uk-ireland bbox page.
const REAL_GOOD_ROW: WindyWebcam = {
  webcamId: 1420893641,
  title: "London: Trafalgar Square",
  status: "active",
  lastUpdatedOn: "2026-08-10T09:19:41.000Z",
  categories: [{ id: "city", name: "City" }, { id: "traffic", name: "Traffic" }],
  images: {
    current: {
      icon: "https://imgproxy.windy.com/_/icon/plain/current/1420893641/original.jpg",
      thumbnail: "https://imgproxy.windy.com/_/thumbnail/plain/current/1420893641/original.jpg",
      preview: "https://imgproxy.windy.com/_/preview/plain/current/1420893641/original.jpg",
    },
  },
  location: {
    city: "London",
    region: "England",
    country: "United Kingdom",
    country_code: "GB",
    latitude: 51.5074,
    longitude: -0.12765,
  },
  urls: { detail: "https://windy.com/webcams/1420893641" },
};

describe("repairUrl", () => {
  test("passes a well-formed URL through untouched", () => {
    expect(repairUrl("https://example.com/live")).toBe("https://example.com/live");
  });

  test("adds https:// to a scheme-less host (the real Windy provider link)", () => {
    expect(repairUrl("www.villaesencia.com/live")).toBe("https://www.villaesencia.com/live");
  });

  test("returns undefined for empty or unusable values", () => {
    expect(repairUrl(undefined)).toBeUndefined();
    expect(repairUrl("")).toBeUndefined();
    expect(repairUrl("   ")).toBeUndefined();
    expect(repairUrl("not a url at all")).toBeUndefined();
    expect(repairUrl("n/a")).toBeUndefined();
  });
});

describe("toWebcams — one bad row cannot empty the batch", () => {
  test("the real malformed row is REPAIRED and kept alongside the good rows", () => {
    const m: WebcamMapping = toWebcams([REAL_GOOD_ROW, REAL_BAD_ROW]);
    expect(m.webcams).toHaveLength(2);
    expect(m.invalid).toBe(0);
    expect(m.repaired).toBe(1);
    const providenciales = m.webcams.find((w) => w.id === "windy:1644848004");
    expect(providenciales?.providerUrl).toBe("https://www.villaesencia.com/live");
    expect(providenciales?.detailUrl).toBe("https://windy.com/webcams/1644848004");
  });

  test("an unrepairable optional URL costs the FIELD, not the webcam", () => {
    const junkProvider: WindyWebcam = {
      ...REAL_BAD_ROW,
      webcamId: 999001,
      urls: { detail: "https://windy.com/webcams/999001", provider: "see description" },
    };
    const m = toWebcams([junkProvider]);
    expect(m.webcams).toHaveLength(1);
    expect(m.webcams[0].providerUrl).toBeUndefined();
    expect(m.invalid).toBe(0);
  });

  test("a malformed REQUIRED detail URL falls back to the canonical Windy page", () => {
    const badDetail: WindyWebcam = {
      ...REAL_GOOD_ROW,
      webcamId: 999002,
      urls: { detail: "windy.com/webcams/999002" },
    };
    const m = toWebcams([badDetail]);
    expect(m.webcams).toHaveLength(1);
    expect(m.webcams[0].detailUrl).toBe("https://windy.com/webcams/999002");
  });

  test("a genuinely unusable row is dropped alone, the rest survive", () => {
    const noCoords: WindyWebcam = { webcamId: 999003, title: "nowhere", location: null };
    const m = toWebcams([REAL_GOOD_ROW, noCoords, REAL_BAD_ROW]);
    expect(m.webcams.map((w) => w.id)).toEqual(["windy:1420893641", "windy:1644848004"]);
    expect(m.unmappable).toBe(1);
  });

  test("deduplicates repeat ids from the overlapping region bboxes", () => {
    const m = toWebcams([REAL_GOOD_ROW, { ...REAL_GOOD_ROW }, REAL_BAD_ROW]);
    expect(m.webcams).toHaveLength(2);
    expect(m.duplicates).toBe(1);
  });

  test("respects the sample cap", () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...REAL_GOOD_ROW, webcamId: 5_000_000 + i }));
    expect(toWebcams(rows, 5).webcams).toHaveLength(5);
  });

  test("never throws on empty or garbage input", () => {
    expect(toWebcams([]).webcams).toEqual([]);
    expect(toWebcams([{} as WindyWebcam]).unmappable).toBe(1);
  });
});

describe("fetchWebcamSample dormancy", () => {
  test("no key → dormant, empty, no network, no throw", async () => {
    const sample = await fetchWebcamSample("");
    expect(sample).toMatchObject({ dormant: true, webcams: [], pagesOk: 0, pagesFailed: 0 });
  });
});

describe("describeWebcamSample — the note is honest in every state", () => {
  const base: WebcamSample = {
    webcams: [],
    dormant: false,
    pagesOk: 0,
    pagesFailed: 0,
    statuses: [],
    mapping: null,
  };

  test("names the missing env var when dormant", () => {
    expect(describeWebcamSample({ ...base, dormant: true })).toContain("WINDY_WEBCAMS_API_KEY");
  });

  test("says the key was rejected, with the status, on 401", () => {
    const note = describeWebcamSample({ ...base, pagesFailed: 28, statuses: [401] });
    expect(note).toContain("rejected");
    expect(note).toContain("401");
  });

  test("reports the real counts on a healthy sample", () => {
    const mapping = toWebcams([REAL_GOOD_ROW, REAL_BAD_ROW]);
    const note = describeWebcamSample({ ...base, webcams: mapping.webcams, pagesOk: 28, mapping });
    expect(note).toContain("2 webcams from 28/28");
    expect(note).toContain("1 link repaired");
  });
});
