import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SYNC_KEYS } from "@/lib/account/syncKeys";
import { RECON_TOOL_IDS, missingReconTools } from "@/lib/recon/reconTools";

// Source guards for the IP location tool. Each pins one promise the feature makes and
// that no type check can see.

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

describe("IP location keeps a typed IP out of storage", () => {
  it("the look-up store persists nothing", () => {
    const src = read("lib", "recon", "ipLocate.ts");
    expect(src).not.toMatch(/savePersisted|loadPersisted|localStorage|sessionStorage|pinsStore/);
  });

  it("no synced key belongs to the recon tools", () => {
    for (const k of SYNC_KEYS) expect(k.key).not.toMatch(/recon|ip-?locate|network/i);
  });
});

describe("IP location draws an area, never a point", () => {
  it("the map source has a fill layer and a line layer, and nothing else", () => {
    const src = read("components", "WorldMap.tsx");
    const uses = src.split("source: IP_AREA_SRC").length - 1;
    expect(uses).toBe(2);
    const fill = src.slice(src.indexOf("id: IP_AREA_FILL_LAYER"), src.indexOf("id: IP_AREA_FILL_LAYER") + 120);
    const line = src.slice(src.indexOf("id: IP_AREA_LINE_LAYER"), src.indexOf("id: IP_AREA_LINE_LAYER") + 120);
    expect(fill).toContain('type: "fill"');
    expect(line).toContain('type: "line"');
  });

  it("the dossier prints no coordinates", () => {
    const src = read("components", "NetworkDetail.tsx");
    expect(src).not.toMatch(/\.lat\b|\.lon\b|toFixed/);
  });
});

describe("the search box", () => {
  it("does not send a network target to the geocoder", () => {
    const src = read("components", "console", "MapSearch.tsx");
    const guard = src.indexOf("if (networkTargetOf(q))");
    const geocode = src.indexOf("/api/geocode?q=");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(geocode);
  });
});

describe("the geo route", () => {
  it("reads no header of the visitor", () => {
    const src = read("app", "api", "recon", "geo", "route.ts");
    expect(src).not.toMatch(/headers\(\)|cookies\(\)|x-forwarded-for|x-real-ip|req\.ip|request\.ip|req\.headers/i);
  });
});

describe("missingReconTools", () => {
  it("lists the six recon cards a board does not hold, in order", () => {
    expect(missingReconTools([])).toEqual([...RECON_TOOL_IDS]);
    expect(missingReconTools(["recon:bgp", "camslot", "recon:dns"])).toEqual([
      "recon:whois",
      "recon:certs",
      "recon:ports",
      "recon:threat",
    ]);
    expect(missingReconTools([...RECON_TOOL_IDS])).toEqual([]);
  });
});
