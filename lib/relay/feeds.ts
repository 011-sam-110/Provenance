// lib/relay/feeds.ts
// The allowlist of relay feeds: which ids POST /api/relay/[feed] accepts, the zod schema
// each one's `data` must pass, and the byte cap on its body. A feed id that is not in
// this table is a 404 before a byte of the body is read, so an arbitrary path segment
// can never create a store entry.
//
// EVERY SCHEMA HERE TREATS THE BODY AS HOSTILE. It is signed, so it came from our own
// scraper, but "signed by our machine" and "correct" are different claims and only the
// first is checked by the crypto. A scraper whose upstream changed its page shape should
// be refused here (422) rather than publish a half-parsed snapshot.
//
// THE SENDER is the `sources` package in the NewsScraper repo (github.com/011-sam-110/
// NewsScraper, `python -m sources push <feed>`). Each module there names the feed id it
// pushes, and its payload shape must match the schema below.
import { z } from "zod";
import { frontlineChangesSchema } from "@/lib/relay/schemas/frontline-changes";
import { lossTotalsSchema } from "@/lib/relay/schemas/loss-totals";
import { lossesRuSchema } from "@/lib/relay/schemas/losses-ru";
import { lossesUaSchema } from "@/lib/relay/schemas/losses-ua";
import { warNewsSchema } from "@/lib/relay/schemas/war-news";
import { warZonesSchema } from "@/lib/relay/schemas/war-zones";

const KiB = 1024;
const MiB = 1024 * KiB;

/** ISO 3166-1 alpha-2, upper case. */
const iso2 = z.string().regex(/^[A-Z]{2}$/);
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoInstant = z.string().refine((s) => Number.isFinite(Date.parse(s)), "not an ISO timestamp");
const lat = z.number().gte(-90).lte(90);
const lon = z.number().gte(-180).lte(180);
const httpsUrl = z
  .string()
  .url()
  .refine((s) => s.startsWith("https://"), "https only");

// --- celestrak -------------------------------------------------------------------

/**
 * Must equal SATELLITE_GROUPS in lib/sources/celestrak.ts. Duplicated rather than
 * imported because celestrak.ts imports the store, and the store imports this file;
 * tests/unit/relay-feeds.test.ts pins the two lists together.
 */
export const RELAY_TLE_GROUPS = ["visual", "stations"] as const;

/** Raw CelesTrak 3-line TLE text per group. Parsed on this side by parseTle. */
const tleText = z
  .string()
  .max(1 * MiB)
  .refine((s) => /^1 \d{5}/m.test(s) && /^2 \d{5}/m.test(s), "no TLE lines");

export const celestrakSchema = z
  .object({
    groups: z.object({ visual: tleText.optional(), stations: tleText.optional() }).strict(),
  })
  .refine((d) => Object.keys(d.groups).length > 0, "no groups");

// --- nrcan-magnetic --------------------------------------------------------------

const zoneReading = z.object({
  /** NRCan's own word, lower case: quiet, unsettled, active, stormy, major storm. */
  level: z.string().min(1).max(32),
  /** The "+ Active intervals" part, lower case, or null. */
  intervals: z.string().min(1).max(32).nullable(),
});
const zoneSet = z.object({ polar: zoneReading, auroral: zoneReading, subauroral: zoneReading });

export const nrcanMagneticSchema = z.object({
  issuedAt: isoInstant,
  windows: z.object({
    last24h: zoneSet,
    last6h: zoneSet,
    current: zoneSet.optional(),
    next6h: zoneSet,
    next24h: zoneSet,
  }),
});

// --- jma-volcam ------------------------------------------------------------------

export const jmaVolcamSchema = z.object({
  cameras: z
    .array(
      z.object({
        /** The `VC=` code on volcam.php, e.g. "10401". */
        code: z.string().regex(/^\d{4,6}$/),
        /** The volcano, as JMA names it, e.g. "アトサヌプリ". */
        volcano: z.string().min(1).max(64),
        /** The camera's site, as JMA names it, e.g. "北東山麓". */
        site: z.string().min(1).max(64),
        lat,
        lon,
        /** The newest frame on www.data.jma.go.jp. Never another host. */
        imageUrl: httpsUrl.refine((s) => s.startsWith("https://www.data.jma.go.jp/"), "not a JMA frame"),
        frameAt: isoInstant,
      }),
    )
    .min(1)
    .max(300),
});

// --- sjofartsverket-navwarn ------------------------------------------------------

