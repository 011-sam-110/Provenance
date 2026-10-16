// Pure: resolve a traffic-camera attribution string to its operator's home page,
// so the camera dossier can credit the source with a CLICKABLE link (the product
// rule: every selector shows its data source as a real link). Cameras carry no raw
// upstream URL by design (snapshots are proxied), so the operator home page is the
// honest, stable target. Unknown operators return null → plain-text credit, never a
// fabricated link. Matched case-insensitively on a distinctive substring of the
// attribution, so a small table covers every camera network the app ingests.
//
// No DOM, no fetch — fully unit-testable.

interface CameraProvider {
  /** Case-insensitive substring that identifies the operator in the attribution. */
  match: string;
  /** Short operator name shown as the link text. */
  label: string;
  /** Operator home / open-data page. */
  url: string;
}

const CAMERA_PROVIDERS: CameraProvider[] = [
  { match: "TfL", label: "TfL Open Data", url: "https://tfl.gov.uk/info-for/open-data-users/" },
  { match: "Caltrans", label: "Caltrans", url: "https://dot.ca.gov/" },
  { match: "SCDOT", label: "SCDOT 511", url: "https://www.511sc.org/" },
  { match: "Digitraffic", label: "Fintraffic Digitraffic", url: "https://www.digitraffic.fi/en/" },
  { match: "Fintraffic", label: "Fintraffic Digitraffic", url: "https://www.digitraffic.fi/en/" },
  { match: "DriveBC", label: "DriveBC", url: "https://www.drivebc.ca/" },
  { match: "British Columbia", label: "DriveBC", url: "https://www.drivebc.ca/" },
  { match: "Waka Kotahi", label: "NZTA Waka Kotahi", url: "https://www.nzta.govt.nz/" },
  { match: "NZTA", label: "NZTA Waka Kotahi", url: "https://www.nzta.govt.nz/" },
  { match: "Vegagerðin", label: "Vegagerðin (Iceland)", url: "https://www.vegagerdin.is/" },
  { match: "IRCA", label: "Vegagerðin (Iceland)", url: "https://www.vegagerdin.is/" },
  { match: "Transpordiamet", label: "Transpordiamet (Estonia)", url: "https://www.transpordiamet.ee/" },
  { match: "Tark Tee", label: "Tark Tee (Estonia)", url: "https://tarktee.transpordiamet.ee/" },
  { match: "Traffic Scotland", label: "Traffic Scotland", url: "https://trafficscotland.org/" },
  { match: "Transport Scotland", label: "Traffic Scotland", url: "https://trafficscotland.org/" },
  { match: "TripCheck", label: "ODOT TripCheck", url: "https://tripcheck.com/" },
  { match: "Oregon DOT", label: "ODOT TripCheck", url: "https://tripcheck.com/" },
  // The CARS states and the single-state US adapters added 2026-10-16. Above the bare
  // "511" row on purpose: first match wins, and "511NY" or "511 Virginia" would
  // otherwise resolve to the generic FHWA page instead of the operator's own.
  { match: "511NY", label: "511NY", url: "https://511ny.org/" },
  { match: "511MN", label: "511MN", url: "https://511mn.org/" },
  { match: "511IA", label: "511IA", url: "https://511ia.org/" },
  { match: "511IN", label: "INDOT TrafficWise 511IN", url: "https://511in.org/" },
  { match: "KanDrive", label: "KanDrive", url: "https://www.kandrive.gov/" },
  { match: "COtrip", label: "COtrip", url: "https://www.cotrip.org/" },
  { match: "511 Virginia", label: "511 Virginia", url: "https://511.vdot.virginia.gov/" },
  { match: "Washington State DOT", label: "WSDOT", url: "https://wsdot.wa.gov/" },
  { match: "Mi Drive", label: "Mi Drive (MDOT)", url: "https://mdotjboss.state.mi.us/MiDrive/map" },
  { match: "TxDOT", label: "TxDOT ITS", url: "https://its.txdot.gov/" },
  { match: "511", label: "511 traveler information", url: "https://www.fhwa.dot.gov/trafficinfo/511.htm" },
  { match: "Windy", label: "Windy.com", url: "https://www.windy.com/webcams" },
];

export interface CameraSource {
  label: string;
  url: string;
}

/** Resolve an attribution string to the operator's clickable home page, or null. */
export function cameraProviderLink(attribution: string | undefined | null): CameraSource | null {
  if (!attribution) return null;
  const hay = attribution.toLowerCase();
  for (const p of CAMERA_PROVIDERS) {
    if (hay.includes(p.match.toLowerCase())) return { label: p.label, url: p.url };
  }
  return null;
}
