import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { applyCap } from "@/lib/signals/coverage";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";
import { recordCredentialRefusal } from "@/lib/sources/upstreamEvidence";
import { DIGITRAFFIC_CREDIT, fetchDigitraffic, shipTypeLabel } from "@/lib/signals/aisDigitraffic";
import { BARENTSWATCH_CREDIT, fetchBarentswatch } from "@/lib/signals/aisBarentswatch";

// Real-time ship tracking at strategic chokepoints, from three feeds:
//   AISStream.io  free WebSocket, the only free source for the Gulf, the Red Sea and
//                 the Asian straits. AISSTREAM_API_KEY; dormant without it.
//   Digitraffic   Fintraffic's own receivers, keyless, CC BY 4.0: the Gulf of Finland
//                 (lib/signals/aisDigitraffic.ts).
//   BarentsWatch  Kystverket's, NLOD: the Barents Sea and North Cape. Dormant until
//                 BARENTSWATCH_CLIENT_ID + _SECRET exist (lib/signals/aisBarentswatch.ts).
// The same ship heard by two feeds is shown once, at its newest report. Coverage is
// terrestrial-station AIS (~200 km offshore), so mid-ocean is patchy.
//
// ONE LONG-LIVED SOCKET, NOT ONE PER REQUEST (2026-10-16). The adapter used to open
// the socket inside each fetch, listen for 4.5 s and close it. AIS transponders
// report every 2 s to 3 min (a moored ship every 3 min), so a 4 s window caught a
// small slice of the ships: prod served 15 to 26 vessels over nine chokepoints, and
// Digitraffic showed the effect on a second network (339 vessels heard in 20 s
// against about 1,000 that reported within the hour). Prod is one long-lived Node
// process (deploy/provenance.service), so the socket now stays open: a collector
// keeps the newest report per MMSI, forgets a vessel after VESSEL_TTL_MS, and
// reconnects with backoff. fetch() returns its snapshot without waiting, except on
// the very first call, which waits up to FIRST_WINDOW_MS so a cold start is not an
// empty map. This does NOT work on serverless hosting, where no process lives on.
//
// The collector lives on globalThis behind Symbol.for, not in module scope: Next
// bundles each route separately, so module state is per bundle, and two bundles
// with a socket each would also spend two of AISStream's three connections per IP.

const WS_URL = "wss://stream.aisstream.io/v0/stream";
const WS_HOST = new URL(WS_URL).hostname;

/**
 * Pure: is this the text of an AISStream auth failure, as opposed to some other
 * `{"error": ...}` frame (malformed subscription, throttling)? AISStream answers
 * an invalid/rejected APIKey with exactly `{"error": "Api Key Is Not Valid"}` and
 * closes the socket — confirmed against aisstream/issues#174. Matched loosely
 * (case-insensitive, "api key" + a rejection word) rather than on the exact
 * string so a wording tweak upstream does not silently stop being detected.
 */
export function isAisCredentialError(message: string | undefined | null): boolean {
  if (!message) return false;
  return /api\s*key/i.test(message) && /(not\s*valid|invalid|unauthoriz)/i.test(message);
}

/** A named strategic maritime chokepoint + its bounding box [[swLat,swLon],[neLat,neLon]]. */
export interface Chokepoint {
  name: string;
  bbox: [[number, number], [number, number]];
}

/** Strategic maritime chokepoints (the intel-relevant water) the AIS layer watches. */
export const CHOKEPOINTS: Chokepoint[] = [
  { name: "Strait of Hormuz", bbox: [[24, 54], [27, 58]] },
  { name: "Red Sea – Bab-el-Mandeb", bbox: [[12, 32], [31, 44]] }, // → Suez
  { name: "English Channel", bbox: [[48, -6], [52, 3]] },
  { name: "Malacca – Singapore", bbox: [[1, 98], [6, 105]] },
  { name: "Strait of Gibraltar", bbox: [[35.7, -6.2], [36.3, -5]] },
  { name: "Bosphorus", bbox: [[40.9, 28.8], [41.3, 29.2]] },
  { name: "Panama Canal", bbox: [[8, -80.5], [9.6, -79]] },
  { name: "Taiwan Strait", bbox: [[21.5, 119], [25.5, 122]] },
  { name: "Danish Straits", bbox: [[55, 10], [58, 13]] }, // Baltic approaches
  // Approaches to Primorsk, Ust-Luga and St Petersburg: shadow-fleet tanker routes and
  // the Baltic cable incidents. Digitraffic covers it in full.
  { name: "Gulf of Finland", bbox: [[59, 22], [61, 30.5]] },
  // North Cape approaches to Murmansk. BarentsWatch covers it once its client is set.
  { name: "Barents Sea – North Cape", bbox: [[68, 15], [72, 35]] },
];

