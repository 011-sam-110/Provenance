// lib/relay/schemas/common.ts
// Field rules shared by the war-source relay schemas (war-zones, frontline-changes,
// losses-ru, losses-ua, loss-totals, war-news). Same rules as the top of feeds.ts, kept
// here so each war feed's schema can live in its own file and be owned by one change.
import { z } from "zod";

export const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const isoInstant = z.string().refine((s) => Number.isFinite(Date.parse(s)), "not an ISO timestamp");
export const lat = z.number().gte(-90).lte(90);
export const lon = z.number().gte(-180).lte(180);
export const httpsUrl = z
  .string()
  .url()
  .refine((s) => s.startsWith("https://"), "https only");
/** A [lon, lat] pair, the GeoJSON order. */
export const lonLat = z.tuple([lon, lat]);
