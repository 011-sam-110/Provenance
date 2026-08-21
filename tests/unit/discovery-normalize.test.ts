import { describe, it, expect } from "vitest";
import { normalizeFeed, resolveMediaUrl } from "@/lib/discovery/normalize";
import type { FeedDescriptor } from "@/lib/discovery/types";

const DESCRIPTOR: FeedDescriptor = {
  key: "example-dot",
  name: "Example Department of Transportation",
  country: "US",
  endpoint: "https://cameras.example.gov/api/v1/cameras",
  format: "json",
  mapping: {
    id: "cameraId",
    name: "displayName",
    lat: "location.latitude",
    lon: "location.longitude",
    imageUrl: "imageUrl",
    road: "roadway",
  },
  license: "Example DOT Open Data Licence",
  attribution: "Live camera imagery (c) Example DOT",
  refreshSeconds: 120,
};

function rows(n = 5, patch: (i: number) => Record<string, unknown> = () => ({})) {
  return Array.from({ length: n }, (_, i) => ({
    cameraId: "CAM-" + i,
    displayName: "I-5 at Mile " + i,
    roadway: "I-5",
    location: { latitude: 47.5 + i * 0.01, longitude: -122.3 - i * 0.01 },
    imageUrl: "https://images.example.gov/" + i + ".jpg",
    ...patch(i),
  }));
}

describe("resolveMediaUrl", () => {
  it("makes a relative URL absolute against the endpoint", () => {
    expect(resolveMediaUrl("/img/4.jpg", DESCRIPTOR.endpoint)).toBe("https://cameras.example.gov/img/4.jpg");
  });

  it("refuses a bare-IP host, which is somebody's leaked camera and not a feed", () => {
    expect(resolveMediaUrl("http://93.184.216.34:8080/mjpg", DESCRIPTOR.endpoint)).toBeUndefined();
    expect(resolveMediaUrl("http://[2606:2800:220:1::]/cam.jpg", DESCRIPTOR.endpoint)).toBeUndefined();
  });

  it("refuses a scheme a browser cannot fetch", () => {
    expect(resolveMediaUrl("rtsp://cams.example.gov/1", DESCRIPTOR.endpoint)).toBeUndefined();
  });

  it("returns undefined rather than throwing on junk", () => {
    expect(resolveMediaUrl("", DESCRIPTOR.endpoint)).toBeUndefined();
    expect(resolveMediaUrl(null, DESCRIPTOR.endpoint)).toBeUndefined();
    expect(resolveMediaUrl({ nope: 1 }, DESCRIPTOR.endpoint)).toBeUndefined();
  });
});

