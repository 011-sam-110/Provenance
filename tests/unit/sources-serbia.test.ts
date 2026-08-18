import { describe, it, expect } from "vitest";
import {
  parseMupPortal,
  normalizeSerbiaBorders,
  SERBIA_BORDERS_SOURCE,
} from "@/lib/sources/serbia-borders";
import {
  parseTollViewer,
  normalizeSerbiaTolls,
  SERBIA_TOLLS_SOURCE,
} from "@/lib/sources/serbia-tolls";
import {
  SERBIA_BORDER_SITES,
  SERBIA_TOLL_PLAZAS,
  isBareIpHost,
  decodeHtmlEntities,
} from "@/lib/sources/serbia.data";
import { CameraArray } from "@/lib/types";
import { isAllowed } from "@/lib/proxy/allowlist";
import { isHlsAllowed } from "@/lib/proxy/hls-allowlist";

// Every fixture below is REAL markup, copied byte-for-byte out of the two live
// portals on 2026-08-18. Hand-written HTML would have hidden both of the things
// these adapters exist to survive: MUP listing a crossing's two streams in
// reverse order, and toll4all serving a tile's poster from a different subdomain
// than its stream.

// CYRILLIC, because that is what the adapter actually receives. The Latin
// rendering below exists too, and the difference is not cosmetic: the portal
// serves Latin only behind a `!ut/p/z1/...` navigational state token, and
// Cyrillic from the bare path the adapter requests. The first version of this
// fixture was the Latin one, captured through a browser-style URL, and it would
// have made every name assertion here pass while production produced different
// strings. Both are pinned so the parser stays script-agnostic.
const MUP_FIXTURE = `
<li id="id_31b04cbf-2f35-4f3a-85e7-a57d7129b2df" >
  <a href="#" onclick="toggleCamera('31b04cbf-2f35-4f3a-85e7-a57d7129b2df','https://kamere.mup.gov.rs:4443/Horgos/horgos1.m3u8', 'https://kamere.mup.gov.rs:4443/Horgos/horgos2.m3u8');return false;">
         Гранични прелаз Хоргош
  </a>
</li><li id="id_1d38255b-5e1a-44f7-ad15-3a9e4b441045" >
  <a href="#" onclick="toggleCamera('1d38255b-5e1a-44f7-ad15-3a9e4b441045','https://kamere.mup.gov.rs:4443/Djala/djala2.m3u8', 'https://kamere.mup.gov.rs:4443/Djala/djala1.m3u8');return false;">
         Гранични прелаз Ђала
  </a>
</li>`;

/** The same two crossings as served through the state-token URL: Latin, and the
 *  only place the `&scaron;` entity appears. */
const MUP_FIXTURE_LATIN = `
<li id="id_bf4ca0f6-b736-402f-a0a8-88df34899897" >
  <a href="#" onclick="toggleCamera('bf4ca0f6-b736-402f-a0a8-88df34899897','https://kamere.mup.gov.rs:4443/Horgos/horgos1.m3u8', 'https://kamere.mup.gov.rs:4443/Horgos/horgos2.m3u8');return false;">
         Granični prelaz Horgo&scaron;
  </a>
</li><li id="id_7a3d5b15-612a-49f6-bd90-ae6792844071" >
  <a href="#" onclick="toggleCamera('7a3d5b15-612a-49f6-bd90-ae6792844071','https://kamere.mup.gov.rs:4443/Djala/djala2.m3u8', 'https://kamere.mup.gov.rs:4443/Djala/djala1.m3u8');return false;">
         Granični prelaz Đala
  </a>
</li>`;

const TOLL_FIXTURE = `
<div class="cam-item" poster="https://cam.bitinfo.co.rs/front_pan_cam1/index.jpg" src="https://cam.bitinfo.co.rs/front_pan_cam1/index.m3u8">
              <span>Stara Pazova Izlaz</span>
              <img class="cam-item__icon" src="./assets/cam-icon.png" alt="Kamera" />
            </div>
<div class="cam-item" poster="https://jpps.bitinfo.co.rs/side_pan_cam3/index.jpg" src="https://cam.bitinfo.co.rs/side_pan_cam3/index.m3u8">
              <span>Ni&#353; Sever Izlaz</span>
              <img class="cam-item__icon" src="./assets/cam-icon.png" alt="Kamera" />
            </div>
<div class="cam-item" poster="https://jpps.bitinfo.co.rs/side_pan_cam1/index.jpg" src="https://cam.bitinfo.co.rs/side_pan_cam1/index.m3u8">
              <span>Leskovac Izlaz</span>
            </div>
        <video id="my-video" class="video-js cam-modal-video" controls data-setup="{}">
          <source src="https://cam.bitinfo.co.rs/cam1.m3u8" type="application/x-mpegURL" />
        </video>`;

