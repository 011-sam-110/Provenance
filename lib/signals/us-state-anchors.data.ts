// GENERATED FILE — do not hand-edit. Regenerate with:
//   node scripts/gen-us-state-anchors.mjs <GeoNames cities15000.txt>
//
// One anchor per US state and DC, at the state capital, from GeoNames (CC BY 4.0). An
// anchor marks the STATE: a layer that knows only the state draws it at "area"
// precision, and the capital is where the mark sits, never where anything happened.

export interface StateAnchor {
  name: string;
  capital: string;
  lat: number;
  lon: number;
}

export const US_STATE_ANCHORS: Readonly<Record<string, StateAnchor>> = {
  AK: { name: "Alaska", capital: "Juneau", lat: 58.3019, lon: -134.4197 },
  AL: { name: "Alabama", capital: "Montgomery", lat: 32.3668, lon: -86.3 },
  AR: { name: "Arkansas", capital: "Little Rock", lat: 34.7465, lon: -92.2896 },
  AZ: { name: "Arizona", capital: "Phoenix", lat: 33.4484, lon: -112.074 },
  CA: { name: "California", capital: "Sacramento", lat: 38.5816, lon: -121.4944 },
  CO: { name: "Colorado", capital: "Denver", lat: 39.7392, lon: -104.9847 },
  CT: { name: "Connecticut", capital: "Hartford", lat: 41.7637, lon: -72.6851 },
  DC: { name: "District of Columbia", capital: "Washington", lat: 38.8951, lon: -77.0364 },
  DE: { name: "Delaware", capital: "Dover", lat: 39.1582, lon: -75.5244 },
  FL: { name: "Florida", capital: "Tallahassee", lat: 30.4383, lon: -84.2807 },
  GA: { name: "Georgia", capital: "Atlanta", lat: 33.749, lon: -84.388 },
  HI: { name: "Hawaii", capital: "Honolulu", lat: 21.3069, lon: -157.8583 },
  IA: { name: "Iowa", capital: "Des Moines", lat: 41.6005, lon: -93.6091 },
  ID: { name: "Idaho", capital: "Boise", lat: 43.6135, lon: -116.2035 },
  IL: { name: "Illinois", capital: "Springfield", lat: 39.8017, lon: -89.6437 },
  IN: { name: "Indiana", capital: "Indianapolis", lat: 39.7684, lon: -86.158 },
  KS: { name: "Kansas", capital: "Topeka", lat: 39.0483, lon: -95.678 },
  KY: { name: "Kentucky", capital: "Frankfort", lat: 38.2009, lon: -84.8733 },
  LA: { name: "Louisiana", capital: "Baton Rouge", lat: 30.4433, lon: -91.1875 },
  MA: { name: "Massachusetts", capital: "Boston", lat: 42.3584, lon: -71.0598 },
  MD: { name: "Maryland", capital: "Annapolis", lat: 38.9786, lon: -76.4918 },
  ME: { name: "Maine", capital: "Augusta", lat: 44.3106, lon: -69.7795 },
  MI: { name: "Michigan", capital: "Lansing", lat: 42.7325, lon: -84.5555 },
  MN: { name: "Minnesota", capital: "Saint Paul", lat: 44.9444, lon: -93.0933 },
  MO: { name: "Missouri", capital: "Jefferson City", lat: 38.5767, lon: -92.1735 },
  MS: { name: "Mississippi", capital: "Jackson", lat: 32.2988, lon: -90.1848 },
  MT: { name: "Montana", capital: "Helena", lat: 46.5927, lon: -112.0361 },
  NC: { name: "North Carolina", capital: "Raleigh", lat: 35.7721, lon: -78.6386 },
  ND: { name: "North Dakota", capital: "Bismarck", lat: 46.8083, lon: -100.7837 },
  NE: { name: "Nebraska", capital: "Lincoln", lat: 40.8, lon: -96.667 },
  NH: { name: "New Hampshire", capital: "Concord", lat: 43.2081, lon: -71.5376 },
  NJ: { name: "New Jersey", capital: "Trenton", lat: 40.2171, lon: -74.7429 },
  NM: { name: "New Mexico", capital: "Santa Fe", lat: 35.687, lon: -105.9378 },
  NV: { name: "Nevada", capital: "Carson City", lat: 39.1638, lon: -119.7674 },
  NY: { name: "New York", capital: "Albany", lat: 42.6526, lon: -73.7562 },
  OH: { name: "Ohio", capital: "Columbus", lat: 39.9612, lon: -82.9988 },
  OK: { name: "Oklahoma", capital: "Oklahoma City", lat: 35.4676, lon: -97.5164 },
  OR: { name: "Oregon", capital: "Salem", lat: 44.9429, lon: -123.0351 },
  PA: { name: "Pennsylvania", capital: "Harrisburg", lat: 40.2737, lon: -76.8844 },
  RI: { name: "Rhode Island", capital: "Providence", lat: 41.824, lon: -71.4128 },
  SC: { name: "South Carolina", capital: "Columbia", lat: 34.0007, lon: -81.0348 },
  SD: { name: "South Dakota", capital: "Pierre", lat: 44.3683, lon: -100.351 },
  TN: { name: "Tennessee", capital: "Nashville", lat: 36.1659, lon: -86.7844 },
  TX: { name: "Texas", capital: "Austin", lat: 30.2672, lon: -97.7431 },
  UT: { name: "Utah", capital: "Salt Lake City", lat: 40.7608, lon: -111.8911 },
  VA: { name: "Virginia", capital: "Richmond", lat: 37.5538, lon: -77.4603 },
  VT: { name: "Vermont", capital: "Montpelier", lat: 44.2601, lon: -72.5754 },
  WA: { name: "Washington", capital: "Olympia", lat: 47.0449, lon: -122.9017 },
  WI: { name: "Wisconsin", capital: "Madison", lat: 43.0731, lon: -89.4012 },
  WV: { name: "West Virginia", capital: "Charleston", lat: 38.3498, lon: -81.6326 },
  WY: { name: "Wyoming", capital: "Cheyenne", lat: 41.14, lon: -104.8203 },
};

/** The anchor for a two-letter state code, or undefined. */
export function stateAnchor(code: string): StateAnchor | undefined {
  return US_STATE_ANCHORS[(code ?? "").trim().toUpperCase()];
}
