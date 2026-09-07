# Vercel Web Analytics — the whole record, captured 2026-09-07

Everything below was read out of Vercel's Web Analytics API on 2026-09-07, the day the
site moved to its own box. **It is written down because it is about to become
unreachable.** Collection stopped when `<Analytics />` was removed (it posts to
`/_vercel/insights`, which exists only on Vercel's edge), and the Hobby tier refuses any
`since` older than 31 days with a flat 400 — so once the Pro seat is cancelled, the
window below cannot be queried again by anyone, including us.

Period: **2026-06-25 → 2026-09-08** (the project's whole life; created 2026-06-26).

## Totals

| | |
|---|---|
| Visitors | **9,570** |
| Pageviews | **24,456** |

## By week — the shape matters more than the total

| Week beginning | Visitors | Pageviews |
|---|---:|---:|
| 2026-07-06 | 70 | 118 |
| 2026-07-13 | 93 | 128 |
| 2026-07-20 | 23 | 27 |
| 2026-07-27 | 18 | 26 |
| 2026-08-03 | 12 | 16 |
| 2026-08-10 | 1,081 | 2,712 |
| 2026-08-17 | 1,192 | 2,868 |
| 2026-08-24 | 443 | 875 |
| **2026-08-31** | **4,298** | **11,933** |
| 2026-09-07 (partial) | 2,340 | 5,753 |

Two things to read here. The site went from ~20 visitors a week in early August to
**4,298 in the week of 31 August** — a 200x rise in under a month, and the steepest week
was the last full one. And that is the week the maintenance curtain went up. Whatever the
curtain cost, it was not charged against a flat line.

## Where people came from

| Referrer | Visitors | Pageviews |
|---|---:|---:|
| (direct / none) | 8,889 | 19,853 |
| google.com | 1,551 | 1,829 |
| reddit.com | 956 | 1,096 |
| com.google.android.googlequicksearchbox | 386 | 493 |
| com.reddit.frontpage | 239 | 341 |
| github.com | 192 | 238 |
| duckduckgo.com | 156 | 242 |
| search.brave.com | 81 | 92 |
| t.co | 70 | 83 |
| bing.com | 48 | 68 |

**SEARCH IS THE LARGEST REFERRED CHANNEL, NOT REDDIT.** Folding in the mobile apps,
Google sent **1,937** and Reddit **1,195**; add DuckDuckGo, Brave, Bing and Ecosia and
search reaches ~2,180. Earlier notes in this repo said the opposite — they were reading a
window taken days after a single Reddit post, when Reddit genuinely dominated. Over the
project's life it does not.

That is the fact that makes `lib/brand.legacy.ts` load-bearing rather than tidy: every one
of those search results names `provenance-online.vercel.app`.

## What people actually looked at

| Path | Visitors | Pageviews |
|---|---:|---:|
| `/` | 8,353 | 10,331 |
| `/app` | 8,256 | 13,256 |
| (Others, ~20k camera pages combined) | 330 | 739 |
| `/privacy` | 19 | 20 |
| `/camera/cetsp:184` | 8 | 13 |
| `/camera/tfl:JamCams_00002.00865` | 8 | 8 |
| `/cameras/ca` | 6 | 13 |

**The console and the landing page are the product; the camera long tail is not.** `/`
and `/app` took 16,609 of 16,939 measured visitors. Every camera page ever generated —
roughly twenty thousand routes — accounts for at most a few hundred, and the best
individual one managed **eight visitors in ten weeks**.

Three standing decisions rest on that ratio, and all three should be re-read against it:
ISR on camera pages (`provenance_isr_camera_pages` — writes 2.7x more than it reads),
whether a CDN in front of the box is worth buying, and how much crawl budget the camera
sitemap deserves.

## How this was captured

Through the authenticated Vercel MCP session, not an API token — `mode: count` for the
totals and `mode: aggregate` with `by: [week | referrerHostname | requestPath]` for the
rest. `by: [day]` is capped at 62 days by the API, which is why the series above is
weekly.

Project `traffic-nerd-v2` = `prj_PEFRuo9AZYtxN9WmY3a1cyiWlGRQ`,
team `team_6DpNWQt4IZhA94yPzmyoRbOe`. Neither is a secret; both are the values
`VERCEL_ANALYTICS_PROJECT_ID` and `VERCEL_ANALYTICS_TEAM_ID` want if that route is ever
wired up again.