export const navwarnSchema = z.object({
  warnings: z
    .array(
      z.object({
        /** e.g. "BALTIC SEA NAV WARN 030/26". */
        id: z.string().min(1).max(64),
        issuedAt: isoInstant,
        /** The page's area headings this warning is listed under, e.g. "Southern Baltic". */
        areas: z.array(z.string().min(1).max(80)).min(1).max(40),
        text: z.string().min(1).max(4000),
      }),
    )
    .max(500),
});

// --- shadowserver ----------------------------------------------------------------

const shadowserverSchema = (source: "beacon" | "sinkhole") =>
  z.object({
    source: z.literal(source),
    /** The UTC day the counts are for. The dashboard runs a day behind. */
    day: isoDay,
    /** ISO2 -> unique IPs that day. */
    counts: z.record(iso2, z.number().int().nonnegative()),
  });

export const shadowserverBeaconSchema = shadowserverSchema("beacon");
export const shadowserverSinkholeSchema = shadowserverSchema("sinkhole");

// --- eea-aqi ---------------------------------------------------------------------

export const eeaAqiSchema = z.object({
  /** The hour the map file is for, e.g. "2026-10-16T18:00:00Z". */
  hour: isoInstant,
  stations: z
    .array(
      z.object({
        code: z.string().regex(/^[A-Za-z0-9._-]{2,32}$/),
        name: z.string().min(1).max(120),
        lat,
        lon,
        municipality: z.string().max(120).nullable(),
        /** The European AQI as the EEA map file gives it: a float from 1 (good) to 6. */
        aqi: z.number().gte(0).lte(7),
      }),
    )
    .max(8000),
});

// --- breach disclosures ----------------------------------------------------------

const intOrNull = z.number().int().nonnegative().nullable();

export const hhsOcrBreachSchema = z.object({
  rows: z
    .array(
      z.object({
        entity: z.string().min(1).max(300),
        /** US state or territory, two letters. */
        state: z.string().regex(/^[A-Z]{2}$/),
        entityType: z.string().max(80),
        individuals: intOrNull,
        submittedOn: isoDay,
        breachType: z.string().max(200),
        location: z.string().max(200),
      }),
    )
    .max(3000),
});

export const texasAgBreachSchema = z.object({
  rows: z
    .array(
      z.object({
        /** The AG's record id, e.g. "BR-0005419". */
        id: z.string().regex(/^BR-\d+$/),
        entity: z.string().min(1).max(300),
        entityType: z.string().max(120).nullable(),
        // No street address: the record carries one and this app does not need it.
        city: z.string().max(120).nullable(),
        state: z.string().max(60).nullable(),
        zip: z.string().max(12).nullable(),
        texans: intOrNull,
        total: intOrNull,
        publishedOn: isoDay,
        infoTypes: z.array(z.string().max(200)).max(40),
      }),
    )
    .max(3000),
});

// --- the table ---------------------------------------------------------------------

export interface RelayFeedSpec {
  label: string;
  schema: z.ZodTypeAny;
  /** Ceiling on the UNCOMPRESSED body, and on the wire. */
  maxBytes: number;
  /**
   * How old a snapshot may be (by its `fetchedAt`) before readers treat it as gone.
   * Generous on purpose: this is the line between "late" and "dead", not a freshness
   * target. Each reader returns the age so its layer can say how late.
   */
  maxAgeMs: number;
  /** Where the sender reads it, for the record and for /api/status-style notes. */
  upstream: string;
}

const H = 60 * 60 * 1000;

