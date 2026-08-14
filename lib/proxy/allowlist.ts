// Each rule is host + required path prefix (+ optional suffix). Adding a source
// = adding a rule. SCDOT snapshots live at the host root as `/<id>.png`, so that
// rule pins the suffix instead of a deep prefix to stay tight.
const RULES: { host: string; prefix: string; suffix?: string }[] = [
  { host: "s3-eu-west-1.amazonaws.com", prefix: "/jamcams.tfl.gov.uk/" },
  { host: "cwwp2.dot.ca.gov", prefix: "/data/" },
  { host: "scdotsnap.us-east-1.skyvdn.com", prefix: "/", suffix: ".png" },
  { host: "weathercam.digitraffic.fi", prefix: "/", suffix: ".jpg" },
  // Castle Rock "511" snapshots — one host per system, all serving /map/Cctv/{id}.
  { host: "fl511.com", prefix: "/map/Cctv/" },
  { host: "511ga.org", prefix: "/map/Cctv/" },
  { host: "511ny.org", prefix: "/map/Cctv/" },
  { host: "511.idaho.gov", prefix: "/map/Cctv/" },
  { host: "newengland511.org", prefix: "/map/Cctv/" },
  { host: "511on.ca", prefix: "/map/Cctv/" },
  { host: "511.alberta.ca", prefix: "/map/Cctv/" },
  { host: "511.novascotia.ca", prefix: "/map/Cctv/" },
  { host: "511.gnb.ca", prefix: "/map/Cctv/" },
  // Oregon TripCheck — filenames are mixed-case .jpg/.JPG, so no suffix pin.
  { host: "tripcheck.com", prefix: "/RoadCams/cams/" },
  // DriveBC (British Columbia).
  { host: "www.drivebc.ca", prefix: "/images/", suffix: ".jpg" },
  // NZTA / Waka Kotahi (New Zealand) — snapshots at /camera/{id}.jpg.
  { host: "trafficnz.info", prefix: "/camera/", suffix: ".jpg" },
  // Iceland Vegagerðin — full JPEG URLs under /vgdata/vefmyndavelar/.
  { host: "www.vegagerdin.is", prefix: "/vgdata/vefmyndavelar/", suffix: ".jpg" },
  // Estonia Tark Tee — timestamped snapshots under /images/.
  { host: "tarktee.transpordiamet.ee", prefix: "/images/", suffix: ".jpg" },
  // Scotland Traffic Scotland — the "image" is the camerahtml page; the proxy
  // fetches it and extracts the embedded base64 JPEG (not a direct .jpg).
  { host: "www.traffic.gov.scot", prefix: "/tsis/camerahtml" },
  // CET São Paulo — snapshots at /cams/{pasta}/1.jpg.
  { host: "cameras.cetsp.com.br", prefix: "/cams/", suffix: ".jpg" },
  // Windy.com webcams — image CDN. URLs look like
  // /_/<size>/plain/<current|daylight>/<webcamId>/original.jpg (the Webcams layer,
  // a DISTINCT layer from road CCTV; resolved fresh by /api/webcam-image).
  { host: "imgproxy.windy.com", prefix: "/_/" },
];

export function isAllowed(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return RULES.some(
    (r) =>
      url.hostname === r.host &&
      url.pathname.startsWith(r.prefix) &&
      (!r.suffix || url.pathname.endsWith(r.suffix)),
  );
}
