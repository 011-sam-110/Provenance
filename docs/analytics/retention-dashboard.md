# The "Returning visitors" dashboard

The dashboard answers one question: do visitors come back?

It is in PostHog, not in this repo. Project `provenance-online.com` (US region), dashboard
"Returning visitors": <https://us.posthog.com/project/608188/dashboard/2167323>. It was made
on 2026-10-03.

This file holds the SQL behind each tile, for two reasons. A reviewer can read what a figure
means. And if the dashboard is lost, it can be made again.

## How to make it again

1. In PostHog, make a dashboard.
2. For each tile below: New insight, SQL, paste the query, save it to the dashboard.
3. In each query, put the shared query in the place of `{{VISITS}}`.
4. Add a text card with the text in "What these numbers are not".

## What is counted

**A browser-day** is one counted browser on one local day. It is the unit of every tile.

The site sends one `visit` event for each browser-day (`lib/analytics/returnFlag.ts`). The
event says `new` or `returning`, and how long since the last visit. On a browser's first
visit of a calendar week it also carries `cohort_week`: the Monday of the week of the first
visit. It carries no identifier.

The `visit` event did not exist before the cohort release. For the days before the first
`visit` event, the shared query works a browser-day out from tabs:

- PostHog's `distinct_id` lives in session storage, so one `distinct_id` is one tab.
- A tab's first local day takes the class the site registered when the tab opened.
- A second tab on the same day (`returning` / `same_day`) is not a browser-day.
- A later local day in the same tab is a return. The gap is measured from the tab's last
  active day.
- A later day with only `$pageleave` or `$web_vitals` is not a return. That is a tab that
  was closed, not a tab that was used. On 2026-10-03 this rule removed 32 of 166 such days.

The local day comes from `$timezone_offset`, which posthog-js sends with every event.

**Count with the `visit` event, not with `visit_kind` on other events.** `visit_kind` rides
on every event of a tab. With two tabs open across midnight, only the first tab shown is
classified again, so the other tab keeps its old value.

**The join between the two rules loses some days.** A tab that was open before the cohort
release, and stays open after it without a reload, runs the old code and sends no `visit`
event. Its later days are not counted until it reloads.

## What these numbers are not

This is the text card on the dashboard.

**They are a sample, not a census.** A browser is counted only if it runs the PostHog script. Tracker blockers stop it. Do Not Track and Global Privacy Control stop it. Browsers set to a German time zone are not counted. The site's access log shows more visitors than this page does.

**A browser is not a person.** A second device, a private window or cleared storage all look new. Your own visits are in here too.

**Safari forgets.** It deletes the stored dates after 7 days without a visit, so a Safari return after a longer gap looks new. Tile 5 shows the size of that effect.

**"New" includes scripts.** A scraper that runs a real browser is counted as a new visitor and never returns. That pushes the returning share down. 17 Sep 2026 is left out of every tile for this reason: 5,736 of its sessions came direct, desktop only, from proxy locations, in three bursts.

**Long gaps need time.** Counting started on 15 Sep 2026. "8 to 30 days" cannot be complete before 15 Oct, and "over 30 days" cannot be complete before 14 Nov.

**Two counting rules meet at the cohort release.** Before it, a browser-day is worked out from tabs: a browser with two long-lived tabs can count twice. From it, the site sends one 'visit' event per browser per day, which is exact. Tile 6 fills in only from the week after that release.

The SQL behind every tile is in the repo: docs/analytics/retention-dashboard.md

## The shared query

`{{VISITS}}` in each tile is this query. It gives one row for each tab on each local day,
with its class.

