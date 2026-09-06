// Business-/private-jet detection from ADS-B fields — keyless, curated, honest.
//
// The reliable signal is the ICAO *type designator* (adsb.lol's `t`, e.g. GLF6 =
// Gulfstream G650, GLEX = Bombardier Global Express, FA7X = Dassault Falcon 7X).
// These airframes are unambiguously business jets, so a curated set of type codes
// classifies "private jet" accurately — no guessing from altitude/speed.
//
// Naming a specific OWNER is a different, weaker claim: it can only come from a
// curated registration→owner list. Tail numbers are publicly broadcast over ADS-B
// and widely published, but ownership changes and no list is exhaustive — so
// ownerOf() is explicitly "known tail numbers", surfaced in the UI as such, never
// as authoritative. Keep KNOWN_JETS small, sourced, and easy to extend.
//
// Pure + unit-tested; consumed by the aviation ops summary, the detail filter, and
// the jet-surge alert rule.

/**
 * Curated ICAO type designators for business / private jets. Grouped by maker so
 * the list stays legible and auditable. NOT regional airliners (CRJ/E170/etc.) —
 * only purpose-built business airframes.
 */
export const BIZJET_TYPES: ReadonlySet<string> = new Set([
  // Gulfstream
  "GLF2", "GLF3", "GLF4", "GLF5", "GLF6", "GALX", "G150", "G280", "GA5C", "GA6C", "GA7C",
  // Bombardier — Global + Challenger + Learjet
  "GL5T", "GLEX", "GL7T", "GL8T", "CL30", "CL35", "CL60",
  "LJ23", "LJ24", "LJ25", "LJ31", "LJ35", "LJ40", "LJ45", "LJ55", "LJ60", "LJ70", "LJ75",
  // Dassault Falcon. F2TH is the Falcon 2000 family; "F2000" was never a designator
  // and the Falcon 5X was never certified, so neither can match a broadcast type.
  "FA10", "FA20", "FA50", "FA6X", "FA7X", "FA8X", "F900", "F2TH",
  // Cessna Citation
  "C500", "C501", "C510", "C525", "C526", "C550", "C551", "C560", "C56X", "C55B",
  "C650", "C680", "C68A", "C700", "C750", "C25A", "C25B", "C25C", "C25M",
  // Embraer executive. The Legacy 600/650 broadcasts E35L, the Phenoms E50P/E55P
  // and the Praetors E545/E550; "LEG1", "PHEN" and "PRAE" are marketing names, not
  // designators, and could never match.
  "E50P", "E55P", "E545", "E550", "E135", "E35L",
  // Hawker / Beechjet / Premier
  "H25A", "H25B", "H25C", "HDJT", "PRM1", "BE40",
  // Pilatus / HondaJet / others
  "PC24", "SF50", "MU30", "WW24", "ASTR",
]);

/** True when the ICAO type designator names a business/private jet airframe. */
export function isBizjet(typeCode: string | undefined | null): boolean {
  if (!typeCode) return false;
  return BIZJET_TYPES.has(typeCode.trim().toUpperCase());
}

export interface KnownJet {
  /** Human owner/operator label shown as a badge. */
  owner: string;
  /** Optional short tag for grouping (e.g. "gov", "corp"). */
  tag?: string;
}

/**
 * Small, deliberately-modest map of well-documented tail numbers → owner. This is
 * a *starter* set of publicly-reported aircraft, not a surveillance database: it
 * exists to demonstrate the owner-badge feature honestly. Registrations are the
 * ADS-B `r` field, upper-cased. Extend cautiously and only from public sources.
 */
export const KNOWN_JETS: Readonly<Record<string, KnownJet>> = {
  // U.S. government / notable state aircraft (publicly documented).
  "82-8000": { owner: "USAF — VC-25 (Air Force One tail)", tag: "gov" },
  "92-9000": { owner: "USAF — VC-25 (Air Force One tail)", tag: "gov" },
  // Widely-reported corporate/associated tails (public registries). Illustrative.
  "N628TS": { owner: "Reported: Elon Musk (Falcon 900)", tag: "corp" },
  "N272BG": { owner: "Reported: Bill Gates–linked (Cirrus)", tag: "corp" },
  "N887MJ": { owner: "Reported: private (Gulfstream)", tag: "corp" },
};

/** Owner label for a tail number if it's on the curated known list, else null. */
export function ownerOf(registration: string | undefined | null): KnownJet | null {
  if (!registration) return null;
  return KNOWN_JETS[registration.trim().toUpperCase()] ?? null;
}
