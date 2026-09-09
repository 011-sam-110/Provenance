import { expect, test } from "vitest";
import { isAllowed } from "@/lib/proxy/allowlist";

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
