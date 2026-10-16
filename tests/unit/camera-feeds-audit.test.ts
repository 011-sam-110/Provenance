import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CameraArray, type Camera } from "@/lib/types";
import { isAllowed } from "@/lib/proxy/allowlist";
import { isHlsAllowed } from "@/lib/proxy/hls-allowlist";
import type { FrameProbe } from "@/lib/sources/feedKit";

import { normalizeVegvesen } from "@/lib/sources/vegvesen";
import { normalizeDgt, parseDgt } from "@/lib/sources/dgt";
import { normalizeLyon } from "@/lib/sources/lyon";
import { normalizeEismoinfo } from "@/lib/sources/eismoinfo";
import { normalizeUtinform } from "@/lib/sources/utinform";
import { normalizeRoadsMk, parseMkMarkers, parseMkPopup } from "@/lib/sources/roads-mk";
import { normalizeHktd, parseHktd } from "@/lib/sources/hktd";
import { normalizeQld, QLDTRAFFIC_SOURCE } from "@/lib/sources/qldtraffic";
import { QLDTRAFFIC_FLOOD_SOURCE } from "@/lib/sources/qldtraffic-flood";
import { normalizeNsw } from "@/lib/sources/livetraffic-nsw";
import { normalizeTdxThb, thbSnapshot } from "@/lib/sources/tdx-thb";
import { normalizeBellingen } from "@/lib/sources/bellingen";
import { normalizeNims } from "@/lib/sources/usgs-nims";
import { normalizeAlertCa } from "@/lib/sources/alertcalifornia";
import { normalizeAvo } from "@/lib/sources/avo";
import { normalizeToronto, TORONTO_CARD_BYTES } from "@/lib/sources/toronto";
import { normalizeCalgary } from "@/lib/sources/calgary";
import { normalizeVancouver, parseVancouverPage } from "@/lib/sources/vancouver";
import { normalizeTamar, TAMAR_CAMERAS } from "@/lib/sources/tamar";
import { normalizeOttawa, fixMojibake, ottawaImageUrl } from "@/lib/sources/ottawa";
import { neLatLon, normalizeNeUtmc } from "@/lib/sources/ne-utmc";
import { normalizeMy511 } from "@/lib/sources/my511";
import { MY511_MB_SYSTEM } from "@/lib/sources/my511-mb";
import { normalizeDarsSi } from "@/lib/sources/dars-si";

// Every fixture under tests/fixtures/cams is a verbatim slice of the live response,
// captured from provenance-1 on 2026-10-16 (the source audit), trimmed to a few rows.
const FIX = join(process.cwd(), "tests", "fixtures", "cams");
const json = <T = never>(name: string): T => JSON.parse(readFileSync(join(FIX, name), "utf8")) as T;
const text = (name: string) => readFileSync(join(FIX, name), "utf8");

/** The checks every adapter must pass: schema-valid, proxyable, id-prefixed, honest licence. */
function common(cams: Camera[], source: string, country: string) {
  expect(cams.length).toBeGreaterThan(0);
  expect(() => CameraArray.parse(cams)).not.toThrow();
  for (const c of cams) {
    expect(c.source).toBe(source);
    expect(c.id.startsWith(source + ":")).toBe(true);
    expect(c.country).toBe(country);
    expect(c.license.length).toBeGreaterThan(0);
    expect(c.attribution.length).toBeGreaterThan(0);
    if (c.imageUrl) expect(isAllowed(new URL(c.imageUrl)), c.imageUrl).toBe(true);
    if (c.streamUrl) expect(isHlsAllowed(new URL(c.streamUrl)).ok, c.streamUrl).toBe(true);
  }
  expect(new Set(cams.map((c) => c.id)).size).toBe(cams.length);
}

const probe = (over: Partial<FrameProbe>): FrameProbe => ({ at: 1_000_000, status: 200, lastModified: null, bytes: null, ...over });

describe("Norway, Statens vegvesen", () => {
  const cams = normalizeVegvesen(json("vegvesen.json"));
  it("maps the WFS and takes liveness from the operator's own status", () => {
    common(cams, "vegvesen", "NO");
    const svartskog = cams.find((c) => c.id === "vegvesen:0229017_1")!;
    expect(svartskog.name).toBe("Svartskog");
    expect(svartskog.road).toBe("E18");
    expect(svartskog.direction).toBe("Mot Vinterbro");
    expect(svartskog.available).toBe(true);
    // The fixture's fourth row is a camera fault.
    expect(cams.find((c) => c.id === "vegvesen:3000859_1")!.available).toBe(false);
  });
});

