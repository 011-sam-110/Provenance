// lib/relay/schemas/losses-ru.ts
// The `losses-ru` relay feed: documented Russian vehicle losses (WarSpotting), the last
// 365 days row by row, plus the all-time totals. Sender: NewsScraper `sources/losses.py`
// (`russian`). Reader: lib/signals/losses-ru.ts.
import { z } from "zod";
import { isoDay, lat, lon } from "./common";

const count = z.number().int().nonnegative();

export const lossesRuSchema = z.object({
  losses: z
    .array(
      z.object({
        /** WarSpotting's id; the record is https://ukr.warspotting.net/view/<id>/ */
        id: z.number().int().positive(),
        model: z.string().min(1).max(300),
        type: z.string().min(1).max(160),
        status: z.enum(["Destroyed", "Damaged", "Abandoned", "Captured"]),
        date: isoDay,
        /** WarSpotting's nearest_location text. */
        place: z.string().max(300).nullable(),
        /** Null when WarSpotting gives no geolocation. Such a row is listed, never drawn. */
        lat: lat.nullable(),
        lon: lon.nullable(),
        unit: z.string().max(300).nullable(),
        tags: z.string().max(400).nullable(),
      }),
    )
    .max(30_000),
  /** WarSpotting's all-time totals (/api/stats/russia/). */
  stats: z.object({
    byStatus: z.record(z.string().max(40), count),
    byType: z.array(z.object({ type: z.string().max(160), losses: count, damaged: count })).max(80),
  }),
  /** The earliest day the rows reach back to. */
  from: isoDay,
});
