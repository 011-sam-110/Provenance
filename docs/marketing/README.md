# Free growth playbook

How to get traction with no budget, ordered by leverage. The theme: demand for this
product is **event-driven** (people want a live map the moment something breaks), so
the strategy is to be present and shareable at those moments, and to compound each share.

## The unlock (do first)

**Settle the name and point the domain.** The live app says "OpenData"; the domain is
worldmonitor.app. Every link, card, and launch dies on a `*.vercel.app` URL under an
unsettled name. Pick one, point the domain. Recommendation: World Monitor, because it
matches the domain and is searchable ("OpenData" collides with every open-data portal).
The code reads the name from `lib/brand.ts`, so this is a one-line change.

## Tier 1: the spike + the foundation

- **Show HN.** The highest single free lever, and HN does not gate new accounts the way
  Reddit does. Draft and checklist: `docs/marketing/show-hn.md`. Post once the name,
  domain, and mobile layout are decent. Do it deliberately, not cold.
- **Shareable + embeddable links** (this PR, plus a follow-on). Rich OG cards now ship,
  so every pasted deep link unfurls into a branded map card on Bluesky, Slack, iMessage,
  and X. Next: an `/embed` iframe so blogs and Discords can drop the live map into their
  own coverage. Every share becomes an advert, and journalists can cite or embed it.

## Tier 2: compounding + event response

- **Programmatic SEO.** Auto-generate pages for "live earthquake map", "internet outage
  map <country>", "wildfire map", "<country> live". Next.js does this at scale, and it
  passively captures the search surge every event creates. Slow to start, compounds forever.
- **Newsjacking.** When something big breaks, drop a deep link to that exact view into the
  r/worldnews live megathread, relevant Discords, and HN. Needs an aged Reddit account, so
  warm one now. This is the manual counterpart to the auto-poster.

## Tier 3: always-on presence

- **Bluesky auto-poster.** Watches the "What's abnormal" detector and posts notable events
  with an OG card and a deep link. Keeps you present at every small event and builds a
  niche following; you amplify the big ones by hand. Free, bot-friendly, links not
  suppressed. Telegram is a one-file follow-on. X is deferred (paid, link-suppressed, and
  suspension-prone on new accounts).
- **Directory listings.** awesome-osint, awesome-datasets, a Product Hunt launch. Free
  backlinks and niche discovery.

## The multiplier (not a channel)

**A reason to come back.** Every channel above leaks out the bottom while people look once
and leave. One retention hook (follow-a-region alerts) multiplies the return on all of it.
It is the real ceiling on everything else.

## What not to do

- Do not cold cross-post to Reddit from a new account. That got the first account filtered
  and removed. Reddit is still valuable, but via aged accounts and event megathreads.
- Do not pay for X or build faceless AI short-form first. Low ROI, high risk and toil.