describe("MUP border-crossing portal", () => {
  it("reads both streams of every crossing off the real markup", () => {
    const streams = parseMupPortal(MUP_FIXTURE);
    expect(streams).toHaveLength(4);
    expect(streams.map((s) => s.key)).toEqual(["Horgos", "Horgos", "Djala", "Djala"]);
  });

  // The portal prints Đala's SECOND camera first. Numbering off the markup
  // order would have silently swapped the two, and nothing downstream could
  // have caught it — both URLs resolve and both play.
  it("numbers a camera from the operator's filename, not the page order", () => {
    const djala = parseMupPortal(MUP_FIXTURE).filter((s) => s.key === "Djala");
    expect(djala.map((s) => s.index)).toEqual([2, 1]);
    expect(djala.find((s) => s.index === 1)!.streamUrl).toContain("djala1.m3u8");
    expect(djala.find((s) => s.index === 2)!.streamUrl).toContain("djala2.m3u8");
  });

  it("keeps the ministry's own name, in the script it publishes", () => {
    const [horgos] = parseMupPortal(MUP_FIXTURE);
    expect(horgos.name).toBe("Гранични прелаз Хоргош");
  });

  // Same crossings, Latin rendering, entity-escaped s-caron. The join keys come
  // off the URL, so the script the portal happens to serve changes the label and
  // nothing else - no coordinate, no id, no camera dropped.
  it("parses the Latin rendering identically apart from the label", () => {
    const cyr = parseMupPortal(MUP_FIXTURE);
    const lat = parseMupPortal(MUP_FIXTURE_LATIN);
    expect(lat.map((s) => `${s.key}-${s.index}`)).toEqual(cyr.map((s) => `${s.key}-${s.index}`));
    expect(lat[0].name).toBe("Granični prelaz Horgoš");
    expect(normalizeSerbiaBorders(lat).map((c) => c.id)).toEqual(
      normalizeSerbiaBorders(cyr).map((c) => c.id),
    );
  });

  it("normalizes into schema-valid Cameras", () => {
    const cams = normalizeSerbiaBorders(parseMupPortal(MUP_FIXTURE));
    expect(cams).toHaveLength(4);
    expect(() => CameraArray.parse(cams)).not.toThrow();
  });

  it("maps id, country, coords and stream", () => {
    const cams = normalizeSerbiaBorders(parseMupPortal(MUP_FIXTURE));
    const cam = cams.find((c) => c.id === "mup-rs:horgos-1")!;
    expect(cam.source).toBe("mup-rs");
    expect(cam.country).toBe("RS");
    expect(cam.region).toBe("Border crossings");
    expect(cam.name).toBe("Гранични прелаз Хоргош (kamera 1)");
    // The motorway crossing on the A1, not the disused "Horgoš 2" 600 m east.
    expect(cam.lat).toBeCloseTo(46.1733, 4);
    expect(cam.lon).toBeCloseTo(19.97584, 4);
    expect(cam.streamUrl).toBe("https://kamere.mup.gov.rs:4443/Horgos/horgos1.m3u8");
    expect(cam.mediaType).toBe("video");
    // MUP publishes no still, and claiming one would render a broken tile.
    expect(cam.imageUrl).toBeUndefined();
    expect(cam.attribution).toBe(SERBIA_BORDERS_SOURCE.attribution);
  });

  // A crossing we have not geolocated must vanish, not land on a guessed pin.
  it("drops a crossing that has no verified coordinate", () => {
    const invented = MUP_FIXTURE.replace(/Horgos/g, "Nekakav");
    expect(parseMupPortal(invented)).toHaveLength(4);
    expect(normalizeSerbiaBorders(parseMupPortal(invented))).toHaveLength(2);
  });

  it("refuses a stream that is not an https m3u8 on the ministry's host", () => {
    const swapped = MUP_FIXTURE.replace("https://kamere.mup.gov.rs:4443/Horgos/horgos1.m3u8", "https://evil.example/Horgos/horgos1.m3u8");
    const keys = parseMupPortal(swapped).map((s) => `${s.key}-${s.index}`);
    expect(keys).not.toContain("Horgos-1");
    expect(keys).toContain("Horgos-2");
  });
});

