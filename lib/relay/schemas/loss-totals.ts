// lib/relay/schemas/loss-totals.ts
// The `loss-totals` relay feed: the General Staff of Ukraine's claimed totals of Russian
// losses (via russianwarship.rip), cross-checked against index.minfin.com.ua. Sender:
// NewsScraper `sources/losses.py` (`totals`). Reader: lib/signals/losses-ru.ts (its summary).
import { z } from "zod";
import { httpsUrl, isoDay } from "./common";

const count = z.number().int().nonnegative();

export const lossTotalsSchema = z.object({
  claimed: z.object({
    date: isoDay,
    /** Day of the full-scale invasion, as the source counts it. */
    day: z.number().int().positive(),
    /** The General Staff post the figures come from. */
    source: httpsUrl,
    /** Category key (russianwarship.rip's names, e.g. "tanks") -> running total. */
    stats: z.record(z.string().max(60), count),
    /** The same keys -> the change on that day. */
    increase: z.record(z.string().max(60), count),
  }),
  /** The cross-check. Null when minfin could not be read; the sender refuses a disagreement. */
  crossCheck: z
    .object({ date: isoDay, checked: z.array(z.string().max(60)).max(30), agrees: z.literal(true) })
    .nullable(),
});
