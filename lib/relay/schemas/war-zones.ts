// lib/relay/schemas/war-zones.ts
// The `war-zones` relay feed: control areas per war zone and a daily held-area series.
// Sender: NewsScraper `sources/deepstate.py` (`zones`). Reader: lib/signals/war-zones.ts.
// The area series is measured on provenance-1 from the upstream's own past maps.
import { z } from "zod";
import { httpsUrl, isoDay, isoInstant, lat, lon, lonLat } from "./common";

const ring = z.array(lonLat).min(4).max(50_000);
const polygon = z.object({ type: z.literal("Polygon"), coordinates: z.array(ring).min(1).max(500) });
const multiPolygon = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(ring).min(1).max(500)).min(1).max(1000),
});

/** occupied = held by Russia; contested = DeepState's "status unknown"; liberated = retaken by Ukraine. */
export const warZoneAreaKind = z.enum(["occupied", "contested", "liberated"]);

export const warZonesSchema = z.object({
  zones: z
    .array(
      z.object({
        /** Stable id, e.g. "ukraine". */
        id: z.string().regex(/^[a-z0-9-]{2,40}$/),
        name: z.string().min(1).max(80),
        /** Who drew the map, e.g. "DeepState". */
        source: z.string().min(1).max(80),
        sourceUrl: httpsUrl,
        /** The upstream's id for the map this snapshot drew from. */
        mapId: z.number().int().positive(),
        mapAt: isoInstant,
        areas: z
          .array(z.object({ kind: warZoneAreaKind, name: z.string().max(300), geometry: z.union([polygon, multiPolygon]) }))
          .max(3000),
        /** DeepState's attack-direction points. */
        attacks: z.array(z.object({ name: z.string().max(300), lat, lon })).max(1000),
        /** One row per day, oldest first. */
        series: z
          .array(
            z.object({
              day: isoDay,
              mapId: z.number().int().positive(),
              heldKm2: z.number().nonnegative(),
              contestedKm2: z.number().nonnegative(),
            }),
          )
          .max(800),
      }),
    )
    .min(1)
    .max(20),
});