describe("Spain, DGT DATEX II", () => {
  const devices = parseDgt(text("dgt.xml"));
  it("reads every camera device out of the XML", () => {
    expect(devices.map((d) => d.id)).toEqual(["176130", "176131", "2"]);
    expect(devices[0]).toMatchObject({ road: "A-62", km: 25.3, province: "BURGOS", destination: "BURGOS" });
  });
  it("names by road, km and province; liveness from the frame probe when there is one", () => {
    const cams = normalizeDgt(devices);
    common(cams, "dgt", "ES");
    expect(cams[0].name).toBe("A-62, km 25.3, Burgos");
    expect(cams[1].direction).toBe("towards Portugal");
    expect(cams.every((c) => c.available)).toBe(true); // nothing probed yet
    const at = Date.parse("2026-10-16T21:00:00Z");
    const probes = new Map([
      ["dgt:176130", probe({ at, lastModified: at - 5 * 60_000 })],
      ["dgt:176131", probe({ at, lastModified: at - 3 * 3_600_000 })],
      ["dgt:2", probe({ at, status: 404 })],
    ]);
    const live = normalizeDgt(devices, probes);
    expect(live.map((c) => c.available)).toEqual([true, false, false]);
    expect(live[0].lastSampledAt).toBe(new Date(at - 5 * 60_000).toISOString());
  });
});

describe("France, Métropole de Lyon", () => {
  it("uses the row's own last_update for liveness", () => {
    const body = json<{ features: { properties: { last_update: string } }[] }>("lyon.json");
    const newest = Math.max(...body.features.map((f) => Date.parse(f.properties.last_update)));
    const cams = normalizeLyon(body as never, newest + 5 * 60_000);
    common(cams, "lyon-criter", "FR");
    expect(cams[0].name).toBe("Boulevard de l'Université / Rue A.Bouloche");
    expect(cams[0].direction).toBe("towards Porte des Alpes");
    expect(cams.every((c) => c.available)).toBe(true);
    expect(normalizeLyon(body as never, newest + 2 * 3_600_000).every((c) => !c.available)).toBe(true);
  });
});

describe("Lithuania, eismoinfo.lt", () => {
  it("joins the table to the WGS84 layer on id", () => {
    const rows = json<{ date: number }[]>("eismoinfo-table.json");
    const now = Math.max(...rows.map((r) => r.date)) + 60_000;
    const cams = normalizeEismoinfo(rows as never, json("eismoinfo-layer.json"), now);
    common(cams, "eismoinfo", "LT");
    const vilnius = cams.find((c) => c.id === "eismoinfo:72")!;
    expect(vilnius.name).toBe("Vilnius A1 10,04");
    expect(vilnius.road).toBe("A1");
    expect(vilnius.lat).toBeCloseTo(54.6426, 3); // the layer's point, not the LKS94 metres
    expect(vilnius.lon).toBeCloseTo(25.1798, 3);
    expect(vilnius.imageUrl).toBe("https://eismoinfo.lt/eismoinfo-backend-v2/image-provider/camera/last?id=72");
    expect(normalizeEismoinfo(rows as never, json("eismoinfo-layer.json"), now + 2 * 3_600_000).some((c) => c.available)).toBe(false);
  });
  it("drops a camera the layer cannot place", () => {
    expect(normalizeEismoinfo(json("eismoinfo-table.json"), [])).toEqual([]);
  });
});

describe("Hungary, Útinform", () => {
  it("flattens places to one camera per view and skips unpublished places", () => {
    const body = json<{ features: { properties: { webcams: { lastImage: number }[] } }[] }>("utinform.json");
    const now = Math.max(...body.features.flatMap((f) => f.properties.webcams.map((w) => w.lastImage))) + 60_000;
    const cams = normalizeUtinform(body as never, now);
    common(cams, "utinform-hu", "HU");
    // mcs217 has four views and mcs182 two; mcs296 is unpublished.
    expect(cams).toHaveLength(6);
    expect(cams.some((c) => c.id.startsWith("utinform-hu:mcs296"))).toBe(false);
    const c = cams.find((x) => x.id === "utinform-hu:mcs217_3")!;
    expect(c.name).toBe("Püspökladány");
    expect(c.direction).toBe("towards Budapest");
    expect(c.imageUrl).toBe("https://cdnuiwebcams.utinform.hu/webcamimages/mcs217_3.jpg");
    expect(cams.every((x) => x.available)).toBe(true);
    expect(normalizeUtinform(body as never, now + 2 * 3_600_000).some((x) => x.available)).toBe(false);
  });
});

