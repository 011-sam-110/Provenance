// lib/relay/schemas/frontline-changes.ts
// The `frontline-changes` relay feed: the change-log entries that carry a map link.
// Sender: NewsScraper `sources/deepstate.py` (`changes`). Reader: lib/signals/frontline-changes.ts.
//
// ONE ROW PER LINKED SPOT, not per entry. One DeepState entry can name several places and
// both sides ("Ukraine regained control near Kalynove. The enemy advanced near Vasylivka"),
// so each spot its English text links is a row with the side of its own sentence. Rows of
// one entry share its `id`, `at` and `text`.
import { z } from "zod";
import { httpsUrl, isoInstant, lat, lon } from "./common";

export const frontlineChangesSchema = z.object({
  changes: z
    .array(
      z.object({
        /** The upstream's id for the entry. Shared by every spot the entry links. */
        id: z.number().int().positive(),
        /** The place the link names, in the upstream's own words ("Maiske"). */
        place: z.string().min(1).max(200),
        /** The war zone it belongs to, e.g. "ukraine" (war-zones ids). */
        zone: z.string().regex(/^[a-z0-9-]{2,40}$/),
        at: isoInstant,
        /** The upstream's own English sentence, tags stripped. */
        text: z.string().min(1).max(800),
        /** The upstream's sentence in its own language, when it gave one. */
        textOriginal: z.string().max(800).nullable(),
        /** Who moved: "ru" = a Russian advance, "ua" = a Ukrainian gain. Read from the sentence that holds this spot's link, never guessed. */
        side: z.enum(["ru", "ua", "unknown"]),
        lat,
        lon,
        zoom: z.number().min(0).max(22).nullable(),
        /** The upstream's map at that spot. */
        link: httpsUrl,
      }),
    )
    .max(3000),
});
