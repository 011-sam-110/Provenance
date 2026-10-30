// lib/relay/schemas/losses-ua.ts
// The `losses-ua` relay feed: documented Ukrainian vehicle losses (LostArmour, the
// Russian side, as republished in creamy-caprice.net's KML), the last 365 days. Every
// row is located. Sender: NewsScraper `sources/losses.py` (`ukrainian`). Reader:
// lib/signals/losses-ua.ts.
import { z } from "zod";
import { httpsUrl, isoDay, lat, lon } from "./common";

export const lossesUaSchema = z.object({
  losses: z
    .array(
      z.object({
        /** LostArmour's path, e.g. "armour/71806". */
        id: z.string().regex(/^[a-z]+\/\d+$/),
        /** The name as published (Russian). */
        name: z.string().min(1).max(300),
        /** An English name, when the sender could give one. Null means untranslated. */
        nameEn: z.string().max(300).nullable(),
        /** LostArmour's category as published, e.g. "Артиллерия". */
        category: z.string().max(120),
        /** Its English form, e.g. "Artillery". */
        categoryEn: z.string().max(120),
        /** The status word as published, e.g. "Уничтожен", or null. */
        status: z.string().max(80).nullable(),
        statusEn: z.string().max(80).nullable(),
        date: isoDay,
        lat,
        lon,
        /** LostArmour's record and the posts it cites. */
        links: z.array(httpsUrl).min(1).max(8),
      }),
    )
    .max(30_000),
  from: isoDay,
});
