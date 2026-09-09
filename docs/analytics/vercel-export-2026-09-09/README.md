# Vercel Web Analytics export — taken 2026-09-09

This is the complete Vercel Web Analytics record for Provenance, exported before the
Vercel Pro seat is cancelled.

## Why this file exists

Provenance moved off Vercel to AWS Lightsail on 2026-09-07. Vercel Web Analytics stopped
collecting at that point, because `<Analytics/>` posts to `/_vercel/insights`, which only
exists on Vercel.

The Hobby plan answers any `since` older than 31 days with a flat `400`. So when the Pro
seat is cancelled, everything here becomes permanently unreachable through the API. This
export is the only copy.

The site's own traffic record from 2026-09-07 onward lives in the Caddy access-log rollups
at `/srv/provenance/shared/analytics/` on the production box, and is read by
`/admin/analytics`. The two records do not join — see "Do not combine the two" below.

## What is here

| File | Contents |
|---|---|
| `raw-timeseries.json` | Totals, monthly, daily, and hourly through the spike |
| `raw-dimensions.json` | Route, referrer, country, device, OS, browser, plus spike-window cuts |
| `by-*.csv` | The same tables, one CSV each, for the whole life of the site |
| `spike-by-*.csv` | The same cuts restricted to 2026-09-06 → 2026-09-08 |

Window covered: **2026-07-11 → 2026-09-08**. Nothing was recorded before 2026-07-11; the
query ran back to 2025-09-09 and every earlier day is zero.

## The visitor figure is not a count of people

**A visitor number in this export is a per-bucket unique, and the buckets add up.** The
monthly figures (199 + 2,762 + 6,653) sum to exactly the reported 9,614 total, which shows
Vercel is summing per-day uniques rather than deduplicating across the range. Somebody who
came back on three days is counted three times.

The same limit applies to the rollup job on the box, which deletes each day's hash set at
finalisation by design, so cross-day deduplication is not recoverable there either.

**The defensible statement is a bound: between 4,084 and 9,614 distinct people.** The lower
bound is the largest single day. The upper bound is the sum. Nothing in either system
narrows it further.

## Do not combine the two records

Vercel counts browsers that execute JavaScript. The Caddy rollup counts distinct salted
IP hashes that request a page, server-side. Server-side counting runs higher. Adding a
Vercel figure to a rollup figure produces a number that means nothing, and 2026-09-07 would
be double-counted on top of that.

## Headline numbers

- **9,614 visitors / 24,519 pageviews** across the whole record.
- **`/` (8,378) and `/app` (8,275) took almost all of it.** All ~19.7k SEO camera pages
  together drew 344 visitors to `/camera/[id]`.
- **Mobile 6,131 vs desktop 3,383.** iOS 3,503, Android 2,722.
- **105 countries.**

## Two traffic events, and what caused each

**2026-08-13 → 2026-08-24, Reddit.** Peaked at 488 visitors on 2026-08-14. `reddit.com`
(956) and `com.reddit.frontpage` (239) are the only referrers large enough to explain it.

**2026-09-06 17:00 UTC → 2026-09-07 04:00 UTC, an Instagram reel.** This is the largest
event in the site's history and it accounts for **6,452 of the 9,614 — 67% of everything**.
Sam left a comment on a reel; the reel reached about 4 million views and the comment about
7,000 likes.

Hourly shape, from `by-hour-spike.csv`:

- Flat at 1–4 visitors/hour all day, then **16 at 16:00 UTC and 241 at 17:00 UTC**.
- Peak **956 visitors in the 21:00 UTC hour**.
- Held above 500/hour overnight, then fell from **523 at 03:00 to 23 at 04:00 UTC**.

That last cliff is real and not a measurement artefact. Caddy on the Lightsail box did not
start until **2026-09-07 16:17:35 UTC**, so Vercel was still the only thing serving the site
when the drop happened, and it saw the drop.

The referrer evidence for Instagram is indirect but consistent. `l.instagram.com` shows only
4 visitors, because the Instagram in-app browser sends no referrer — so the traffic lands in
the 5,994 with no referrer at all. Supporting it: the country spread is wide and shallow
(US 1,805, then GB, CA, DE, BR, NL, AU, IN, ID, RO, ES, and 2,351 in "others"), and mobile
led desktop throughout. Search traffic does not distribute like that.

## What the spike went to

`/app` (5,886 visitors) and `/` (5,676). Camera pages drew 197. The audience came for the
console and the globe, not for the SEO pages.

## How this was produced

Through the Vercel MCP server's `get_web_analytics` against project `traffic-nerd-v2`.
Two API limits shaped the queries, and will shape any re-run:

- Day and hour granularity are capped at **62 days per query**, so the daily series was
  pulled in two chunks. Non-time dimensions accept the full range.
- UTM dimensions and custom events need the Web Analytics Plus add-on, so neither is here.