describe("normalizeFeed", () => {
  it("turns rows into schema-valid cameras under the descriptor's mapping", () => {
    const out = normalizeFeed(DESCRIPTOR, rows(5));
    expect(out.cameras).toHaveLength(5);
    expect(out.rows).toBe(5);
    const c = out.cameras[0];
    expect(c.id).toBe("example-dot:CAM-0");
    expect(c.source).toBe("example-dot");
    expect(c.country).toBe("US");
    expect(c.lat).toBeCloseTo(47.5);
    expect(c.lon).toBeCloseTo(-122.3);
    expect(c.mediaType).toBe("jpeg");
    expect(c.license).toBe(DESCRIPTOR.license);
    expect(c.refreshSeconds).toBe(120);
    expect(c.road).toBe("I-5");
  });

  it("takes the country from the descriptor, never from the data", () => {
    // Feeds spell their own country four different ways and CameraSchema wants two
    // characters. The value that ships is the one a human wrote when they admitted it.
    const out = normalizeFeed(DESCRIPTOR, rows(3, () => ({ country: "United States of America" })));
    expect(out.cameras.every((c) => c.country === "US")).toBe(true);
  });

  it("drops Null Island rather than pinning a network at 0,0", () => {
    const out = normalizeFeed(DESCRIPTOR, rows(4, (i) => (i === 1 ? { location: { latitude: 0, longitude: 0 } } : {})));
    expect(out.cameras).toHaveLength(3);
    expect(out.dropped.badCoord).toBe(1);
  });

  it("drops a row with no picture and no stream, and says so", () => {
    const out = normalizeFeed(DESCRIPTOR, rows(4, (i) => (i === 2 ? { imageUrl: null } : {})));
    expect(out.cameras).toHaveLength(3);
    expect(out.dropped.noMedia).toBe(1);
  });

  it("drops a repeated native id instead of overwriting the first camera", () => {
    const out = normalizeFeed(DESCRIPTOR, rows(4, (i) => (i === 3 ? { cameraId: "CAM-0" } : {})));
    expect(out.cameras).toHaveLength(3);
    expect(out.dropped.duplicateId).toBe(1);
  });

  it("drops an out-of-range coordinate", () => {
    const out = normalizeFeed(DESCRIPTOR, rows(3, (i) => (i === 0 ? { location: { latitude: 947.5, longitude: -122 } } : {})));
    expect(out.cameras).toHaveLength(2);
    expect(out.dropped.badCoord).toBe(1);
  });

  it("drops a bare-IP camera silently from the cameras but not from the tally", () => {
    const out = normalizeFeed(
      DESCRIPTOR,
      rows(3, (i) => (i === 1 ? { imageUrl: "http://10.20.30.40/axis-cgi/jpg" } : {})),
    );
    expect(out.cameras).toHaveLength(2);
    expect(out.dropped.noMedia).toBe(1);
  });

  it("reads a wrapped row array through rowsPath", () => {
    const wrapped = { status: "ok", result: { records: rows(3) } };
    const out = normalizeFeed({ ...DESCRIPTOR, rowsPath: "result.records" }, wrapped);
    expect(out.cameras).toHaveLength(3);
  });

  it("reads a GeoJSON layer through the synthetic geometry keys", () => {
    const geo = {
      type: "FeatureCollection",
      features: Array.from({ length: 3 }, (_, i) => ({
        type: "Feature",
        properties: { ref: "G" + i, title: "Camera " + i, snap: "https://img.example.gov/" + i + ".jpg" },
        geometry: { type: "Point", coordinates: [-122.3 - i * 0.01, 47.5 + i * 0.01] },
      })),
    };
    const out = normalizeFeed(
      {
        ...DESCRIPTOR,
        format: "geojson",
        mapping: { id: "ref", name: "title", lat: "__lat", lon: "__lon", imageUrl: "snap" },
      },
      geo,
    );
    expect(out.cameras).toHaveLength(3);
    expect(out.cameras[0].lat).toBeCloseTo(47.5);
    expect(out.cameras[0].lon).toBeCloseTo(-122.3);
  });

  it("marks mediaType from what the feed actually carries", () => {
    const both = normalizeFeed(
      { ...DESCRIPTOR, mapping: { ...DESCRIPTOR.mapping, streamUrl: "hls" } },
      rows(1, () => ({ hls: "https://stream.example.gov/1.m3u8" })),
    );
    expect(both.cameras[0].mediaType).toBe("both");

    const videoOnly = normalizeFeed(
      { ...DESCRIPTOR, mapping: { id: "cameraId", name: "displayName", lat: "location.latitude", lon: "location.longitude", streamUrl: "hls" } },
      rows(1, () => ({ hls: "https://stream.example.gov/1.m3u8" })),
    );
    expect(videoOnly.cameras[0].mediaType).toBe("video");
  });

  it("returns an empty result rather than throwing on a body of the wrong shape", () => {
    expect(normalizeFeed(DESCRIPTOR, { unexpected: true }).cameras).toEqual([]);
    expect(normalizeFeed(DESCRIPTOR, null).cameras).toEqual([]);
    expect(normalizeFeed(DESCRIPTOR, "a string").cameras).toEqual([]);
  });
});

describe("upgradeMediaToHttps", () => {
  /**
   * Catalogues publish the URL the operator wrote down, and plenty of agencies still
   * write http:// for a host that has served https for years. Those pictures are
   * blocked as mixed content on an https page, so the cameras are real, reviewed and
   * invisible.
   *
   * The upgrade is OPT-IN PER FEED rather than blanket, because "http worked, https
   * must too" is an assumption and this repository does not ship those. The flag is
   * set only after the https URL has actually been fetched and returned an image.
   */
  it("upgrades http media to https when the feed opts in", () => {
    const feed: FeedDescriptor = { ...DESCRIPTOR, upgradeMediaToHttps: true };
    const { cameras } = normalizeFeed(feed, rows(1, () => ({ imageUrl: "http://images.example.gov/0.jpg" })));
    expect(cameras[0].imageUrl).toBe("https://images.example.gov/0.jpg");
  });

  it("leaves http alone when the feed has not opted in", () => {
    const { cameras } = normalizeFeed(DESCRIPTOR, rows(1, () => ({ imageUrl: "http://images.example.gov/0.jpg" })));
    expect(cameras[0].imageUrl).toBe("http://images.example.gov/0.jpg");
  });

  it("does not touch a URL that is already https", () => {
    const feed: FeedDescriptor = { ...DESCRIPTOR, upgradeMediaToHttps: true };
    const { cameras } = normalizeFeed(feed, rows(1, () => ({ imageUrl: "https://images.example.gov/0.jpg" })));
    expect(cameras[0].imageUrl).toBe("https://images.example.gov/0.jpg");
  });
});
