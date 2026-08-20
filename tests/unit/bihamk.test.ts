import { expect, test } from "vitest";
import {
  parsePortal,
  normalizeBihamk,
  imageUrl,
  MAX_FRAME_AGE_MS,
  BIHAMK_SOURCE,
  type BihamkProbe,
} from "@/lib/sources/bihamk";
import { BIHAMK_SITES } from "@/lib/sources/bihamk.data";
import { CameraArray } from "@/lib/types";
import { isAllowed } from "@/lib/proxy/allowlist";

const NOW = Date.UTC(2026, 7, 20, 13, 0, 0);
const fresh = (key: string, minsAgo = 3): BihamkProbe => ({
  key,
  lastModifiedMs: NOW - minsAgo * 60_000,
});

// Trimmed from the live portal on 2026-08-20. The `alt` labels are reproduced as
// the portal actually serves them — raw UTF-8 diacritics, not entities. Izačić is
// carried in the entity-encoded form as well (a second row below) so the decode
// path is exercised even though the operator does not currently use it.
const PORTAL_FIXTURE = `
<article class="w-full flex flex-col relative cursor-pointer group" wire:key="377">
  <figure class="relative">
    <img alt="GP Bijača" src="https://video-nadzor.bihamk.ba/videosurveillence/BIJACA.jpg?1787230577" width="234" height="200" class="w-full object-cover">
  </figure>
  <h3 class="truncate-all">GP Bijača</h3>
</article>
<article wire:key="376">
  <figure class="relative">
    <img alt="GP Iza&ccaron;i&cacute;" src="https://video-nadzor.bihamk.ba/videosurveillence/IZACIC.jpg?1787230577" width="234" height="200">
  </figure>
</article>
<article wire:key="378">
  <figure class="relative">
    <img alt="GP Brod - Ulaz u BiH" src="https://video-nadzor.bihamk.ba/videosurveillence/BROD1.jpg?1787230577" width="234" height="200">
  </figure>
</article>
<article wire:key="379">
  <figure class="relative">
    <img alt="GP Brod - Izlaz iz BiH" src="https://video-nadzor.bihamk.ba/videosurveillence/BROD2.jpg?1787230577" width="234" height="200">
  </figure>
</article>
<article wire:key="380">
  <figure class="relative">
    <img alt="Stupska petlja - HECO (Sarajevo)" src="https://video-nadzor.bihamk.ba/videosurveillence/STUP.jpg?1787230577" width="234" height="200">
  </figure>
</article>
<article wire:key="381">
  <figure class="relative">
    <img alt="RICO - Tuzla" src="https://video-nadzor.bihamk.ba/videosurveillence/SIPOREX.jpg?1787230577" width="234" height="200">
  </figure>
</article>
`;

test("lifts every camera off the portal, keeping the operator's own spelling", () => {
  const cams = parsePortal(PORTAL_FIXTURE);
  expect(cams.map((c) => c.key)).toEqual([
    "BIJACA",
    "IZACIC",
    "BROD1",
    "BROD2",
    "STUP",
    "SIPOREX",
  ]);
  // Passed through as served, not transliterated to "Bijaca".
  expect(cams[0].name).toBe("GP Bijača");
  // And decoded if the portal ever switches to entities, rather than shipping a
  // camera labelled "GP Iza&ccaron;i&cacute;".
  expect(cams[1].name).toBe("GP Izačić");
  expect(cams[4].name).toBe("Stupska petlja - HECO (Sarajevo)");
});

test("normalizes into schema-valid Cameras", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const cams = normalizeBihamk(portal, portal.map((c) => fresh(c.key)), NOW);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  expect(cams.every((c) => c.country === "BA")).toBe(true);
});

test("maps id, coords, image url and the operator's stated direction", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const cams = normalizeBihamk(portal, portal.map((c) => fresh(c.key)), NOW);
  const bijaca = cams.find((c) => c.id === "bihamk:BIJACA")!;
  expect(bijaca.source).toBe("bihamk");
  expect(bijaca.name).toBe("GP Bijača");
  expect(bijaca.lat).toBeCloseTo(43.123234, 6);
  expect(bijaca.lon).toBeCloseTo(17.574934, 6);
  expect(bijaca.imageUrl).toBe("https://video-nadzor.bihamk.ba/videosurveillence/BIJACA.jpg");
  expect(bijaca.mediaType).toBe("jpeg");
  expect(bijaca.attribution).toBe(BIHAMK_SOURCE.attribution);
  // Brod is ONE crossing with two views, so the coordinate is shared and only the
  // direction differs — and the direction is the operator's wording, not a guess
  // off the "1"/"2" in the filename.
  const in_ = cams.find((c) => c.id === "bihamk:BROD1")!;
  const out = cams.find((c) => c.id === "bihamk:BROD2")!;
  expect(in_.direction).toBe("Ulaz u BiH");
  expect(out.direction).toBe("Izlaz iz BiH");
  expect(in_.lat).toBe(out.lat);
  expect(in_.lon).toBe(out.lon);
});

