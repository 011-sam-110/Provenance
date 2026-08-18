import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebcamSample } from "@/lib/webcams/fetch";

// /api/webcams shipped 425 KB of JSON per request with NO cache header, so the edge
// never answered one: every visitor cost an invocation and a full re-serialisation of
// an answer that only changes when the 8-minute Windy sample rolls over.
//
// As with the camera memo, the string is identical either way, so what gets asserted
// is the WORK: the note is composed once per sample, and a replaced sample recomputes.

const describeWebcamSample = vi.fn(() => "one sample, described once");
vi.mock("@/lib/webcams/fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/webcams/fetch")>()),
  describeWebcamSample: () => describeWebcamSample(),
}));

const { webcamsBody, __resetWebcamsBody } = await import("@/app/api/webcams/route");

const webcam = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  title: `Webcam ${id}`,
  lat: 40.4,
  lon: -3.7,
  country: "ES",
  region: "Madrid",
  city: "Madrid",
  categories: ["square"],
  available: true,
  detailUrl: `https://www.windy.com/webcams/${id}`,
  imageUrl: `https://images.windy.com/${id}.jpg?token=SHORTLIVED`,
  thumbnailUrl: `https://images.windy.com/${id}-thumb.jpg?token=SHORTLIVED`,
  ...over,
});

const sampleOf = (...ids: string[]): WebcamSample =>
  ({
    webcams: ids.map((id) => webcam(id)),
    dormant: false,
    pagesOk: 4,
    pagesFailed: 0,
    statuses: [],
    mapping: null,
  }) as unknown as WebcamSample;

beforeEach(() => {
  __resetWebcamsBody();
  describeWebcamSample.mockClear();
});

describe("webcamsBody", () => {
  it("serialises once for a given sample", () => {
    const sample = sampleOf("a", "b", "c");

    const first = webcamsBody(sample);
    const second = webcamsBody(sample);

    expect(second).toBe(first);
    expect(describeWebcamSample).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when the registry publishes a new sample", () => {
    const before = sampleOf("a");
    const after = sampleOf("a", "b");

    expect(JSON.parse(webcamsBody(before)).count).toBe(1);
    describeWebcamSample.mockClear();
    expect(JSON.parse(webcamsBody(after)).count).toBe(2);
    expect(describeWebcamSample).toHaveBeenCalledTimes(1);
  });

  it("keys on identity, so two equal-looking samples are separate publications", () => {
    // refresh() builds a fresh sample each round. The memo cannot know two are equal
    // without doing the work it exists to avoid.
    webcamsBody(sampleOf("a"));
    describeWebcamSample.mockClear();
    webcamsBody(sampleOf("a"));

    expect(describeWebcamSample).toHaveBeenCalledTimes(1);
  });

  it("never lets a short-lived Windy image token into the response", () => {
    // The dossier re-resolves images through /api/webcam-image precisely because these
    // tokens expire in ~10 minutes. Caching the body makes leaking one worse, not
    // better, so the projection is pinned rather than trusted.
    const body = webcamsBody(sampleOf("windy:1"));

    expect(body).not.toContain("SHORTLIVED");
    expect(body).not.toContain("imageUrl");
    expect(body).not.toContain("thumbnailUrl");
    expect(JSON.parse(body).webcams[0]).toMatchObject({
      id: "windy:1",
      title: "Webcam windy:1",
      country: "ES",
      city: "Madrid",
      categories: ["square"],
      available: true,
    });
  });

  it("carries the layer's own explanation of what happened upstream", () => {
    const body = JSON.parse(webcamsBody(sampleOf("a")));
    expect(body.note).toBe("one sample, described once");
    expect(body.dormant).toBe(false);
    expect(typeof body.attribution).toBe("string");
  });
});
