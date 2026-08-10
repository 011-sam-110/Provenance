# Show HN: launch draft

Submit at https://news.ycombinator.com/submit as a "Show HN". Best timing is a weekday
around 08:00 to 10:00 US Eastern. You get one shot at the title, so keep it plain and
specific.

## Before posting (checklist)

- [ ] Name and domain settled; the link is the real domain, not a `*.vercel.app` URL.
- [ ] Mobile layout at least usable (HN sends heavy mobile traffic).
- [ ] OG card renders on the live URL (paste the link into a Bluesky or Slack draft to check).
- [ ] You can babysit comments for the first few hours (HN expects the author to reply).

## Title (pick one)

- Show HN: A live world map of flights, quakes, wildfires and outages from open data
- Show HN: World Monitor, a live global situational-awareness map from ~40 open feeds

## Body

> I built a single-page live map of what's happening on Earth right now. It pulls about
> 40 open data layers onto one globe: worldwide flights (ADS-B), earthquakes (USGS and
> EMSC), disaster alerts (GDACS), wildfires, tropical cyclones, roughly 20,000 public
> traffic and city cameras (some live), internet-outage detection (IODA), commodities,
> equities and crypto, a country-instability index, and an aggregated world-news rail.
>
> Two things I was strict about. It works with zero setup: every feed is keyless-first
> with a fallback, so there is no login and no API keys. And it never fabricates: a dead
> feed shows empty or last-good, never invented data. There is also a "What's abnormal"
> view that scans every layer and surfaces only the outliers.
>
> Stack is Next.js and MapLibre on Vercel. It's free, no account. Happy to get into how
> any specific layer is sourced, and I'd love feedback on what's confusing or what layer
> you'd want next.
>
> <link>

## First comment (post immediately, as the author)

> Author here. A few notes on sourcing and limits: which layers are keyless vs need a key,
> the polling cadences, and what is not truly real-time. Ask me anything.
