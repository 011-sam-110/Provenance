import { describe, expect, test } from "vitest";
import { isAllowed } from "@/lib/proxy/allowlist";
import { CASTLEROCK_SYSTEMS, normalizeCastleRock } from "@/lib/sources/castlerock";
import { ADMITTED_FEEDS } from "@/lib/sources/discovered.data";
import { normalizeFeed } from "@/lib/discovery/normalize";
import laFixture from "@/tests/fixtures/castlerock-la.json";
import houstonFixture from "@/tests/fixtures/houston-transtar.json";

test("allows the TfL JamCam S3 bucket path", () => {
  expect(isAllowed(new URL("https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00001.07450.jpg"))).toBe(true);
});

test("rejects a different S3 bucket on the same host", () => {
  expect(isAllowed(new URL("https://s3-eu-west-1.amazonaws.com/some-other-bucket/secret.jpg"))).toBe(false);
});

test("rejects arbitrary hosts (SSRF guard)", () => {
  expect(isAllowed(new URL("http://169.254.169.254/latest/meta-data/"))).toBe(false);
  expect(isAllowed(new URL("https://evil.example.com/x.jpg"))).toBe(false);
});

test("rejects non-http(s) protocols", () => {
  expect(isAllowed(new URL("file:///etc/passwd"))).toBe(false);
  expect(isAllowed(new URL("gopher://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/x.jpg"))).toBe(false);
});

test("allows the Caltrans image host under /data/", () => {
  expect(isAllowed(new URL("https://cwwp2.dot.ca.gov/data/d11/cctv/image/cam1/cam1.jpg"))).toBe(true);
});
test("allows the SCDOT snapshot host under /thumbs/", () => {
  expect(isAllowed(new URL("https://scdotsnap.us-east-1.skyvdn.com/thumbs/50001.flv.png"))).toBe(true);
});
test("rejects those hosts outside their allowed prefix", () => {
  expect(isAllowed(new URL("https://cwwp2.dot.ca.gov/etc/secret.jpg"))).toBe(false);
  expect(isAllowed(new URL("https://scdotsnap.us-east-1.skyvdn.com/rtplive/x.ts"))).toBe(false);
});

// The port is part of the address. Matching only the hostname let a caller pick
// which port of an allowlisted host this deployment would connect to.
test("rejects an explicit non-default port on an allowlisted host", () => {
  expect(isAllowed(new URL("https://fl511.com:22/map/Cctv/1"))).toBe(false);
  expect(isAllowed(new URL("https://fl511.com:8443/map/Cctv/1"))).toBe(false);
  expect(isAllowed(new URL("http://cwwp2.dot.ca.gov:8080/data/d11/cctv/image/c/c.jpg"))).toBe(false);
});

test("still allows the scheme's own port, which URL normalises away", () => {
  // Written by hand as :443/:80, reported by URL as "". These are the same address
  // as the bare form, so refusing them would be refusing ordinary traffic.
  expect(isAllowed(new URL("https://fl511.com:443/map/Cctv/1"))).toBe(true);
  expect(isAllowed(new URL("https://cwwp2.dot.ca.gov:443/data/d11/cctv/image/c/c.jpg"))).toBe(true);
});

// A pin the proxy refuses draws on the map and opens no picture, and nothing else in
// the suite notices. Two networks shipped that way (Louisiana 2026-09-05, Houston
// TranStar 2026-08-20) and were found by an audit on 2026-10-16, not by a test. So the
// media a feed actually produces is checked here against the gate that serves it.
describe("every feed's own media passes the proxy gate", () => {
  test("every castlerock system's snapshot path", () => {
    for (const s of CASTLEROCK_SYSTEMS) {
      expect(isAllowed(new URL(`https://${s.site}/map/Cctv/1`)), s.site).toBe(true);
    }
  });

  test("Louisiana's captured rows", () => {
    const la = CASTLEROCK_SYSTEMS.find((s) => s.system === "la")!;
    const cams = normalizeCastleRock(laFixture as never, la);
    expect(cams.length).toBeGreaterThan(0);
    for (const c of cams) expect(isAllowed(new URL(c.imageUrl!)), c.imageUrl).toBe(true);
  });

  test("every admitted discovery feed, through its own descriptor", () => {
    const houston = ADMITTED_FEEDS.find((f) => f.key === "houston-transtar")!;
    const { cameras } = normalizeFeed(houston, houstonFixture);
    expect(cameras.length).toBe(3);
    for (const c of cameras) expect(isAllowed(new URL(c.imageUrl!)), c.imageUrl).toBe(true);
  });
});
