// Which continent a camera's country is on, for the camera stats breakdown.
//
// A SMALL TABLE ON PURPOSE. It holds the countries the camera adapters emit today, not
// the world: tests/unit/camera-stats.test.ts fails when an adapter emits a country this
// table does not know, so a new country is one row here in the same change. An unknown
// code is counted under no region rather than guessed into one.

export const CAMERA_REGIONS_ORDER = [
  "North America",
  "South America",
  "Europe",
  "Africa",
  "Asia",
  "Oceania",
] as const;

export type CameraRegion = (typeof CAMERA_REGIONS_ORDER)[number];

/** ISO 3166-1 alpha-2 → continent. Puerto Rico and Hong Kong carry their own codes. */
export const CONTINENT_BY_ISO2: Readonly<Record<string, CameraRegion>> = {
  US: "North America",
  CA: "North America",
  PR: "North America",
  BR: "South America",
  GB: "Europe",
  ES: "Europe",
  FR: "Europe",
  NO: "Europe",
  FI: "Europe",
  EE: "Europe",
  LT: "Europe",
  IS: "Europe",
  SI: "Europe",
  RS: "Europe",
  MK: "Europe",
  BA: "Europe",
  TW: "Asia",
  HK: "Asia",
  AU: "Oceania",
  NZ: "Oceania",
};

export function continentOf(iso2: string): CameraRegion | null {
  return CONTINENT_BY_ISO2[iso2.toUpperCase()] ?? null;
}
