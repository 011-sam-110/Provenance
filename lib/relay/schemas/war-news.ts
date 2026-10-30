// lib/relay/schemas/war-news.ts
// The `war-news` relay feed: posts from the outlets and public Telegram channels Sam
// chose, each labelled with its side, translated where needed, and placed only where the
// post names a place. Sender: NewsScraper `sources/war_news.py`. Reader: lib/signals/war-news.ts.
//
// SIDE is the outlet's own origin and stance (who is speaking), never a judgement of
// whether a post is true. The sender's OUTLETS table gives each outlet's one-line reason,
// and that reason travels here in `outlets[].why`.
import { z } from "zod";
import { httpsUrl, isoInstant, lat, lon } from "./common";

export const warNewsSide = z.enum(["ua", "ru", "independent"]);

/** How the sender reads an outlet: its RSS, its Google News sitemap, or its t.me/s page. */
export const warNewsChannel = z.enum(["rss", "sitemap", "telegram"]);

export const warNewsSchema = z.object({
  items: z
    .array(
      z.object({
        /** Stable id: a hash of the post's URL. */
        id: z.string().regex(/^[a-f0-9]{8,64}$/),
        outlet: z.string().min(1).max(120),
        channel: warNewsChannel,
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
        /**
         * False when the model has not read the post yet (its budget was spent, or it was
         * down): an English post listed in its own words, with no zone and no place, that a
         * later run reads and replaces. Never false on a translated post.
         */
        checked: z.boolean(),
      }),
    )
    .max(5000),
  /** Every outlet on the list, read or not, so the widget can say what is missing and why. */
  outlets: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9-]{2,40}$/),
        name: z.string().min(1).max(120),
        side: warNewsSide,
        channel: warNewsChannel,
        home: httpsUrl,
        /** The outlet's origin and stance, one line: why it has its side. */
        why: z.string().min(1).max(300),
        opinion: z.boolean(),
        /** ok: read this run; failed: refused or unreadable this run; no-feed: not read at all. */
        status: z.enum(["ok", "failed", "no-feed"]),
        detail: z.string().max(300).nullable(),
        /** Its posts in `items`. */
        posts: z.number().int().min(0),
      }),
    )
    .max(100),
  /** New posts the model has not read yet, and why. */
  pending: z.object({
    count: z.number().int().min(0),
    reason: z.string().max(300).nullable(),
  }),
});