describe("North Macedonia, state roads", () => {
  it("reads markers and a popup into HLS cameras whose liveness is the playlist probe", () => {
    const markers = parseMkMarkers(text("roads-mk-page.html"));
    expect(markers.length).toBeGreaterThan(10);
    expect(markers[0]).toEqual({ id: 16052, lat: 41.170583, lon: 22.744639 });
    const popup = parseMkPopup(json<{ html: string }>("roads-mk-popup.json").html);
    expect(popup.name).toBe("Граничен премин “Дојран“");
    expect(popup.streams).toEqual(["https://streaming1.neotel.net.mk/stream/dojran.m3u8"]);
    const site = { ...markers[0], name: popup.name!, streams: popup.streams };
    const cams = normalizeRoadsMk([site], new Map([[popup.streams[0], false]]));
    common(cams, "roads-mk", "MK");
    expect(cams[0].mediaType).toBe("video");
    expect(cams[0].available).toBe(false);
    expect(normalizeRoadsMk([site])[0].available).toBe(true); // not probed: no evidence
  });
  it("refuses a stream on any other host", () => {
    expect(parseMkPopup('streamer.html?src=https://evil.example/stream/x.m3u8').streams).toEqual([]);
  });
});

describe("Hong Kong, Transport Department", () => {
  it("parses the XML list and strips the key from the name", () => {
    const rows = parseHktd(text("hktd.xml"));
    expect(rows.map((r) => r.key)).toEqual(["H429F", "H210F", "H421F"]);
    const cams = normalizeHktd(rows);
    common(cams, "hktd", "HK");
    expect(cams[0].name).toBe("Aberdeen Praya Road near Fish Market");
    expect(cams[0].region).toBe("Southern");
    const at = 5_000_000_000;
    const stale = normalizeHktd(rows, new Map([["hktd:H429F", probe({ at, lastModified: at - 2 * 3_600_000 })]]));
    expect(stale[0].available).toBe(false);
  });
});

describe("Queensland, QLDTraffic", () => {
  it("serves both files, and names the council behind a flood camera", () => {
    const web = normalizeQld("qldtraffic", json("qldtraffic.json"), QLDTRAFFIC_SOURCE);
    common(web, "qldtraffic", "AU");
    expect(web[0].name).toBe("Archerfield - Ipswich Motorway & Granard Rd - North");
    const flood = normalizeQld("qldtraffic-flood", json("qldtraffic-flood.json"), QLDTRAFFIC_FLOOD_SOURCE);
    common(flood, "qldtraffic-flood", "AU");
    expect(flood[0].attribution).toMatch(/Image from Douglas Shire Council$/);
    expect(flood[1].attribution).toBe(QLDTRAFFIC_FLOOD_SOURCE.attribution);
  });
});

describe("New South Wales, Live Traffic", () => {
  it("keeps only the liveCams features", () => {
    const cams = normalizeNsw(json("livetraffic-nsw.json"));
    common(cams, "livetraffic-nsw", "AU");
    expect(cams).toHaveLength(2);
    expect(cams[0].name).toBe("5 Ways (Miranda)");
    expect(cams[0].region).toBe("Sydney South");
  });
});

describe("Taiwan, Highway Bureau via TDX", () => {
  it("normalises the :443 out of the snapshot URL and refuses other hosts", () => {
    const cams = normalizeTdxThb(json("tdx-thb.json"));
    common(cams, "tdx-thb", "TW");
    expect(cams[0].imageUrl).toBe("https://cctv-ss02.thb.gov.tw/T62-9K+020/snapshot");
    expect(cams[0].road).toBe("台62線 9K+020");
    expect(thbSnapshot("https://evil.example/T62/snapshot")).toBeNull();
    expect(thbSnapshot("https://cctv-ss02.thb.gov.tw:8443/x/snapshot")).toBeNull();
  });
});

describe("Bellingen Shire flood cameras", () => {
  it("maps the council's ArcGIS layer", () => {
    const cams = normalizeBellingen(json("bellingen.json"));
    common(cams, "bellingen", "AU");
    expect(cams[0].name).toBe("Lavenders Bridge");
  });
});

describe("USGS streamgage cameras (NIMS)", () => {
  it("skips hidden cameras, builds the _newest image and allows two hours", () => {
    const rows = json<{ newestImageDT?: string }[]>("usgs-nims.json");
    const t = Date.parse(rows[0].newestImageDT!);
    const cams = normalizeNims(rows as never, t + 90 * 60_000);
    common(cams, "usgs-nims", "US");
    expect(cams).toHaveLength(2);
    expect(cams[0].imageUrl).toBe(
      "https://usgs-nims-images.s3.amazonaws.com/overlay/IL_Lick_Creek_near_Woodside/IL_Lick_Creek_near_Woodside_newest.jpg",
    );
    expect(cams[0].available).toBe(true);
    expect(normalizeNims(rows as never, t + 3 * 3_600_000)[0].available).toBe(false);
  });
});

