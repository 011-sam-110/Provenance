import { expect, test } from "vitest";
import fixture from "@/tests/fixtures/windy.json";
import {
  normalizeWindy,
  normalizeWindyWebcam,
  type WindyWebcam,
  type WindyListResponse,
} from "@/lib/sources/windy";
import { WebcamArray } from "@/lib/types";

test("normalizes the live fixture into schema-valid Webcams", () => {
  const cams = normalizeWindy(fixture as WindyListResponse);
  expect(cams.length).toBeGreaterThan(0);
  expect(() => WebcamArray.parse(cams)).not.toThrow();
});

test("maps id, title, coords, country and the attribution link", () => {
  const [first] = normalizeWindy(fixture as WindyListResponse);
  expect(first.id).toBe("windy:1420893641");
  expect(first.source).toBe("windy");
  expect(first.title).toBe("London: Trafalgar Square");
  expect(first.lat).toBeCloseTo(51.508, 3);
  expect(first.lon).toBeCloseTo(-0.128, 3);
  expect(first.country).toBe("GB");
  expect(first.attribution).toBe("Webcams provided by windy.com - add new webcam");
  expect(first.available).toBe(true);
});

test("prefers the larger preview image, falling back through thumbnail → icon", () => {
  const preview: WindyWebcam = {
    webcamId: 1,
    title: "Preview wins",
    status: "active",
    images: { current: { icon: "https://h/i.jpg", thumbnail: "https://h/t.jpg", preview: "https://h/p.jpg" } },
    location: { latitude: 10, longitude: 20, country_code: "us" },
  };
  expect(normalizeWindyWebcam(preview)!.imageUrl).toBe("https://h/p.jpg");

  const thumbOnly: WindyWebcam = { ...preview, images: { current: { icon: "https://h/i.jpg", thumbnail: "https://h/t.jpg" } } };
  expect(normalizeWindyWebcam(thumbOnly)!.imageUrl).toBe("https://h/t.jpg");
});

test("synthesizes a Windy detail URL when urls.detail is absent", () => {
  const noUrl: WindyWebcam = {
    webcamId: 42,
    title: "No detail url",
    status: "active",
    location: { latitude: 1, longitude: 2, country_code: "de" },
  };
  expect(normalizeWindyWebcam(noUrl)!.detailUrl).toBe("https://www.windy.com/webcams/42");
});

test("drops webcams missing an id, a location, or with out-of-range coords", () => {
  expect(normalizeWindyWebcam({ title: "no id", location: { latitude: 1, longitude: 2 } })).toBeNull();
  expect(normalizeWindyWebcam({ webcamId: 1, title: "no loc", location: null })).toBeNull();
  expect(
    normalizeWindyWebcam({ webcamId: 2, title: "bad coords", location: { latitude: 999, longitude: 2 } }),
  ).toBeNull();
});

test("country code is upper-cased to ISO-3166 alpha-2", () => {
  const lower: WindyWebcam = {
    webcamId: 7,
    title: "lower",
    status: "active",
    location: { latitude: 1, longitude: 2, country_code: "fr" },
  };
  expect(normalizeWindyWebcam(lower)!.country).toBe("FR");
});

// Windy's Terms of Use name both links; the "add new webcam" one was missing.
test("the credit carries Windy's required add-new-webcam link", async () => {
  const { WINDY_ADD_WEBCAM_URL, WINDY_HOME_URL } = await import("@/lib/sources/windy");
  expect(WINDY_ADD_WEBCAM_URL).toBe("https://www.windy.com/webcams/add");
  expect(WINDY_HOME_URL).toBe("https://www.windy.com/");
  const fs = await import("node:fs");
  const detail = fs.readFileSync("components/WebcamDetail.tsx", "utf8");
  expect(detail).toContain("WINDY_ADD_WEBCAM_URL");
  expect(detail).toContain("add new webcam");
});