// The whole point of ./bihamk.data.ts. Siporex/"RICO - Tuzla" is published by the
// operator and has no named OSM element to pin it to, so it must not reach the map
// at an invented coordinate — and it must not silently take a neighbour's either.
test("a camera with no defensible coordinate is dropped, not approximated", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const cams = normalizeBihamk(portal, portal.map((c) => fresh(c.key)), NOW);
  expect(portal.some((c) => c.key === "SIPOREX")).toBe(true);
  expect(cams.some((c) => c.id === "bihamk:SIPOREX")).toBe(false);
});

// Measured 2026-08-20: Bijača served a 20-hour-old frame under HTTP 200 while Stup
// served a 3-minute-old one. Counting status codes would call both live.
test("a stale frame is unavailable, however happily it serves HTTP 200", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const probes = [fresh("STUP"), { key: "BIJACA", lastModifiedMs: NOW - 20 * 60 * 60_000 }];
  const cams = normalizeBihamk(portal, probes, NOW);
  expect(cams.find((c) => c.id === "bihamk:BIJACA")!.available).toBe(false);
  expect(cams.find((c) => c.id === "bihamk:STUP")!.available).toBe(true);
});

test("a camera we could not probe at all is unavailable and undated", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const cam = normalizeBihamk(portal, [], NOW).find((c) => c.id === "bihamk:STUP")!;
  expect(cam.available).toBe(false);
  expect(cam.lastSampledAt).toBeUndefined();
});

test("the freshness boundary is inclusive on the fresh side", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const at = normalizeBihamk(portal, [{ key: "STUP", lastModifiedMs: NOW - MAX_FRAME_AGE_MS }], NOW);
  const past = normalizeBihamk(portal, [{ key: "STUP", lastModifiedMs: NOW - MAX_FRAME_AGE_MS - 1 }], NOW);
  expect(at.find((c) => c.id === "bihamk:STUP")!.available).toBe(true);
  expect(past.find((c) => c.id === "bihamk:STUP")!.available).toBe(false);
});

test("a future-dated frame reads as fresh rather than as a huge negative age", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const cam = normalizeBihamk(portal, [{ key: "STUP", lastModifiedMs: NOW + 60_000 }], NOW).find(
    (c) => c.id === "bihamk:STUP",
  )!;
  expect(cam.available).toBe(true);
});

// The source policy, as code. An upstream that started pointing somewhere else
// must not have its pictures republished by us under BIHAMK's attribution.
test("an image on any host but the club's own is refused", () => {
  const moved = PORTAL_FIXTURE.replace(
    "https://video-nadzor.bihamk.ba/videosurveillence/BIJACA.jpg",
    "https://kamere.app/videosurveillence/BIJACA.jpg",
  );
  expect(parsePortal(moved).some((c) => c.key === "BIJACA")).toBe(false);
});

test("a bare-IP host is refused outright", () => {
  const raw = PORTAL_FIXTURE.replace(
    "https://video-nadzor.bihamk.ba/videosurveillence/BIJACA.jpg",
    "https://185.22.11.4/videosurveillence/BIJACA.jpg",
  );
  expect(parsePortal(raw).some((c) => c.key === "BIJACA")).toBe(false);
});

test("markup with no cameras yields none rather than throwing", () => {
  expect(parsePortal("<html><body><p>Nema kamera</p></body></html>")).toEqual([]);
});

// A camera the proxy will not serve is a camera that renders broken, so the
// allowlist and the adapter have to agree — this is the pairing that catches a
// rule edited on one side only.
test("every emitted image url is proxy-allowed", () => {
  const portal = parsePortal(PORTAL_FIXTURE);
  const cams = normalizeBihamk(portal, portal.map((c) => fresh(c.key)), NOW);
  expect(cams.length).toBeGreaterThan(0);
  for (const cam of cams) expect(isAllowed(new URL(cam.imageUrl!))).toBe(true);
  // And the rule stays tight: the club's site root is not a camera.
  expect(isAllowed(new URL("https://video-nadzor.bihamk.ba/"))).toBe(false);
});

test("every gazetteer row cites the OSM element its coordinate came from", () => {
  expect(BIHAMK_SITES.length).toBeGreaterThan(0);
  for (const site of BIHAMK_SITES) {
    expect(site.osm, `${site.key} has no OSM citation`).toMatch(/^(node|way|relation)\/\d+$/);
    expect(Math.abs(site.lat)).toBeLessThanOrEqual(90);
    expect(Math.abs(site.lon)).toBeLessThanOrEqual(180);
  }
});

// Bosnia and Herzegovina's bounding box. A row that drifts outside it is a
// mis-matched crossing, which is the specific mistake the gazetteer's header
// warns about (Serbia once matched a crossing 105 km into the wrong border).
test("every gazetteer coordinate is inside Bosnia and Herzegovina", () => {
  for (const site of BIHAMK_SITES) {
    expect(site.lat, site.key).toBeGreaterThan(42.5);
    expect(site.lat, site.key).toBeLessThan(45.35);
    expect(site.lon, site.key).toBeGreaterThan(15.6);
    expect(site.lon, site.key).toBeLessThan(19.7);
  }
});

test("imageUrl builds the operator's own path spelling", () => {
  // "videosurveillence" is the operator's typo. Correcting it 404s every camera.
  expect(imageUrl("MAKLJEN")).toBe(
    "https://video-nadzor.bihamk.ba/videosurveillence/MAKLJEN.jpg",
  );
});