describe("ALERTCalifornia", () => {
  it("drops rows with no coordinates and dates frames from last_frame_ts", () => {
    const body = json<{ features: { properties: { last_frame_ts: number } }[] }>("alertcalifornia.json");
    const now = body.features[0].properties.last_frame_ts * 1000 + 60_000;
    const cams = normalizeAlertCa(body as never, now);
    common(cams, "alertcalifornia", "US");
    expect(cams).toHaveLength(2);
    expect(cams[0]).toMatchObject({ name: "Alabama Hills 1", region: "Inyo County", direction: "looking SW", available: true });
    expect(cams[0].license).toMatch(/non-commercial/);
    expect(cams[0].attribution).toBe("ALERTCalifornia | UC San Diego");
  });
});

describe("Alaska Volcano Observatory", () => {
  it("serves AVO's own cameras and leaves the FAA mirrors out", () => {
    const body = json<{ webcams: { lastImageTimestamp: number }[] }>("avo.json");
    const now = body.webcams[0].lastImageTimestamp * 1000 + 30 * 60_000;
    const cams = normalizeAvo(body as never, now);
    common(cams, "avo", "US");
    expect(cams.map((c) => c.id)).toEqual(["avo:akutan_aksd", "avo:akutan_av06"]);
    expect(cams[0].direction).toBe("looking W");
    expect(cams[0].available).toBe(true);
  });
});

describe("City of Toronto", () => {
  it("reads MultiPoint geometry and treats the 20,955-byte card as dead", () => {
    const cams = normalizeToronto(json("toronto.json"));
    common(cams, "toronto", "CA");
    expect(cams[0].name).toBe("YORK ST at BREMNER BLVD / RAPTORS WAY");
    expect(cams[0].lat).toBeCloseTo(43.64312, 4);
    const at = 5_000_000_000;
    const card = normalizeToronto(json("toronto.json"), new Map([["toronto:8001", probe({ at, lastModified: at, bytes: TORONTO_CARD_BYTES })]]));
    expect(card[0].available).toBe(false);
  });
});

describe("City of Calgary", () => {
  it("upgrades the catalogue's http image URLs to https", () => {
    const cams = normalizeCalgary(json("calgary.json"));
    common(cams, "calgary", "CA");
    expect(cams[0]).toMatchObject({ id: "calgary:loc86", imageUrl: "https://trafficcam.calgary.ca/loc86.jpg", region: "Calgary SE" });
  });
});

describe("City of Vancouver", () => {
  it("reads one camera per directional still off the site page", () => {
    const sites = json<{ url: string }[]>("vancouver.json");
    const views = parseVancouverPage(text("vancouver-page.html"), sites[0].url);
    expect(views).toHaveLength(4);
    expect(views[0]).toEqual({ image: "https://trafficcams.vancouver.ca/cameraimages/GrandviewRupertnorth.jpg", alt: "Grandview Hwy and Rupert St - North" });
    const cams = normalizeVancouver(sites as never, new Map([[sites[0].url, views]]));
    common(cams, "vancouver", "CA");
    expect(cams).toHaveLength(4); // the second site's page was not read, so it has no camera
    expect(cams[0]).toMatchObject({ name: "Rupert St and Grandview Hwy", direction: "North" });
  });
});

describe("Tamar Crossings", () => {
  it("serves the committed table, and an empty body means unavailable", () => {
    const cams = normalizeTamar();
    common(cams, "tamar", "GB");
    expect(cams).toHaveLength(TAMAR_CAMERAS.length);
    const at = 5_000_000_000;
    const probes = new Map([
      ["tamar:4676", probe({ at, bytes: null })],
      ["tamar:87", probe({ at, bytes: 224_654 })],
    ]);
    const live = normalizeTamar(probes);
    expect(live.find((c) => c.id === "tamar:4676")!.available).toBe(false);
    expect(live.find((c) => c.id === "tamar:87")!.available).toBe(true);
  });
});

