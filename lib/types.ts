import { z } from "zod";

// A road-surface reading published by the network that owns the camera.
//
// `state` is the OPERATOR'S wording, never ours, which is why it is a free string and
// not an enum: Estonia sends DRY/MOIST/WET today and Fintraffic sends whole sentences
// that change with the season ("Snow-covered" appears in winter and not in a September
// capture). An enum here would silently drop every state we had not met yet — the exact
// failure mode a fixture cannot catch, because the fixture is also a September capture.
export const SurfaceSchema = z.object({
  state: z.string().min(1),
  roadTempC: z.number().optional(),
  airTempC: z.number().optional(),
  station: z.string().optional(),
  km: z.number().nonnegative().optional(),
  observedAt: z.number().optional(),
  /** Set only when the operator itself qualifies the reading (stale, sensor fault). */
  operatorFlag: z.string().optional(),
});

export const CameraSchema = z.object({
  id: z.string(),                       // `${source}:${nativeId}`
  source: z.string(),
  country: z.string().length(2),        // ISO-3166 alpha-2
  region: z.string().optional(),
  name: z.string().min(1),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  road: z.string().optional(),
  direction: z.string().optional(),
  imageUrl: z.string().url().optional(),
  streamUrl: z.string().url().optional(),
  mediaType: z.enum(["jpeg", "video", "both"]),
  refreshSeconds: z.number().positive(),
  license: z.string().min(1),
  attribution: z.string().min(1),
  available: z.boolean(),
  lastSampledAt: z.string().optional(),
  // A MEASURED road-surface state, present only where the network publishes one.
  // Two of seventeen feeds do (Estonia, Finland), so this is absent on most rows and
  // its absence is meaningful: it means nobody measured, NOT that the road is clear.
  // Everything that reads it must go through `surfaceValidity` in lib/cameras/surface.ts,
  // because a reading can be present and still unusable (stale, faulty, or measured at
  // a station too far away to be describing this road).
  surface: SurfaceSchema.optional(),
});

export type Camera = z.infer<typeof CameraSchema>;
export const CameraArray = z.array(CameraSchema);

// Windy webcams are a DISTINCT layer from road CCTV (different upstream, keyed,
// short-lived tokened image URLs) so they get their own normalized shape rather
// than reusing Camera — keeping the camera registry + counts uncontaminated.
export const WebcamSchema = z.object({
  id: z.string(),                       // `windy:${webcamId}`
  source: z.literal("windy"),
  title: z.string().min(1),
  lat: z.number().gte(-90).lte(90),
  lon: z.number().gte(-180).lte(180),
  country: z.string().optional(),       // ISO-3166 alpha-2 (location.country_code)
  region: z.string().optional(),
  city: z.string().optional(),
  categories: z.array(z.string()).optional(),
  // Token-bearing, short-lived (free tier ~10 min) — never cached long-term.
  imageUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  detailUrl: z.string().url(),          // the webcam's Windy page (attribution link)
  providerUrl: z.string().url().optional(),
  status: z.string(),
  available: z.boolean(),               // status === "active"
  lastUpdatedOn: z.string().optional(),
  license: z.string().min(1),
  attribution: z.string().min(1),
});

export type Webcam = z.infer<typeof WebcamSchema>;
export const WebcamArray = z.array(WebcamSchema);

export type Source = {
  id: string;
  name: string;
  license: string;
  attribution: string;
  refreshSeconds: number;
  needsKey: boolean;
};