/** The bounding boxes in the raw [[swLat,swLon],[neLat,neLon]] shape AISStream subscribes to. */
const chokepointBoxes = (): number[][][] => CHOKEPOINTS.map((c) => c.bbox);

/** Pure: which chokepoint a position falls in (first match), or undefined for open water. */
export function chokepointFor(lat: number, lon: number): string | undefined {
  for (const c of CHOKEPOINTS) {
    const [[swLat, swLon], [neLat, neLon]] = c.bbox;
    if (lat >= swLat && lat <= neLat && lon >= swLon && lon <= neLon) return c.name;
  }
  return undefined;
}

/** Cap on vessels returned (keeps a busy snapshot legible). */
export const AIS_CAP = 1200;
/**
 * A vessel not heard for this long is dropped. A moored or anchored Class A ship
 * reports every 3 min and a Class B every 3 min at most, so 20 min is several
 * missed reports, not one.
 */
export const VESSEL_TTL_MS = 20 * 60_000;
/** The first fetch after a (re)start waits this long for the stream to fill. */
export const FIRST_WINDOW_MS = 4500;
/** For this long after the stream opens, the snapshot is still filling up. */
export const WARM_MS = 2 * 60_000;
/** After a rejected key, wait this long before trying the same key again. */
const REFUSED_RETRY_MS = 30 * 60_000;

export const AISSTREAM_ATTRIBUTION = "Vessel positions © AISStream.io";
/** Each feed's own credit; the layer names all three. */
export const AIS_ATTRIBUTION = [AISSTREAM_ATTRIBUTION, DIGITRAFFIC_CREDIT, BARENTSWATCH_CREDIT].join(" · ");

export interface AisVessel {
  MMSI?: number;
  ShipName?: string;
  latitude?: number | null;
  longitude?: number | null;
  Sog?: number | null; // speed over ground (kt)
  Cog?: number | null; // course over ground (deg)
  TrueHeading?: number | null;
  NavigationalStatus?: number | null;
  time_utc?: string;
  /** Which feed heard it. Absent means AISStream. */
  source?: "AISStream" | "Digitraffic" | "BarentsWatch";
  /** Ship type, where the feed carries it (Digitraffic, BarentsWatch). */
  shipType?: string;
  destination?: string;
}

/** AIS navigational-status code → label (the common ones). */
export function navStatusLabel(code: number | null | undefined): string {
  switch (code) {
    case 0: return "under way (engine)";
    case 1: return "at anchor";
    case 2: return "not under command";
    case 3: return "restricted manoeuvrability";
    case 4: return "constrained by draught";
    case 5: return "moored";
    case 6: return "aground";
    case 7: return "fishing";
    case 8: return "under way (sailing)";
    default: return "—";
  }
}

/** "YYYY-MM-DD HH:MM:SS.sss +0000 UTC" (AISStream) → ISO, or undefined. */
function aisTimeToIso(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!m) return undefined;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

