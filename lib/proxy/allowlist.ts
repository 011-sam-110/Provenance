import { neUtmcAuthHeader } from "@/lib/sources/ne-utmc";
import { ottawaCertParams } from "@/lib/sources/ottawa";
import { COMPATIBLE_UA } from "@/lib/sources/feedKit";

// Each rule is host + required path prefix (+ optional suffix). Adding a source
// = adding a rule. SCDOT snapshots live at the host root as `/<id>.png`, so that
// rule pins the suffix instead of a deep prefix to stay tight.
interface Rule {
  host: string;
  prefix: string;
  suffix?: string;
  port?: string;
  /**
   * Request headers this host needs, added on the server only: a credential that
   * must never reach a browser, or an agent string the host insists on. Read per
   * request so a key added to the environment takes effect without a restart.
   */
  headers?: () => Record<string, string>;
  /** Query parameters added on the server only (a certificate in the URL). */
  query?: () => Record<string, string> | null;
}

// The crawler-form agent some hosts insist on; see lib/sources/feedKit.ts.
export { COMPATIBLE_UA };

const THB_HOSTS: Rule[] = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
  host: "cctv-ss0" + n + ".thb.gov.tw",
  prefix: "/",
  suffix: "/snapshot",
}));

const RULES: Rule[] = [
  { host: "s3-eu-west-1.amazonaws.com", prefix: "/jamcams.tfl.gov.uk/" },
  { host: "cwwp2.dot.ca.gov", prefix: "/data/" },
  { host: "scdotsnap.us-east-1.skyvdn.com", prefix: "/", suffix: ".png" },
  { host: "weathercam.digitraffic.fi", prefix: "/", suffix: ".jpg" },
  // Castle Rock "511" snapshots — one host per system, all serving /map/Cctv/{id}.
  { host: "fl511.com", prefix: "/map/Cctv/" },
  { host: "511ga.org", prefix: "/map/Cctv/" },
  { host: "511.idaho.gov", prefix: "/map/Cctv/" },
  { host: "newengland511.org", prefix: "/map/Cctv/" },
  // Louisiana DOTD. Its system joined castlerock on 2026-09-05 without this rule, so
  // its 336 pins drew on the map and every one of them answered 403 "forbidden host"
  // (measured on prod 2026-10-16). `allowlist.test.ts` now checks every system.
  { host: "511la.org", prefix: "/map/Cctv/" },
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
  // JP Putevi Srbije toll plazas — one poster JPEG per camera, always at
  // /{camera-slug}/index.jpg, so the suffix pins the filename and not just the
  // extension. TWO hosts because the operator splits them: the front-plaza
  // cameras post to cam, the side-plaza cameras to jpps. Both also serve the
  // HLS, which is a separate rule in hls-allowlist.ts and needs a Referer; the
  // JPEG does not.
  { host: "cam.bitinfo.co.rs", prefix: "/", suffix: "/index.jpg" },
  { host: "jpps.bitinfo.co.rs", prefix: "/", suffix: "/index.jpg" },
  // BIHAMK (Bosnia and Herzegovina) — one still per site at
  // /videosurveillence/{KEY}.jpg on the club's own host. The operator's own
  // spelling of that path segment, typo and all; do not "correct" it or every
  // Bosnian camera 404s.
  { host: "video-nadzor.bihamk.ba", prefix: "/videosurveillence/", suffix: ".jpg" },
  // ACT Puerto Rico — ITS stills at /images/cameras/{name}.jpg.
  { host: "its.act.pr.gov", prefix: "/images/cameras/", suffix: ".jpg" },
  // Houston TranStar, the network admitted through discovery (discovered.data.ts).
  // Promote wrote the feed row and nothing wrote this rule, so its 451 pins answered
  // 403 "forbidden host" from 2026-08-20 to 2026-10-16. The descriptor upgrades the
  // catalogue's http URLs, so the proxy only ever sees https.
  { host: "www.houstontranstar.org", prefix: "/snapshots/cctv/", suffix: ".jpg" },
  // CARS platform states (lib/sources/cars.ts). The adapter keeps a view only when
  // its still passes THIS list, so a rule here is what admits a picture host, and a
  // host missing here costs the cameras, never a 403 pin. All measured 200 image/jpeg
  // with no redirect on 2026-10-16. File names carry mixed extensions (.png that is a
  // JPEG, .jpeg, .JPG, none), so no suffix pin; the path prefix is the tight part.
  { host: "public.carsprogram.org", prefix: "/cameras/" }, // NYSDOT, MnDOT, INDOT previews
  { host: "atmsqf.iowadot.gov", prefix: "/SNAPSHOTS/" }, // Iowa DOT, video previews
  { host: "atmsqf.iowadot.gov", prefix: "/snapshots/" }, // Iowa DOT, rest-area stills
  { host: "kscam.carsprogram.org", prefix: "/" }, // KDOT stills and video previews
  { host: "www.kcscout.net", prefix: "/TransSuite.VCS.CameraSnapshots/" }, // KC Scout
  { host: "cocam.carsprogram.org", prefix: "/" }, // CDOT, Douglas County
  // 511 Virginia (VDOT) stills, at the host root as /<id>.png once the /thumbs/ redirect
  // is resolved in the adapter, the same layout as the SCDOT host above.
  { host: "snapshot.vdotcameras.com", prefix: "/", suffix: ".png" },
  // WSDOT stills. Region folders (nw, sw, orflow, airports...) and one .JPG, so the
  // host is the pin: it serves camera images and nothing else we know of.
  { host: "images.wsdot.wa.gov", prefix: "/" },
  // Mi Drive (Michigan DOT). Road stills at the host root once the /thumbs/ redirect
  // is resolved in the adapter, and weather-station stills on MDOT's own server.
  { host: "micamerasimages.net", prefix: "/", suffix: ".jpg" },
  { host: "mdotjboss.state.mi.us", prefix: "/docs/drive/camfiles/", suffix: ".jpg" },
  // TxDOT ITS. Not an image path: the snapshot endpoint answers JSON with a base64
  // JPEG, which /api/proxy decodes (see proxyTxdot in app/api/proxy/route.ts).
  { host: "its.txdot.gov", prefix: "/its/DistrictIts/GetCctvSnapshotByIcdId" },
  // Windy.com webcams — image CDN. URLs look like
  // /_/<size>/plain/<current|daylight>/<webcamId>/original.jpg (the Webcams layer,
  // a DISTINCT layer from road CCTV; resolved fresh by /api/webcam-image).
  { host: "imgproxy.windy.com", prefix: "/_/" },
  // --- Added in the source audit of 2026-10-16 -------------------------------
  // Norway, Statens vegvesen: /api/images/{cameraId}, no file suffix.
  { host: "kamera.atlas.vegvesen.no", prefix: "/api/images/" },
  // Spain, DGT.
  { host: "etraffic.dgt.es", prefix: "/camarasEtraffic/", suffix: ".jpg" },
  // France, Metropole de Lyon (Criter). Upper-case .JPG, so no suffix pin.
  { host: "download.data.grandlyon.com", prefix: "/files/rdata/pvo_patrimoine_voirie.pvocameracriter/" },
  // Lithuania, Via Lietuva: the camera id is a query parameter.
  { host: "eismoinfo.lt", prefix: "/eismoinfo-backend-v2/image-provider/camera/last" },
  // Hong Kong, Transport Department.
  { host: "tdcctv.data.one.gov.hk", prefix: "/", suffix: ".JPG" },
  // Queensland, TMR (traffic and flood cameras share the host).
  { host: "cameras.qldtraffic.qld.gov.au", prefix: "/" },
  // New South Wales, Transport for NSW. Refuses non-browser agents; see COMPATIBLE_UA.
  {
    host: "webcams.transport.nsw.gov.au",
    prefix: "/livetraffic-webcams/cameras/",
    headers: () => ({ "User-Agent": COMPATIBLE_UA, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" }),
  },
  // Taiwan, Highway Bureau: eight snapshot hosts, each /{camera}/snapshot.
  ...THB_HOSTS,
  // Bellingen Shire Council flood cameras, hosted by its flood-warning supplier.
  { host: "public.disasterwatch-iotp.com.au", prefix: "/prospectpublicimages/" },
  // USGS streamgage cameras (NIMS).
  { host: "usgs-nims-images.s3.amazonaws.com", prefix: "/overlay/", suffix: "_newest.jpg" },
  // ALERTCalifornia.
  { host: "cameras.alertcalifornia.org", prefix: "/public-camera-data/", suffix: "/latest-frame.jpg" },
  // Alaska Volcano Observatory.
  { host: "avo.alaska.edu", prefix: "/ashcam-api/images/", suffix: ".jpg" },
  // City of Toronto RESCU.
  { host: "opendata.toronto.ca", prefix: "/transportation/tmc/rescucameraimages/CameraImages/", suffix: ".jpg" },
  // City of Calgary.
  { host: "trafficcam.calgary.ca", prefix: "/", suffix: ".jpg" },
  // City of Vancouver.
  { host: "trafficcams.vancouver.ca", prefix: "/cameraimages/", suffix: ".jpg" },
  // Tamar Crossings: one PHP endpoint, the camera is a query parameter.
  { host: "www.tamarcrossings.org.uk", prefix: "/wp-content/themes/tamar/php/webcam-load.php" },
  // Tyne and Wear UTMC: Basic auth from NE_UTMC_USER / NE_UTMC_PASS, added here.
  {
    host: "www.netraveldata.co.uk",
    prefix: "/api/v2/cctv/",
    headers: (): Record<string, string> => {
      const auth = neUtmcAuthHeader();
      return auth ? { Authorization: auth } : {};
    },
  },
  // City of Ottawa: the certificate is added here, never stored in a camera's URL.
  { host: "traffic.ottawa.ca", prefix: "/opendata/camera", query: () => ottawaCertParams() },
  // Castle Rock My511 systems on the keyed API (Manitoba, Newfoundland and Labrador, Yukon).
  { host: "www.manitoba511.ca", prefix: "/map/Cctv/" },
  { host: "511nl.ca", prefix: "/map/Cctv/" },
  { host: "511yukon.ca", prefix: "/map/Cctv/" },
  // Slovenia, DARS and DRSI. The images themselves need no credential.
  { host: "kamere.dars.si", prefix: "/" },
];

function ruleFor(url: URL): Rule | undefined {
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return RULES.find(
    (r) =>
      url.hostname === r.host &&
      url.port === (r.port ?? "") &&
      url.pathname.startsWith(r.prefix) &&
      (!r.suffix || url.pathname.endsWith(r.suffix)),
  );
}

/**
 * The request the proxy should actually send for an allowed URL: the URL with any
 * server-only query parameters added, and the headers the host needs. Null for a URL
 * no rule allows, and for a rule whose server-only parameter is missing (a dormant
 * credential), so the proxy refuses rather than asking without it.
 */
export function upstreamRequest(url: URL): { url: string; headers: Record<string, string> } | null {
  const rule = ruleFor(url);
  if (!rule) return null;
  const target = new URL(url.toString());
  if (rule.query) {
    const q = rule.query();
    if (!q) return null;
    for (const [k, v] of Object.entries(q)) target.searchParams.set(k, v);
  }
  return { url: target.toString(), headers: rule.headers?.() ?? {} };
}

/**
 * THE PORT IS PART OF THE ADDRESS, and matching only the hostname left it open.
 * `new URL()` normalises a scheme's own port away — `https://host:443` and
 * `http://host:80` both report `url.port === ""` — so an empty string here means
 * "the default for this scheme", and anything else is a port somebody asked for
 * explicitly. Every rule below wants the default, so `r.port ?? ""` is the whole
 * expression; a rule that needs a real port declares one (see hls-allowlist.ts,
 * where the Serbian MUP host genuinely serves on 4443).
 *
 * Without this, `https://fl511.com:22/map/Cctv/x` passed the gate. That reaches
 * no cloud metadata and no internal address — the hostname match already stops
 * that — but it does turn this deployment into a way to knock on arbitrary ports
 * of the allowlisted hosts, which are mostly state transport agencies, from
 * Vercel's IP rather than the caller's.
 */
export function isAllowed(url: URL): boolean {
  return ruleFor(url) !== undefined;
}