export const RELAY_FEEDS = {
  celestrak: {
    label: "CelesTrak GP element sets (visual, stations)",
    schema: celestrakSchema,
    maxBytes: 2 * MiB,
    maxAgeMs: 3 * 24 * H,
    upstream: "https://celestrak.org/NORAD/elements/gp.php",
  },
  "nrcan-magnetic": {
    label: "NRCan zonal magnetic activity review and forecast",
    schema: nrcanMagneticSchema,
    maxBytes: 64 * KiB,
    maxAgeMs: 3 * H,
    upstream: "https://spaceweather.gc.ca/forecast-prevision/short-court/zone-en.php",
  },
  "jma-volcam": {
    label: "JMA volcano monitoring cameras",
    schema: jmaVolcamSchema,
    maxBytes: 512 * KiB,
    maxAgeMs: 2 * H,
    upstream: "https://www.data.jma.go.jp/vois/data/obs/volcam/volcam.php",
  },
  "sjofartsverket-navwarn": {
    label: "Swedish Maritime Administration navigational warnings",
    schema: navwarnSchema,
    maxBytes: 512 * KiB,
    maxAgeMs: 24 * H,
    upstream: "https://navvarn.sjofartsverket.se/en/Navigationsvarningar/",
  },
  "shadowserver-beacon": {
    label: "Shadowserver Dashboard: C2 beacon IPs per country",
    schema: shadowserverBeaconSchema,
    maxBytes: 128 * KiB,
    maxAgeMs: 4 * 24 * H,
    upstream: "https://dashboard.shadowserver.org/statistics/combined/map/",
  },
  "shadowserver-sinkhole": {
    label: "Shadowserver Dashboard: sinkholed infected IPs per country",
    schema: shadowserverSinkholeSchema,
    maxBytes: 128 * KiB,
    maxAgeMs: 4 * 24 * H,
    upstream: "https://dashboard.shadowserver.org/statistics/combined/map/",
  },
  "eea-aqi": {
    label: "EEA European Air Quality Index, per station",
    schema: eeaAqiSchema,
    maxBytes: 3 * MiB,
    maxAgeMs: 6 * H,
    upstream: "https://dis2datalake.blob.core.windows.net/airquality-derivated/AQI-noRunningMeans/",
  },
  "hhs-ocr-breach": {
    label: "HHS OCR breach portal (500+ individuals, under investigation)",
    schema: hhsOcrBreachSchema,
    maxBytes: 2 * MiB,
    maxAgeMs: 7 * 24 * H,
    upstream: "https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf",
  },
  "texas-ag-breach": {
    label: "Texas Attorney General data security breach reports",
    schema: texasAgBreachSchema,
    maxBytes: 2 * MiB,
    maxAgeMs: 7 * 24 * H,
    upstream: "https://oag.my.site.com/datasecuritybreachreport/apex/DataSecurityReportsPage",
  },
  // --- war sources (schemas in lib/relay/schemas/*, one file per feed) -------------
  "war-zones": {
    label: "War zones: DeepState control areas and a daily held-area series",
    schema: warZonesSchema,
    maxBytes: 3 * MiB,
    maxAgeMs: 12 * H,
    upstream: "https://deepstatemap.live/api/history/last",
  },
  "frontline-changes": {
    label: "Front line changes: DeepState change log entries with a map link",
    schema: frontlineChangesSchema,
    maxBytes: 1 * MiB,
    maxAgeMs: 12 * H,
    upstream: "https://deepstatemap.live/api/history/public",
  },
  "losses-ru": {
    label: "Documented Russian vehicle losses (WarSpotting)",
    schema: lossesRuSchema,
    maxBytes: 3 * MiB,
    maxAgeMs: 48 * H,
    upstream: "https://ukr.warspotting.net/api/losses/russia/",
  },
  "losses-ua": {
    label: "Documented Ukrainian vehicle losses (LostArmour, via creamy-caprice.net)",
    schema: lossesUaSchema,
    maxBytes: 3 * MiB,
    maxAgeMs: 48 * H,
    upstream: "https://www.creamy-caprice.net/kml/Geolocations/Military_equipment.kml",
  },
  "loss-totals": {
    label: "Claimed Russian losses (General Staff of Ukraine), cross-checked",
    schema: lossTotalsSchema,
    maxBytes: 64 * KiB,
    maxAgeMs: 72 * H,
    upstream: "https://russianwarship.rip/api/v2/statistics/latest",
  },
  "war-news": {
    label: "War news: chosen outlets and public Telegram channels, both sides",
    schema: warNewsSchema,
    maxBytes: 2 * MiB,
    maxAgeMs: 6 * H,
    upstream: "RSS feeds and https://t.me/s/<channel> (NewsScraper sources/war_news.py)",
  },
} as const satisfies Record<string, RelayFeedSpec>;

export type RelayFeedId = keyof typeof RELAY_FEEDS;

/** The data type a feed's schema yields. */
export type RelayData<F extends RelayFeedId> = z.infer<(typeof RELAY_FEEDS)[F]["schema"]>;

export const RELAY_FEED_IDS = Object.keys(RELAY_FEEDS) as RelayFeedId[];

export function isRelayFeed(id: string): id is RelayFeedId {
  return Object.prototype.hasOwnProperty.call(RELAY_FEEDS, id);
}

/** The largest cap of any feed: the route's ceiling before it knows anything else. */
export const RELAY_MAX_BODY_BYTES = Math.max(...RELAY_FEED_IDS.map((id) => RELAY_FEEDS[id].maxBytes));