/** Pure: one vessel → a feature, or null when it has no usable position. */
export function vesselFeature(v: AisVessel): SignalFeature | null {
  const lat = typeof v.latitude === "number" ? v.latitude : Number.NaN;
  const lon = typeof v.longitude === "number" ? v.longitude : Number.NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  if (!v.MMSI) return null;
  const name = (v.ShipName ?? "").trim() || `MMSI ${v.MMSI}`;
  const sog = typeof v.Sog === "number" ? v.Sog : null;
  const moving = sog != null && sog > 0.5;
  const cp = chokepointFor(lat, lon);
  return {
    id: `ais:${v.MMSI}`,
    lat,
    lon,
    title: name,
    signalId: "ais",
    color: moving ? "#0d9488" : "#64748b", // under way = teal, stationary = slate
    ts: aisTimeToIso(v.time_utc),
    props: {
      vessel: name,
      mmsi: v.MMSI,
      speed: sog != null ? `${sog.toFixed(1)} kt` : "—",
      // Numeric sibling of `speed` so the chokepoint board can aggregate honestly.
      ...(sog != null ? { speedKt: sog } : {}),
      course: typeof v.Cog === "number" ? `${Math.round(v.Cog)}°` : "—",
      heading: typeof v.TrueHeading === "number" && v.TrueHeading !== 511 ? `${v.TrueHeading}°` : "—",
      status: navStatusLabel(v.NavigationalStatus),
      ...(cp ? { chokepoint: cp } : {}),
      source: v.source ?? "AISStream",
      ...(v.shipType ? { shipType: v.shipType } : {}),
      ...(v.destination ? { destination: v.destination } : {}),
    },
  };
}

