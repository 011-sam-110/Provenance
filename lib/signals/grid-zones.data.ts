// Where to draw a grid-load reading from an operator that is not ENTSO-E. Each anchor
// is a central point in the area the operator balances: a label location, never a
// substation or a control room.
//
// SOURCES. The respondent codes and names are EIA's own (EIA-930, the "respondent"
// facet of api.eia.gov/v2/electricity/rto/region-data, read 2026-10-16). The regions
// are AEMO's five NEM regions and Energinet's two price areas. The anchors were
// placed by hand inside each operator's published service territory.

export interface GridAnchor {
  name: string;
  lat: number;
  lon: number;
}

const a = (name: string, lat: number, lon: number): GridAnchor => ({ name, lat, lon });

/**
 * EIA-930 balancing authorities. Only BALANCING AUTHORITIES are listed: EIA also
 * returns 14 aggregate regions (CAL, CAR, CENT, FLA, MIDA, MIDW, NE, NW, NY, SE, SW,
 * TEN, TEX, US48), which are sums of the rows below and would double-count them, so
 * they are deliberately absent and their readings are skipped.
 */
export const EIA_BALANCING_AUTHORITIES: Readonly<Record<string, GridAnchor>> = {
  AECI: a("Associated Electric Cooperative", 37.5, -92.5),
  AVA: a("Avista", 47.66, -117.43),
  AZPS: a("Arizona Public Service", 34.5, -111.8),
  BANC: a("Balancing Authority of Northern California", 38.58, -121.49),
  BHBA: a("Black Hills Energy", 44.08, -103.23),
  BPAT: a("Bonneville Power Administration", 46.5, -120.5),
  CHPD: a("Chelan County PUD", 47.42, -120.31),
  CISO: a("California ISO", 36.8, -119.4),
  CPLE: a("Duke Energy Progress East", 35.78, -78.64),
  CPLW: a("Duke Energy Progress West", 35.6, -82.55),
  DOPD: a("Douglas County PUD", 47.7, -119.7),
  DUK: a("Duke Energy Carolinas", 35.23, -80.84),
  EPE: a("El Paso Electric", 31.76, -106.49),
  ERCO: a("ERCOT (Texas)", 31.0, -97.5),
  FMPP: a("Florida Municipal Power Pool", 28.54, -81.38),
  FPC: a("Duke Energy Florida", 28.2, -82.4),
  FPL: a("Florida Power & Light", 26.7, -80.6),
  GCPD: a("Grant County PUD", 47.2, -119.5),
  GVL: a("Gainesville Regional Utilities", 29.65, -82.32),
  HST: a("City of Homestead", 25.47, -80.48),
  IID: a("Imperial Irrigation District", 32.85, -115.57),
  IPCO: a("Idaho Power", 43.6, -116.2),
  ISNE: a("ISO New England", 42.5, -71.8),
  JEA: a("JEA (Jacksonville)", 30.33, -81.66),
  LDWP: a("Los Angeles Dept. of Water and Power", 34.05, -118.24),
  LGEE: a("LG&E and KU", 37.8, -85.5),
  MISO: a("MISO", 41.5, -90.5),
  NEVP: a("Nevada Power", 36.17, -115.14),
  NWMT: a("NorthWestern Energy (Montana)", 46.6, -110.0),
  NYIS: a("New York ISO", 42.9, -75.5),
  PACE: a("PacifiCorp East", 41.5, -111.5),
  PACW: a("PacifiCorp West", 44.0, -122.5),
  PGE: a("Portland General Electric", 45.52, -122.68),
  PJM: a("PJM Interconnection", 40.0, -78.5),
  PNM: a("Public Service Co. of New Mexico", 35.08, -106.65),
  PSCO: a("Public Service Co. of Colorado", 39.74, -104.99),
  PSEI: a("Puget Sound Energy", 47.6, -122.2),
  SC: a("Santee Cooper", 33.2, -80.0),
  SCEG: a("Dominion Energy South Carolina", 34.0, -81.03),
  SCL: a("Seattle City Light", 47.61, -122.33),
  SEC: a("Seminole Electric Cooperative", 28.8, -82.0),
  SOCO: a("Southern Company", 32.8, -85.5),
  SPA: a("Southwestern Power Administration", 36.15, -95.99),
  SRP: a("Salt River Project", 33.45, -112.07),
  SWPP: a("Southwest Power Pool", 37.5, -98.0),
  SWPW: a("Southwest Power Pool West", 41.1, -104.8),
  TAL: a("City of Tallahassee", 30.44, -84.28),
  TEC: a("Tampa Electric", 27.95, -82.46),
  TEPC: a("Tucson Electric Power", 32.22, -110.97),
  TIDC: a("Turlock Irrigation District", 37.49, -120.85),
  TPWR: a("Tacoma Power", 47.25, -122.44),
  TVA: a("Tennessee Valley Authority", 35.9, -86.5),
  WALC: a("WAPA Desert Southwest", 33.4, -113.0),
};

/** AEMO's National Electricity Market regions. */
export const AEMO_REGIONS: Readonly<Record<string, GridAnchor>> = {
  NSW1: a("New South Wales", -32.0, 147.0),
  QLD1: a("Queensland", -22.5, 144.5),
  VIC1: a("Victoria", -37.0, 144.5),
  SA1: a("South Australia", -33.5, 138.0),
  TAS1: a("Tasmania", -42.0, 146.6),
};

/** Energinet's two price areas. */
export const DK_AREAS: Readonly<Record<string, GridAnchor>> = {
  DK1: a("West Denmark (DK1)", 56.0, 9.2),
  DK2: a("East Denmark (DK2)", 55.6, 12.0),
};

/** Great Britain and France, read from their own operators. */
export const GB_ANCHOR = a("Great Britain", 54.0, -2.5);
export const FR_ANCHOR = a("France", 46.6, 2.5);

const has = <T>(o: Readonly<Record<string, T>>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

export const eiaAnchor = (code: string) => has(EIA_BALANCING_AUTHORITIES, code.trim().toUpperCase());
export const aemoAnchor = (code: string) => has(AEMO_REGIONS, code.trim().toUpperCase());
export const dkAnchor = (code: string) => has(DK_AREAS, code.trim().toUpperCase());