```sql
SELECT lday AS day,
       multiIf(unit_ts >= (SELECT if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)) FROM events WHERE event = 'visit'), if(has_visit, v_kind, 'second_tab'),
               lday > d0, 'returning',
               gap0 = 'same_day', 'second_tab',
               kind0) AS kind,
       multiIf(unit_ts >= (SELECT if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)) FROM events WHERE event = 'visit'), v_gap, lday > d0, multiIf(dateDiff('day', prev, lday) <= 1, 'next_day', dateDiff('day', prev, lday) <= 7, '2_7d', dateDiff('day', prev, lday) <= 30, '8_30d', 'over_30d'), gap0) AS gap,
       browser, active_minutes, pages, objects, layers, other_actions
FROM (
  SELECT tab, lday, unit_ts, has_visit, v_kind, v_gap, kind0, gap0, d0, browser, active_minutes, pages, objects, layers, other_actions,
         lagInFrame(lday, 1) OVER (PARTITION BY tab ORDER BY lday ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS prev
  FROM (
    SELECT e.distinct_id AS tab, toDate(e.timestamp - toIntervalMinute(ifNull(toInt(e.properties.$timezone_offset), 0))) AS lday, min(e.timestamp) AS unit_ts,
           countIf(e.event = 'visit') > 0 AS has_visit,
           anyIf(toString(e.properties.visit_kind), e.event = 'visit') AS v_kind,
           anyIf(toString(e.properties.return_gap), e.event = 'visit') AS v_gap,
           any(t.kind0) AS kind0, any(t.gap0) AS gap0, any(t.d0) AS d0,
           any(toString(e.properties.$browser)) AS browser,
           uniq(toStartOfMinute(e.timestamp)) AS active_minutes,
           uniqIf(e.properties.$pathname, e.event = '$pageview') AS pages,
           countIf(e.event = 'object_opened') AS objects,
           countIf(e.event = 'layer_toggled') AS layers,
           countIf(e.event IN ('board_switched', 'share_link_copied', 'alert_armed')) AS other_actions
    FROM events e
    JOIN (
      SELECT distinct_id AS tab0,
             argMin(toString(properties.visit_kind), timestamp) AS kind0,
             argMin(toString(properties.return_gap), timestamp) AS gap0,
             min(toDate(timestamp - toIntervalMinute(ifNull(toInt(properties.$timezone_offset), 0)))) AS d0
      FROM events
      GROUP BY tab0
    ) t ON t.tab0 = e.distinct_id
    GROUP BY tab, lday
    HAVING lday = d0 OR countIf(e.event NOT IN ('$pageleave', '$web_vitals')) > 0
  )
)
WHERE day != toDate('2026-09-17')
```

## The tiles

### 1 · Browsers per day: new / were here before

Counted browsers per local day. 'Were here before' is a browser that came on an earlier day. A second tab on the same day is not counted.

Shown as: stacked bars, `day` on the x axis.

```sql
SELECT day, countIf(kind = 'new') AS new_browsers, countIf(kind = 'returning') AS were_here_before
FROM ({{VISITS}})
WHERE kind IN ('new', 'returning')
GROUP BY day
ORDER BY day
```

### 2 · Returning share by week, %

Of the counted browser-days in each week (Monday start), the share from a browser that was here on an earlier day. The newest week is not complete.

Shown as: a table.

```sql
SELECT toStartOfWeek(day, 1) AS week_starting, count() AS browser_days, countIf(kind = 'returning') AS were_here_before,
       round(100 * countIf(kind = 'returning') / count(), 1) AS returning_share_pct
FROM ({{VISITS}})
WHERE kind IN ('new', 'returning')
GROUP BY week_starting
ORDER BY week_starting
```

### 3 · Last visit was

For each return, how long since that browser's last visit. '8 to 30 days' cannot be complete before 15 Oct 2026, and 'over 30 days' cannot be complete before 14 Nov 2026.

Shown as: a table.

```sql
SELECT multiIf(gap = 'next_day', '1 · the day before', gap = '2_7d', '2 · 2 to 7 days ago', gap = '8_30d', '3 · 8 to 30 days ago', '4 · over 30 days ago') AS last_visit_was,
       count() AS returns,
       round(100 * count() / sum(count()) OVER (), 1) AS share_pct
FROM ({{VISITS}})
WHERE kind = 'returning'
GROUP BY last_visit_was
ORDER BY last_visit_was
```

### 4 · Per visit: new against returning

One visit is one tab on one local day. Active minutes are minutes with at least one event, so watching a stream without a click adds none. Pages are distinct paths. 'Second tab, same day' cannot be split into new and returning.

Shown as: a table.

```sql
SELECT multiIf(kind = 'new', '1 · new', kind = 'returning', '2 · were here before', '3 · second tab, same day') AS visit_class,
       count() AS visits,
       round(median(active_minutes), 1) AS median_active_minutes,
       round(avg(active_minutes), 1) AS mean_active_minutes,
       round(avg(pages), 2) AS mean_distinct_pages,
       round(avg(objects), 2) AS mean_objects_opened,
       round(avg(layers), 2) AS mean_layer_toggles,
       round(100 * countIf(objects + layers + other_actions > 0) / count(), 1) AS used_the_map_pct
FROM ({{VISITS}})
GROUP BY visit_class
ORDER BY visit_class
```

### 5 · By browser (Safari check)

Safari deletes a site's stored dates after 7 days without a visit, so a Safari return after a longer gap looks new. A low Safari share is that rule, not a lack of interest. Browsers with fewer than 20 browser-days are left out.

Shown as: a table.

```sql
SELECT browser, count() AS browser_days, countIf(kind = 'returning') AS were_here_before,
       round(100 * countIf(kind = 'returning') / count(), 1) AS returning_share_pct
FROM ({{VISITS}})
WHERE kind IN ('new', 'returning')
GROUP BY browser
HAVING browser_days >= 20
ORDER BY browser_days DESC
```