/** Time of a vessel report, epoch ms, or -Infinity when it has none. */
function reportedAt(v: AisVessel): number {
  const iso = aisTimeToIso(v.time_utc) ?? v.time_utc;
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

/**
 * Pure: merge vessels from several feeds. A ship heard by two feeds is kept once,
 * with its NEWER report; vessels outside every chokepoint box are dropped, because
 * this layer is the chokepoints and Digitraffic reports the whole Baltic.
 */
export function mergeVessels(...feeds: (AisVessel[] | null | undefined)[]): AisVessel[] {
  const by = new Map<number, AisVessel>();
  for (const feed of feeds) {
    for (const v of feed ?? []) {
      if (!v.MMSI || typeof v.latitude !== "number" || typeof v.longitude !== "number") continue;
      if (!chokepointFor(v.latitude, v.longitude)) continue;
      const prev = by.get(v.MMSI);
      if (!prev || reportedAt(v) > reportedAt(prev)) by.set(v.MMSI, v);
    }
  }
  return [...by.values()];
}

/**
 * Pure: order features so that any PREFIX is a fair share between chokepoints. Each
 * chokepoint gives one vessel in turn (its most recent first), so cutting the list
 * at the cap cannot let a busy strait crowd a quiet one off the map. The old rule
 * kept the first vessels the socket happened to hear.
 */
export function fairShareOrder(features: SignalFeature[]): SignalFeature[] {
  const groups = new Map<string, SignalFeature[]>();
  for (const f of features) {
    const k = String(f.props?.chokepoint ?? "");
    let g = groups.get(k);
    if (!g) groups.set(k, (g = []));
    g.push(f);
  }
  const queues = [...groups.values()].map((g) => g.sort((a, b) => String(b.ts ?? "").localeCompare(String(a.ts ?? ""))));
  const out: SignalFeature[] = [];
  for (let i = 0; out.length < features.length; i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/** Pure: at most `cap` features, shared fairly between chokepoints. */
export function fairShareCap(features: SignalFeature[], cap: number): SignalFeature[] {
  return cap > 0 && features.length > cap ? fairShareOrder(features).slice(0, cap) : features.slice();
}

export const CAP_RULE = "an equal share per chokepoint, most recent first — not a ranking";

/** Pure: vessel snapshots → SignalFeature[], capped fairly. Skips vessels with no position. */
export function normalizeAis(vessels: AisVessel[], rule: string = CAP_RULE): SignalFeature[] {
  const out: SignalFeature[] = [];
  for (const v of vessels) {
    const f = vesselFeature(v);
    if (f) out.push(f);
  }
  // One truncation, and the denominator is real: the stream is not closed at the cap
  // any more, so `available` is every vessel heard inside the TTL.
  return applyCap(out.length > AIS_CAP ? fairShareOrder(out) : out, AIS_CAP, {
    noun: "vessels",
    rule,
  });
}

/** Pure: the vessels heard within `ttlMs` of `now`. */
export function liveVessels(
  heard: ReadonlyMap<number, { vessel: AisVessel; heardAt: number }>,
  now: number,
  ttlMs: number = VESSEL_TTL_MS,
): AisVessel[] {
  const out: AisVessel[] = [];
  for (const { vessel, heardAt } of heard.values()) if (now - heardAt <= ttlMs) out.push(vessel);
  return out;
}

/** Pure: delete the vessels older than `ttlMs` (keeps the map from growing without end). */
export function pruneHeard(heard: Map<number, { vessel: AisVessel; heardAt: number }>, now: number, ttlMs = VESSEL_TTL_MS): void {
  for (const [mmsi, h] of heard) if (now - h.heardAt > ttlMs) heard.delete(mmsi);
}

// --- static data: what kind of ship -----------------------------------------
//
// A position report carries no ship type. Measured on production 2026-10-24: 993 of
// the 1,200 vessels served had none, because only Digitraffic and BarentsWatch send
// one. AIS message 5 (ShipStaticData) carries it, on the same socket and the same key:
// a Class A ship sends it every 6 minutes. It is kept per MMSI, apart from the
// positions, and joined to a vessel's newest position when the snapshot is taken.

/** What the stream is asked for. Both on every (re)connect. */
export const AIS_MESSAGE_TYPES = ["PositionReport", "ShipStaticData"] as const;

/** Pure: the subscription frame AISStream expects within 3 s of the socket opening. */
export function subscriptionMessage(key: string): string {
  return JSON.stringify({ APIKey: key, BoundingBoxes: chokepointBoxes(), FilterMessageTypes: AIS_MESSAGE_TYPES });
}

/** A ship's type does not change between reports; six hours spans a long passage. */
export const STATIC_TTL_MS = 6 * 3_600_000;

export interface AisStatic {
  shipType?: string;
  destination?: string;
  heardAt: number;
}

/**
 * Pure: the useful part of a ShipStaticData message, or null when it has none. The
 * destination is typed in by the crew and padded with `@` by the protocol; empty
 * after trimming means none.
 */
export function staticFromMessage(
  msg: { Type?: number | null; Destination?: string | null } | undefined,
  heardAt: number,
): AisStatic | null {
  if (!msg) return null;
  const shipType = shipTypeLabel(typeof msg.Type === "number" ? msg.Type : undefined);
  const destination = (msg.Destination ?? "").replace(/@+/g, " ").trim() || undefined;
  if (!shipType && !destination) return null;
  return { ...(shipType ? { shipType } : {}), ...(destination ? { destination } : {}), heardAt };
}

/** Pure: a vessel with its static data joined in. A feed's own value is never replaced. */
export function withStatic(v: AisVessel, s: AisStatic | undefined): AisVessel {
  if (!s) return v;
  return {
    ...v,
    ...(v.shipType || !s.shipType ? {} : { shipType: s.shipType }),
    ...(v.destination || !s.destination ? {} : { destination: s.destination }),
  };
}

/** Pure: forget static data not heard for `ttlMs`. */
export function pruneStatics(statics: Map<number, AisStatic>, now: number, ttlMs = STATIC_TTL_MS): void {
  for (const [mmsi, s] of statics) if (now - s.heardAt > ttlMs) statics.delete(mmsi);
}

/** Pure: reconnect delay after `attempt` failures: 2 s doubling to 5 min, with jitter. */
export function reconnectDelay(attempt: number, rand: number = Math.random()): number {
  const base = Math.min(5 * 60_000, 2000 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.75 + 0.5 * rand));
}

// --- the long-lived collector ------------------------------------------------

interface Collector {
  key: string;
  ws: WebSocket | null;
  heard: Map<number, { vessel: AisVessel; heardAt: number }>;
  /** Ship type and destination per MMSI, from ShipStaticData. */
  statics: Map<number, AisStatic>;
  /** When the current socket opened. Null while not connected. */
  openedAt: number | null;
  /** When this collector first connected; the snapshot is warm after WARM_MS. */
  firstOpenAt: number | null;
  lastMessageAt: number | null;
  /** The last socket failure, cleared by the next message. */
  failure?: string;
  refusedAt: number | null;
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  /** Resolved on the first message or the first failure, for the cold-start wait. */
  settle: (() => void)[];
}

const COLLECTOR = Symbol.for("provenance.ais.collector");
type Holder = { [COLLECTOR]?: Collector };

function wake(c: Collector) {
  const list = c.settle.splice(0);
  for (const f of list) f();
}

function connect(c: Collector) {
  if (c.stopped) return;
  let ws: WebSocket;
  try {
    ws = new WebSocket(WS_URL);
  } catch {
    c.failure = "socket failed";
    wake(c);
    schedule(c);
    return;
  }
  c.ws = ws;
  ws.binaryType = "arraybuffer";
  const decoder = new TextDecoder();
  ws.onopen = () => {
    c.openedAt = Date.now();
    c.firstOpenAt ??= c.openedAt;
    c.failure = undefined;
    // AISStream drops a socket that has not subscribed within 3 s of opening, so the
    // full subscription goes on every (re)connect.
    ws.send(subscriptionMessage(c.key));
  };
  ws.onmessage = (e: MessageEvent) => {
    const txt = typeof e.data === "string" ? e.data : decoder.decode(e.data as ArrayBuffer);
    try {
      const m = JSON.parse(txt) as {
        error?: string;
        MessageType?: string;
        MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number; time_utc?: string };
        Message?: {
          PositionReport?: { Sog?: number; Cog?: number; TrueHeading?: number; NavigationalStatus?: number };
          ShipStaticData?: { Type?: number; Destination?: string };
        };
      };
      // upstreamEvidence.ts wraps fetch() to catch 401/402/403s, which structurally
      // cannot see this — AIS speaks WebSocket. This is the one AISStream frame that
      // genuinely means "our credential was rejected" (not a timeout, not a closed
      // socket, not just zero PositionReports), so it is the only case that files a
      // refusal. Status 401 stands in for "invalid credential" — there is no real
      // HTTP status here, but the ledger's shape expects one and 401 is the honest
      // read of "Api Key Is Not Valid".
      if (typeof m.error === "string") {
        if (isAisCredentialError(m.error)) {
          recordCredentialRefusal("ais", 401, WS_HOST);
          c.failure = "key rejected";
          c.refusedAt = Date.now();
          try { ws.close(); } catch { /* already closing */ }
        } else {
          c.failure = "upstream error";
        }
        wake(c);
        return;
      }
      const mmsi = m.MetaData?.MMSI;
      if (m.MessageType === "ShipStaticData" && mmsi) {
        const s = staticFromMessage(m.Message?.ShipStaticData, Date.now());
        if (s) c.statics.set(mmsi, s);
        return;
      }
      if (m.MessageType !== "PositionReport" || !mmsi) return;
      const md = m.MetaData!, pr = m.Message?.PositionReport ?? {};
      const now = Date.now();
      c.heard.set(mmsi, {
        heardAt: now,
        vessel: {
          MMSI: mmsi, ShipName: md.ShipName, latitude: md.latitude, longitude: md.longitude,
          Sog: pr.Sog, Cog: pr.Cog, TrueHeading: pr.TrueHeading, NavigationalStatus: pr.NavigationalStatus,
          time_utc: md.time_utc,
        },
      });
      c.lastMessageAt = now;
      c.failure = undefined;
      c.attempt = 0;
    } catch { /* skip malformed frame */ }
  };
  ws.onerror = () => {
    c.failure ??= "socket error";
  };
  ws.onclose = () => {
    if (c.ws === ws) c.ws = null;
    c.openedAt = null;
    c.failure ??= "socket closed";
    wake(c);
    schedule(c);
  };
}

function schedule(c: Collector) {
  if (c.stopped || c.timer) return;
  // A rejected key is not retried in a tight loop: AISStream would see a hammering
  // client, and the key will not start working by itself.
  const delay = c.refusedAt != null ? REFUSED_RETRY_MS : reconnectDelay(c.attempt++);
  c.timer = setTimeout(() => {
    c.timer = null;
    c.refusedAt = null;
    connect(c);
  }, delay);
  // Never hold the process open for a reconnect.
  (c.timer as { unref?: () => void }).unref?.();
}

function stop(c: Collector) {
  c.stopped = true;
  if (c.timer) clearTimeout(c.timer);
  c.timer = null;
  try { c.ws?.close(); } catch { /* already closing */ }
  c.ws = null;
  wake(c);
}

/** The process-wide collector for this key, created (and connected) on first use. */
function collectorFor(key: string): { c: Collector; fresh: boolean } {
  const holder = globalThis as Holder;
  const existing = holder[COLLECTOR];
  if (existing && existing.key === key && !existing.stopped) return { c: existing, fresh: false };
  if (existing) stop(existing); // the key changed: start over with the new one
  const c: Collector = {
    key,
    ws: null,
    heard: new Map(),
    statics: new Map(),
    openedAt: null,
    firstOpenAt: null,
    lastMessageAt: null,
    refusedAt: null,
    attempt: 0,
    timer: null,
    stopped: false,
    settle: [],
  };
  holder[COLLECTOR] = c;
  connect(c);
  return { c, fresh: true };
}

/** Test hook: close the socket, cancel any reconnect and forget everything heard. */
export function resetAisCollector(): void {
  const holder = globalThis as Holder;
  const c = holder[COLLECTOR];
  if (c) stop(c);
  delete holder[COLLECTOR];
}

/** Wait until the first message or failure, or `ms`, whichever is first. */
function firstWindow(c: Collector, ms: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(finish, ms);
    // Not ended by the first position report: the window is there to let several
    // arrive. Only a failure ends it early (wake() runs on failures alone).
    if (c.failure) finish();
    else c.settle.push(finish);
  });
}

