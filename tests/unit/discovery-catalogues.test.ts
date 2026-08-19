import { describe, it, expect } from "vitest";
import {
  CKAN_PORTALS,
  arcgisHubSearchUrl,
  ckanSearchUrl,
  looksLikeCameraDataset,
  machineReadable,
  parseArcgisHub,
  parseCkanSearch,
  parseSocrataCatalog,
  scoreHit,
  socrataSearchUrl,
  type CatalogueHit,
} from "@/lib/discovery/catalogues";

const hit = (patch: Partial<CatalogueHit> = {}): CatalogueHit => ({
  portal: "https://data.gov.uk",
  datasetId: "d1",
  title: "Traffic CCTV camera locations and live images",
  resources: [],
  ...patch,
});

describe("search URLs", () => {
  it("builds a keyless CKAN search that encodes the query", () => {
    const url = ckanSearchUrl("https://data.gov.uk/", "traffic camera", 10);
    expect(url).toBe("https://data.gov.uk/api/3/action/package_search?q=traffic%20camera&rows=10");
    // No portal in the table may carry a credential in its base URL: a discovery run
    // that needs a key is a key this repo would have to hold and publish a policy for.
    expect(CKAN_PORTALS.every((p) => !/[?&](?:key|token|api)/i.test(p.base))).toBe(true);
  });

  it("builds Socrata and ArcGIS Hub searches", () => {
    expect(socrataSearchUrl("cctv", 5)).toContain("api.us.socrata.com/api/catalog/v1?q=cctv");
    expect(arcgisHubSearchUrl("traffic camera", 5)).toContain("hub.arcgis.com/api/v3/datasets?q=traffic%20camera");
  });
});

describe("parseCkanSearch", () => {
  const body = {
    success: true,
    result: {
      count: 1,
      results: [
        {
          id: "abc",
          name: "traffic-cameras",
          title: "Traffic cameras",
          notes: "Live CCTV images from the strategic road network.",
          license_title: "Open Government Licence 3.0",
          license_url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
          organization: { title: "National Highways" },
          resources: [
            { url: "https://roads.example.gov.uk/cameras.json", format: "JSON", name: "Camera list" },
            { url: "https://roads.example.gov.uk/guide.pdf", format: "PDF" },
            { format: "JSON" },
          ],
        },
      ],
    },
  };

  it("normalises a dataset, keeping the catalogue's own licence wording", () => {
    const [h] = parseCkanSearch(body, "https://data.gov.uk");
    expect(h.datasetId).toBe("traffic-cameras");
    expect(h.publisher).toBe("National Highways");
    // Copied verbatim. Normalising "Open Government Licence 3.0" to "OGL-3.0" is the
    // first step towards a licence name nobody upstream ever wrote.
    expect(h.license).toBe("Open Government Licence 3.0");
    expect(h.landingPage).toBe("https://data.gov.uk/dataset/traffic-cameras");
  });

  it("drops a resource with no URL rather than emitting an unusable one", () => {
    const [h] = parseCkanSearch(body, "https://data.gov.uk");
    expect(h.resources).toHaveLength(2);
  });

  it("returns nothing for every wrong shape instead of throwing", () => {
    expect(parseCkanSearch(null, "x")).toEqual([]);
    expect(parseCkanSearch({ result: {} }, "x")).toEqual([]);
    expect(parseCkanSearch({ result: { results: "no" } }, "x")).toEqual([]);
    expect(parseCkanSearch({ result: { results: [{ no: "title" }] } }, "x")).toEqual([]);
  });
});

describe("parseSocrataCatalog", () => {
  it("derives the JSON export URL from the dataset id", () => {
    const [h] = parseSocrataCatalog({
      results: [
        {
          resource: { id: "abcd-1234", name: "CCTV cameras", description: "live" },
          metadata: { domain: "data.cityofchicago.org" },
          link: "https://data.cityofchicago.org/d/abcd-1234",
          classification: { domain_category: "Transportation" },
        },
      ],
    });
    expect(h.resources[0].url).toBe("https://data.cityofchicago.org/resource/abcd-1234.json?$limit=1000");
    expect(h.portal).toBe("https://data.cityofchicago.org");
  });

  it("skips a row missing the domain, which makes the export URL underivable", () => {
    expect(parseSocrataCatalog({ results: [{ resource: { id: "a", name: "b" } }] })).toEqual([]);
  });
});

describe("parseArcgisHub", () => {
  it("turns a FeatureServer layer into a fetchable WGS84 query", () => {
    const [h] = parseArcgisHub({
      data: [
        {
          id: "xyz",
          attributes: { name: "Traffic Cameras", url: "https://services.arcgis.com/x/FeatureServer/0/" },
        },
      ],
    });
    // outSR=4326 is the whole point: without it the layer answers in Web Mercator
    // metres and every coordinate fails the sniffer's range check.
    expect(h.resources[0].url).toContain("outSR=4326");
    expect(h.resources[0].url).toContain("f=json");
    expect(h.resources[0].url).not.toContain("//query");
  });

  it("emits no resource when the layer has no URL", () => {
    const [h] = parseArcgisHub({ data: [{ id: "xyz", attributes: { name: "Cameras" } }] });
    expect(h.resources).toEqual([]);
  });
});

describe("machineReadable", () => {
  it("accepts the formats this pipeline can parse and rejects documents", () => {
    expect(machineReadable({ url: "https://x/y", format: "GeoJSON" })).toBe(true);
    expect(machineReadable({ url: "https://x/y", format: "Esri REST" })).toBe(true);
    expect(machineReadable({ url: "https://x/cameras.json" })).toBe(true);
    expect(machineReadable({ url: "https://x/a/FeatureServer/0" })).toBe(true);
    expect(machineReadable({ url: "https://x/guide.pdf", format: "PDF" })).toBe(false);
    expect(machineReadable({ url: "https://x/data.csv", format: "CSV" })).toBe(false);
  });
});

describe("looksLikeCameraDataset", () => {
  it("keeps live camera datasets", () => {
    expect(looksLikeCameraDataset(hit())).toBe(true);
    expect(looksLikeCameraDataset(hit({ title: "Webcam feeds", description: "Coastal webcams" }))).toBe(true);
  });

  it("drops the three things a camera search actually returns", () => {
    // Every one of these ranks for "traffic camera" and none of them has a picture.
    expect(looksLikeCameraDataset(hit({ title: "Speed camera locations" }))).toBe(false);
    expect(looksLikeCameraDataset(hit({ title: "Bus lane camera enforcement notices" }))).toBe(false);
    expect(looksLikeCameraDataset(hit({ title: "Traffic camera counts by hour" }))).toBe(false);
  });

  it("drops anything with no camera word at all", () => {
    expect(looksLikeCameraDataset(hit({ title: "Road gritting routes" }))).toBe(false);
  });
});

describe("scoreHit", () => {
  it("ranks a licensed, live, machine-readable dataset above a bare one", () => {
    const rich = hit({
      title: "Live CCTV camera images",
      license: "OGL v3.0",
      resources: [{ url: "https://x/cameras.json", format: "JSON" }],
    });
    expect(scoreHit(rich)).toBeGreaterThan(scoreHit(hit({ title: "Camera locations" })));
  });
});