describe("JP Putevi Srbije toll viewer", () => {
  it("reads a tile whose poster and stream are on DIFFERENT subdomains", () => {
    const tiles = parseTollViewer(TOLL_FIXTURE);
    const nis = tiles.find((t) => t.slug === "side_pan_cam3");
    expect(nis).toBeDefined();
    expect(nis!.imageUrl).toContain("jpps.bitinfo.co.rs");
    expect(nis!.streamUrl).toContain("cam.bitinfo.co.rs");
  });

  it("decodes the numeric entities and splits off the direction word", () => {
    const nis = parseTollViewer(TOLL_FIXTURE).find((t) => t.slug === "side_pan_cam3")!;
    expect(nis.label).toBe("Niš Sever Izlaz");
    expect(nis.station).toBe("Niš Sever");
    expect(nis.direction).toBe("Izlaz");
  });

  // The page carries a loose player <source> with no name and no place.
  it("ignores a stream that is not inside a named tile", () => {
    const slugs = parseTollViewer(TOLL_FIXTURE).map((t) => t.slug);
    expect(slugs).toEqual(["front_pan_cam1", "side_pan_cam3", "side_pan_cam1"]);
    expect(slugs).not.toContain("cam1");
  });

  it("normalizes into schema-valid Cameras", () => {
    const cams = normalizeSerbiaTolls(parseTollViewer(TOLL_FIXTURE));
    expect(() => CameraArray.parse(cams)).not.toThrow();
  });

  it("maps id, coords, both media types and the operator's direction", () => {
    const cams = normalizeSerbiaTolls(parseTollViewer(TOLL_FIXTURE));
    const cam = cams.find((c) => c.id === "putevi-rs:front_pan_cam1")!;
    expect(cam.source).toBe("putevi-rs");
    expect(cam.country).toBe("RS");
    expect(cam.region).toBe("Motorway tolls");
    expect(cam.name).toBe("Stara Pazova Izlaz");
    expect(cam.direction).toBe("Izlaz");
    expect(cam.lat).toBeCloseTo(45.00648, 4);
    expect(cam.lon).toBeCloseTo(20.20132, 4);
    expect(cam.mediaType).toBe("both");
    expect(cam.attribution).toBe(SERBIA_TOLLS_SOURCE.attribution);
  });

  // Leskovac parses fine and is still dropped: OSM has two plazas of that name
  // 15 km apart and the operator does not say which. See serbia.data.ts.
  it("drops a plaza whose coordinate could not be established", () => {
    const tiles = parseTollViewer(TOLL_FIXTURE);
    expect(tiles.some((t) => t.station === "Leskovac")).toBe(true);
    const cams = normalizeSerbiaTolls(tiles);
    expect(cams.some((c) => c.name.startsWith("Leskovac"))).toBe(false);
  });
});

// The proxies are the only path a camera's bytes can take, so an adapter that
// emits a URL no rule matches ships a tile that renders "not answering".
describe("the emitted URLs are actually proxyable", () => {
  it("every toll poster passes the image allowlist", () => {
    const cams = normalizeSerbiaTolls(parseTollViewer(TOLL_FIXTURE));
    expect(cams.length).toBeGreaterThan(0);
    for (const cam of cams) {
      expect(isAllowed(new URL(cam.imageUrl!))).toBe(true);
    }
  });

  it("every toll stream is allowed and carries the Referer the host demands", () => {
    const cams = normalizeSerbiaTolls(parseTollViewer(TOLL_FIXTURE));
    for (const cam of cams) {
      const verdict = isHlsAllowed(new URL(cam.streamUrl!));
      expect(verdict.ok).toBe(true);
      // Without the trailing slash bitinfo answers 403.
      expect(verdict.referer).toBe("https://kamere.toll4all.com/");
    }
  });

  it("every border stream is allowed, and asks for no Referer", () => {
    const cams = normalizeSerbiaBorders(parseMupPortal(MUP_FIXTURE));
    for (const cam of cams) {
      const verdict = isHlsAllowed(new URL(cam.streamUrl!));
      expect(verdict.ok).toBe(true);
      expect(verdict.referer).toBeUndefined();
    }
  });
});

