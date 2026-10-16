import { expect, test } from "vitest";
import { parseAircraft } from "@/lib/sources/adsbdb";

// Fixtures captured verbatim from the live adsbdb API on 2026-06-27. The route lookup
// and its tests left on 2026-10-16 (routes now come from lib/sources/vrsRoutes.ts,
// tested in vrs-routes.test.ts).

const AIRCRAFT_OK = {
  response: {
    aircraft: {
      type: "G650 ER",
      icao_type: "G650",
      manufacturer: "Gulfstream Aerospace",
      mode_s: "A835AF",
      registration: "N628TS",
      registered_owner_country_iso_name: "US",
      registered_owner_country_name: "United States",
      registered_owner: "Falcon Landing LLC",
      url_photo: "https://airport-data.com/images/aircraft/001/598/001598299.jpg",
    },
  },
};

test("parseAircraft normalizes the airframe fields", () => {
  const a = parseAircraft(AIRCRAFT_OK);
  expect(a).not.toBeNull();
  expect(a?.type).toBe("G650 ER");
  expect(a?.manufacturer).toBe("Gulfstream Aerospace");
  expect(a?.registration).toBe("N628TS");
  expect(a?.owner).toBe("Falcon Landing LLC");
  expect(a?.ownerCountry).toBe("United States");
});

test("parseAircraft returns null for an unknown hex (string response)", () => {
  expect(parseAircraft({ response: "unknown aircraft" })).toBeNull();
  expect(parseAircraft({})).toBeNull();
});