/** The coverage rule for the snapshot: what "these vessels" means right now. */
export function snapshotRule(firstOpenAt: number | null, now: number): string {
  if (firstOpenAt == null || now - firstOpenAt < WARM_MS) {
    return "vessels heard since the stream opened under 2 min ago, still filling — an equal share per chokepoint, not a ranking";
  }
  return `vessels heard in the last ${Math.round(VESSEL_TTL_MS / 60_000)} min — ${CAP_RULE}`;
}

export const AIS_SOURCE: SignalSource = {
  id: "ais",
  // A reported AIS position.
  precision: "exact",
  label: "Ships (AIS chokepoints)",
  group: "Maritime",
  color: "#0d9488",
  refreshMs: 60_000, // a snapshot of the long-lived stream, at most ~once a minute
  attribution: AIS_ATTRIBUTION,
  sourceUrl: "https://aisstream.io/", // real-time AIS stream (dossier source)
  async fetch() {
    const key = (process.env.AISSTREAM_API_KEY ?? "").trim();
    try {
      const barents = CHOKEPOINTS.find((c) => c.name.startsWith("Barents"))!.bbox;
      // The collector is started before anything is awaited, so its socket opens at
      // once and a cold start's first window runs alongside the two REST reads.
      const held = key ? collectorFor(key) : null;
      const [digitraffic, barentswatch] = await Promise.all([
        fetchDigitraffic(VESSEL_TTL_MS),
        fetchBarentswatch(barents, VESSEL_TTL_MS),
        held?.fresh ? firstWindow(held.c, FIRST_WINDOW_MS) : Promise.resolve(),
      ]);
      let stream: AisVessel[] = [];
      let streamFailure: string | undefined;
      let streamDown = false;
      let firstOpenAt: number | null = null;
      let lastMessageAt: number | null = null;
      if (held) {
        const { c } = held;
        const t = Date.now();
        pruneHeard(c.heard, t);
        pruneStatics(c.statics, t);
        stream = liveVessels(c.heard, t).map((v) => withStatic(v, v.MMSI ? c.statics.get(v.MMSI) : undefined));
        streamFailure = c.failure;
        streamDown = !c.ws && Boolean(c.failure);
        firstOpenAt = c.firstOpenAt;
        lastMessageAt = c.lastMessageAt;
      }
      const now = Date.now();
      const vessels = mergeVessels(stream, digitraffic, barentswatch);
      // Nothing heard anywhere and nothing answered: that is the upstreams, not quiet
      // water — the chokepoints are never empty.
      if (vessels.length === 0 && !digitraffic && !barentswatch && (!key || streamFailure)) {
        return degraded(streamFailure ?? "no key");
      }
      const features = normalizeAis(vessels, snapshotRule(key ? firstOpenAt : now - WARM_MS, now));
      // The AISStream socket is down: serve what is still inside the TTL plus the
      // REST feeds, and say the main stream is not live right now.
      if (key && streamDown) return degradedWith(features, streamFailure!, lastMessageAt ?? now);
      return observed(features, now);
    } catch {
      return degraded("read failed");
    }
  },
};