// A rule, not a hand-filter: the directory that pointed at these operators also
// lists unsecured MJPEG boxes on bare IP:port addresses. Those are somebody's
// leaked camera, not a published feed, and they must stay out even if a future
// edit pastes one in.
describe("bare-IP hosts are rejected in code", () => {
  it.each([
    "http://93.87.72.254:8084/mjpg/video.mjpg",
    "http://109.233.191.130:8090/cam_1.jpg",
    "http://185.37.168.3:5000/cgi-bin/faststream.jpg",
    "https://[2001:db8::1]/stream.m3u8",
    "not a url at all",
  ])("rejects %s", (url) => {
    expect(isBareIpHost(url)).toBe(true);
  });

  it("accepts the operators' real hosts", () => {
    expect(isBareIpHost("https://kamere.mup.gov.rs:4443/Gradina/gradina1.m3u8")).toBe(false);
    expect(isBareIpHost("https://cam.bitinfo.co.rs/front_pan_cam1/index.jpg")).toBe(false);
  });

  it("keeps a raw-IP stream out of the border feed", () => {
    const swapped = MUP_FIXTURE.replace("https://kamere.mup.gov.rs:4443/Horgos/horgos1.m3u8", "https://93.87.72.254:4443/Horgos/horgos1.m3u8");
    expect(parseMupPortal(swapped).map((s) => `${s.key}-${s.index}`)).not.toContain("Horgos-1");
  });

  it("keeps a raw-IP poster out of the toll feed", () => {
    const swapped = TOLL_FIXTURE.replace("https://cam.bitinfo.co.rs/front_pan_cam1/index.jpg", "https://93.87.72.254/front_pan_cam1/index.jpg");
    expect(parseTollViewer(swapped).map((t) => t.slug)).not.toContain("front_pan_cam1");
  });
});

describe("the hand-verified gazetteer", () => {
  it("puts every coordinate inside Serbia", () => {
    for (const p of [...SERBIA_BORDER_SITES, ...SERBIA_TOLL_PLAZAS]) {
      expect(p.lat).toBeGreaterThan(41.8);
      expect(p.lat).toBeLessThan(46.3);
      expect(p.lon).toBeGreaterThan(18.8);
      expect(p.lon).toBeLessThan(23.1);
    }
  });

  it("has no duplicate join keys", () => {
    const keys = SERBIA_BORDER_SITES.map((s) => s.key.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
    const stations = SERBIA_TOLL_PLAZAS.map((p) => p.station.toLowerCase());
    expect(new Set(stations).size).toBe(stations.length);
  });

  it("records where every coordinate came from", () => {
    for (const p of [...SERBIA_BORDER_SITES, ...SERBIA_TOLL_PLAZAS]) {
      expect(p.osm).toMatch(/^(node|way)\/\d+/);
    }
  });

  it("covers all 16 crossings the portal carries", () => {
    expect(SERBIA_BORDER_SITES).toHaveLength(16);
  });
});

describe("decodeHtmlEntities", () => {
  it("handles the named, decimal and hex forms the two portals use", () => {
    expect(decodeHtmlEntities("Horgo&scaron;")).toBe("Horgoš");
    expect(decodeHtmlEntities("&Scaron;id")).toBe("Šid");
    expect(decodeHtmlEntities("Ni&#353; Sever")).toBe("Niš Sever");
    expect(decodeHtmlEntities("Po&#382;arevac")).toBe("Požarevac");
    expect(decodeHtmlEntities("Pakovra&#x107;e")).toBe("Pakovraće");
  });

  it("leaves an entity it does not know alone rather than mangling it", () => {
    expect(decodeHtmlEntities("A &frobnicate; B")).toBe("A &frobnicate; B");
  });
});