### 6 · Weekly cohorts

One row per week of first visit (Monday start). Each wk column is the share of that week's new browsers seen again that many weeks later. A cell is empty until the site has sent 'visit' events for the whole of that week.

Shown as: a table.

```sql
SELECT s.cohort AS first_came_week_of, s.browsers AS new_browsers,
       if(s.cohort + toIntervalWeek(1) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(1) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w1, 0) / s.browsers, 1), NULL) AS wk1_pct,
       if(s.cohort + toIntervalWeek(2) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(2) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w2, 0) / s.browsers, 1), NULL) AS wk2_pct,
       if(s.cohort + toIntervalWeek(3) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(3) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w3, 0) / s.browsers, 1), NULL) AS wk3_pct,
       if(s.cohort + toIntervalWeek(4) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(4) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w4, 0) / s.browsers, 1), NULL) AS wk4_pct,
       if(s.cohort + toIntervalWeek(5) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(5) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w5, 0) / s.browsers, 1), NULL) AS wk5_pct,
       if(s.cohort + toIntervalWeek(6) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(6) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w6, 0) / s.browsers, 1), NULL) AS wk6_pct,
       if(s.cohort + toIntervalWeek(7) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(7) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w7, 0) / s.browsers, 1), NULL) AS wk7_pct,
       if(s.cohort + toIntervalWeek(8) > (SELECT toStartOfWeek(if(count() = 0, toDateTime('2100-01-01 00:00:00'), min(timestamp)), 1) FROM events WHERE event = 'visit') AND s.cohort + toIntervalWeek(8) <= toStartOfWeek(today(), 1), round(100 * ifNull(r.w8, 0) / s.browsers, 1), NULL) AS wk8_pct
FROM (
  SELECT toStartOfWeek(day, 1) AS cohort, count() AS browsers
  FROM ({{VISITS}})
  WHERE kind = 'new'
  GROUP BY cohort
) s
LEFT JOIN (
  SELECT cohort, countIf(k = 1) AS w1, countIf(k = 2) AS w2, countIf(k = 3) AS w3, countIf(k = 4) AS w4, countIf(k = 5) AS w5, countIf(k = 6) AS w6, countIf(k = 7) AS w7, countIf(k = 8) AS w8
  FROM (
    SELECT toDate(toString(properties.cohort_week)) AS cohort,
           dateDiff('week', toDate(toString(properties.cohort_week)), toStartOfWeek(toDate(timestamp - toIntervalMinute(ifNull(toInt(properties.$timezone_offset), 0))), 1)) AS k
    FROM events
    WHERE event = 'visit' AND properties.cohort_week IS NOT NULL
  )
  GROUP BY cohort
) r ON r.cohort = s.cohort
ORDER BY s.cohort
```

## The first reading, 2026-10-03

Counting started on 2026-09-15. These figures cover 15 September to 3 October, with
17 September left out. They are a sample of the browsers that run the PostHog script.

| Figure | Value |
|---|---|
| Browser-days | 2,235 |
| New | 1,842 |
| Were here before | 393 (17.6%) |
| Returning share, week of 14 Sep | 9.6% (82 of 850) |
| Returning share, week of 21 Sep | 19.1% (178 of 931) |
| Returning share, week of 28 Sep, not complete | 29.3% (133 of 454) |
| Last visit was the day before | 206 (52.4%) |
| Last visit was 2 to 7 days ago | 150 (38.2%) |
| Last visit was 8 to 30 days ago | 37 (9.4%) |

The returning share rises for two reasons, and only one of them is loyalty. The count of
returns is steady, at about 18 to 37 each day. The count of new browsers fell from about 200
each day to about 45. A share goes up when its other part goes down.

One figure was derived a second way. 393 is the sum of tile 2, the sum of tile 3 and the
"were here before" row of tile 4. It is also 259 tabs that the site classed as a return
when they opened, plus 134 later days in tabs that were already open.

17 September is left out because it was an automated flood. 5,736 of its sessions came
direct, on desktop browsers only, from Seychelles, Brazil, Bangladesh, India, Pakistan and
Vietnam, in three bursts between 06:00 and 14:00 UTC.

## Check what the site sends

```sh
node scripts/check-beacon.mjs                        # production
node scripts/check-beacon.mjs http://localhost:3111  # a local server with NEXT_PUBLIC_POSTHOG_KEY set
```

The script drives a real browser and reads the requests to PostHog. It answers them itself,
so a run adds nothing to the real numbers. Run it after each release that changes
`components/analytics/Beacon.tsx` or `lib/analytics/returnFlag.ts`.