describe("City of Ottawa (dormant until OTTAWA_CAMERA_CERT)", () => {
  it("leaves MTO's cameras to 511 Ontario and keeps the certificate out of the URL", () => {
    const cams = normalizeOttawa(json("ottawa.json"));
    common(cams, "ottawa", "CA");
    expect(cams.map((c) => c.id)).toEqual(["ottawa:49", "ottawa:43"]);
    expect(cams[0].imageUrl).toBe(ottawaImageUrl(49));
    expect(cams[0].imageUrl).not.toMatch(/certificate/);
    // Clean text passes through; double-encoded UTF-8 is repaired.
    expect(fixMojibake("Booth & Kichi Zībī Mīkan")).toBe("Booth & Kichi Zībī Mīkan");
    expect(fixMojibake("Kichi ZÄ«bÄ«")).toBe("Kichi Zībī");
  });
});

describe("Tyne and Wear UTMC (dormant until NE_UTMC_USER / NE_UTMC_PASS)", () => {
  it("accepts degrees, converts Web-Mercator metres, and joins static to dynamic", () => {
    expect(neLatLon({ latitude: 54.97, longitude: -1.61 })).toEqual([54.97, -1.61]);
    const R = 6_378_137;
    const y = R * Math.log(Math.tan(Math.PI / 4 + (54.97 * Math.PI) / 180 / 2));
    const x = ((-1.61 * Math.PI) / 180) * R;
    const [lat, lon] = neLatLon({ latitude: y, longitude: x })!;
    expect(lat).toBeCloseTo(54.97, 6);
    expect(lon).toBeCloseTo(-1.61, 6);
    // The operator documents this shape; no response has been seen yet (no account).
    const now = Date.parse("2026-10-16T19:00:00Z");
    const cams = normalizeNeUtmc(
      [{ systemCodeNumber: "SL_A1018E1", definitions: [{ shortDescription: "A1018 E1", longDescription: "A1018 Newcastle Road / Ewesley Road", point: { latitude: 54.92, longitude: -1.39 } }] }],
      [{ systemCodeNumber: "SL_A1018E1", dynamics: [{ image: "https://www.netraveldata.co.uk/api/v2/cctv/images/SL_A1018E1.jpg", lastUpdated: "2026-10-16T18:58:00Z" }] }],
      now,
    );
    common(cams, "ne-utmc", "GB");
    expect(cams[0]).toMatchObject({ name: "A1018 Newcastle Road / Ewesley Road", available: true });
  });
});

describe("My511 keyed API (dormant until each key is set)", () => {
  it("emits one camera per enabled view, using the operator's documented shape", () => {
    // The two rows of the operator's own sample have 0,0 coordinates, so a real-looking
    // row is added in the same shape.
    const rows = [
      { Id: 7, Roadway: "PTH 1", Direction: "Eastbound", Latitude: 49.88, Longitude: -97.4, Location: "PTH 1 at PTH 100", Views: [{ Id: 21, Url: "https://www.manitoba511.ca/map/Cctv/21", Status: "Enabled", Description: "East" }, { Id: 22, Url: "https://www.manitoba511.ca/map/Cctv/22", Status: "Disabled", Description: "West" }] },
      { Id: 1, Roadway: "Testing1234567", Direction: "Unknown", Latitude: 0, Longitude: 0, Location: "Testing12345", Views: [{ Id: 599, Url: "https://www.manitoba511.ca/map/Cctv/599", Status: "Disabled", Description: "Testing12345678" }] },
    ];
    const cams = normalizeMy511(MY511_MB_SYSTEM, rows);
    common(cams, "my511-mb", "CA");
    expect(cams.map((c) => [c.id, c.available])).toEqual([["my511-mb:21", true], ["my511-mb:22", false]]);
    expect(cams[0].name).toBe("PTH 1 at PTH 100 — East");
  });
});

describe("DARS and DRSI via NAP Slovenia (dormant until NAP_SLOVENIA_USER / PASS)", () => {
  it("reads grouped items or flat features, only on kamere.dars.si", () => {
    const cams = normalizeDarsSi({
      features: [
        {
          geometry: { coordinates: [14.5, 46.05] },
          properties: { title_eng: "Ljubljana ring", items: [{ id: "LJ1", title_eng: "Ljubljana Kozarje", text_eng: "towards Koper", image: "https://kamere.dars.si/kamere/LJ1.jpg", KameraOwner: "DARS", active: true }] },
        },
        { geometry: { coordinates: [15.6, 46.55] }, properties: { id: "MB2", title_eng: "Maribor", image: "https://evil.example/MB2.jpg" } },
      ],
    });
    common(cams, "dars-si", "SI");
    expect(cams).toHaveLength(1);
    expect(cams[0]).toMatchObject({ name: "Ljubljana Kozarje", direction: "towards Koper", available: true });
    expect(cams[0].attribution).toMatch(/Camera owner: DARS$/);
  });
});
