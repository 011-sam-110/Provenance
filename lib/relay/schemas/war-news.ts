// lib/relay/schemas/war-news.ts
// The `war-news` relay feed: posts from the outlets and public Telegram channels Sam
// chose, each labelled with its side, translated where needed, and placed only where the
// post names a place. Sender: NewsScraper `sources/war_news.py`. Reader: lib/signals/war-news.ts.
import { z } from "zod";
import { httpsUrl, isoInstant, lat, lon } from "./common";

export const warNewsSide = z.enum(["ua", "ru", "independent"]);

export const warNewsSchema = z.object({
  items: z
    .array(
      z.object({
        /** Stable id: a hash of the post's URL. */
        id: z.string().regex(/^[a-f0-9]{8,64}$/),
        outlet: z.string().min(1).max(120),
        channel: z.enum(["rss", "telegram"]),
        side: warNewsSide,
        url: httpsUrl,
        /** English. For a translated post, the translation. */
        title: z.string().min(1).max(500),
        summary: z.string().max(1500).nullable(),
        /** The post's own language, e.g. "en", "ru", "uk". */
        lang: z.string().regex(/^[a-z]{2,3}$/),
        translated: z.boolean(),
        /** The original text when translated, else null. */
        original: z.string().max(1500).nullable(),
        publishedAt: isoInstant,
        /** Which war zone it is about, e.g. "ukraine", or null when none. */
        zone: z.string().regex(/^[a-z0-9-]{2,40}$/).nullable(),
        /** Where the post says it happened. Null when it names no place; such a post is listed, never drawn. */
        place: z
          .object({
            name: z.string().min(1).max(200),
            lat,
            lon,
            precision: z.enum(["exact", "facility", "area", "country"]),
          })
          .nullable(),
        /** Opinion, not reporting (e.g. Roy TV). Listed, never drawn. */
        opinion: z.boolean(),
      }),
    )
    .max(5000),
});
