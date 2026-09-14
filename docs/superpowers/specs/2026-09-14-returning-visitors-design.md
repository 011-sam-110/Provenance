# Returning visitors and usage: design

**Date:** 2026-09-14
**Branch:** `feat/return-flag`, off `origin/main` at `5372c19`
**Status:** design, waiting for review. Nothing here is built.

## The question

Sam asked: "how many of our viewers are returning customers, and how much they are using the site."

At the moment the site cannot answer the first half, and that is by design. The PostHog beacon keeps its
identifier in `sessionStorage` (`lib/analytics/beacon.ts`). /privacy promises "nothing that links this
visit to your next one". The access-log rollups delete their per-day visitor hashes when a day is
finalised. No record connects one day to the next.

Sam chose the **return flag, with no identifier**, so the browser can tell a new visit from a return
without sending anything that says who the visitor is.

## What this answers, and what it does not

| Answers | Does not answer |
|---|---|
| Share of visits from a browser that was here on an earlier day | Day-7 retention of one cohort |
| How long ago the last visit was: same day, next day, 2-7 days, 8-30 days, over 30 days | The history of one person |
| Pages, time and actions per visit, for new visits against returning visits | Visitors who block PostHog |
| How often people open objects, switch boards, toggle layers, copy links and arm alerts | Returns on a second device or after cleared storage |

## Approaches considered

1. **Persistent PostHog identifier** (localStorage or cookie persistence). This gives full retention
   cohorts, but it is a cross-visit identifier. Sam rejected it.
2. **Return flag sent to PostHog** (chosen). The browser keeps two dates. It sends only a class and a gap
   bucket, as event properties.
3. **First-party visit beacon through the access log.** A `GET /api/visit?k=returning&g=2_7d` line would
   be folded into the daily rollup and its log line would be gone in about 3.5 days. Tracker blockers do
   not stop it, and no third party keeps a row. But it cannot split usage by new against returning
   without joining requests, and the masked /16 address plus user agent collides badly on mobile
   carriers. **Deferred.** Revisit if the PostHog sample turns out too biased by blockers.

## Design

### 1. The visit record: `lib/analytics/returnFlag.ts` (pure)

- Key `tn.visit.v1`, written through `lib/shell/persist.ts` (versioned envelope, injectable storage,
  a no-op without `window`).
- Value `{ first: "YYYY-MM-DD", last: "YYYY-MM-DD" }`, as **local calendar dates**. The user's own day
  is what "came back the next day" means. Day differences come from `Date.UTC` on the date parts, so a
  DST change cannot move a gap.
- `classifyVisit(record, today)` returns the class and the next record:

| Stored state | Class sent | Next record |
|---|---|---|
| Nothing, wrong version, bad shape or bad date | `new` | `{ first: today, last: today }` |
| `first > last`, or `last > today` (clock moved back) | `new` | reset |
| `today - first >= 395` days (13 months) | `new` | reset |
| Otherwise | `returning`, gap bucket from `today - last` | `{ first, last: today }` |

- Gap buckets, pinned at every edge: `0 same_day`, `1 next_day`, `2-7 2_7d`, `8-30 8_30d`,
  `31+ over_30d`.
- **The 13-month cap runs from `first` and a later visit does not extend it.** CNIL's
  audience-measurement conditions ask for exactly this.
- **One classification per tab.** A reload or a full navigation in the same tab must not reclassify
  the visit as `returning / same_day`. The guard is PostHog's own session-scoped super property: if
  `visit_kind` is already registered in this tab, the record is not read or written again. This adds
  no storage key.

### 2. Arming and the opt-out: `lib/analytics/optOut.ts` (pure)

- `tn.analytics.optout.v1` in localStorage records that this browser asked not to be counted. Storing
  an objection is what makes the objection work.
- `privacySignal(nav)` is true for Do Not Track (`"1"` or `"yes"`) **or Global Privacy Control**.
- `shouldCount({ configured, optedOut, signal })` is the single arming rule.
- `optOut(storage)` writes the flag **and deletes `tn.visit.v1`**. `optIn(storage)` removes the flag.
- **Behaviour change for the existing beacon, on purpose.** Today, Do Not Track is handled inside
  posthog-js (`respect_dnt`). After this change, an opted-out or signalling browser **never imports
  posthog-js**, so nothing loads, nothing is sent and nothing is written. `respect_dnt` stays on as a
  second layer.

### 3. The beacon: `components/analytics/Beacon.tsx`

- Before the dynamic import: `if (!shouldCount(...)) return;`
- `posthog.init(key, { ...beaconOptions(config), loaded })`. The `loaded` callback:
  1. binds the client for `track()` (section 4),
  2. if `visit_kind` is not registered yet, classifies, saves the next record and calls
     `posthog.register({ visit_kind, return_gap })`.
- **Order verified in posthog-js 1.428.1** (`dist/module.js`): `config.loaded(this)` runs
  synchronously, and the initial `$pageview` is scheduled after it with `setTimeout(..., 1)`. So the
  first page view already carries both properties. A posthog-js upgrade could change that order, so
  the live check in "Verification" looks for `visit_kind` on the FIRST `$pageview`.
- `beaconOptions` gains `person_profiles: "identified_only"` (the code never calls `identify`, so
  PostHog builds no person profiles) and `opt_out_capturing_persistence_type: "sessionStorage"`.
  Both are pinned by `beacon-config.test.ts`. `persistence` stays `"sessionStorage"`.

### 4. Usage events: `lib/analytics/track.ts`

- `bindBeacon(client)` and `track(event)`. Before binding, or after an opt-out, `track` does nothing.
  The module imports nothing from posthog-js, so no call site pulls the library into the main bundle.
- `event` is a discriminated union. **Properties are enumerated values only: no free text, no
  coordinates, no camera or object ids, no area names.**

| Event | Properties | Call site | Why here |
|---|---|---|---|
| `object_opened` | `kind` (the `WorldObject` kind) | `overlay.open` in `lib/overlay.ts` | One site covers the 8 map, search and widget callers. A shared link that restores an object counts too, because opening the link was the user's action. |
| `board_switched` | `board` (built-in preset id, or `custom`) | `applyPreset` in `lib/console/presets.ts` | Skipped for `reset: true` and for a new `track: false` option, which `ConsoleShell.tsx`'s two boot calls pass. Custom preset ids never leave the browser. |
| `layer_toggled` | `layer` (core `LayerKey` or registered signal id), `on` | `SourceCatalog.tsx:309`, `CommandPalette.tsx:177`, `FreshnessTicker.tsx:47` | User toggles only. `layersStore.set` also runs on hydrate, presets and widget "show on map", so the store is the wrong place. An id outside the registry is dropped. |
| `share_link_copied` | `what`: `view` or `layout` | `copyShareLink`, `CommandPalette.tsx:221`, `settings/DisplayTab.tsx:32` | Counted only when the copy succeeds. |
| `alert_armed` | none | `RulesPanel.tsx:96` | No area, no radius, no source. |

- **Not included: `stream_played`.** `<video onPlaying>` also fires when muted tiles autoplay on a board
  and again after every buffering stall. It would count autoplay, not intent. The access log already
  counts `/api/hls`.
- "Time per visit" and "pages per visit" need no new event. `$pageview`, `$pageleave` and PostHog's
  session duration already carry them.

### 5. The opt-out control: `components/analytics/CountingToggle.tsx`

- A small client component inside the /privacy cookies section.
- States: "This browser is counted." with **Stop counting this browser**. "This browser is not counted."
  with **Count this browser again**. If DNT or GPC is on: "Your browser asks not to be tracked, so it
  is not counted." and no button.
- Stop counting: `optOut()`, and on a live client `opt_out_capturing()`, so this tab stops at once.
- UK PECR Schedule A1 asks for "a simple means of objecting". A settings-tab copy of the control is a
  possible later step and is not in this change.

### 6. /privacy changes

Every sentence that promises "nothing links visits" moves in the same commit. Draft wording:

- **Top card** (`page.tsx` ~211-216): "...counts page views and clicks, on PostHog's European servers,
  and can tell a new visit from a return. No Google Analytics, no ad pixel, no session recording, and
  nothing that says who you are."
- **Cookies heading** (~715): "No cookies of ours. Two counters, and neither knows who you are."
- **Beacon paragraph** (~742-750): the tab identifier "cannot follow you to another site or to your
  next visit". The DNT sentence moves to the opt-out paragraph.
- **New paragraph:** "One thing does outlive the tab. Your browser keeps two dates in its own storage,
  under `tn.visit.v1`: the day you first came and the day you last came. When you open the site, the
  counter is told only whether this browser has been here before and, if so, roughly how long ago: the
  same day, the day before, within a week, within a month, or longer. The dates are not sent. Every
  browser that came back within a week sends the same words, so the counter can say how many visits are
  returns but not whose. The entry is deleted 13 months after your first visit, and a later visit does
  not extend that."
- **New opt-out paragraph plus the control:** "You can turn this off with the button below. It stops
  the page-view counter in this browser, deletes the visit dates, and remembers your choice under
  `tn.analytics.optout.v1`. If your browser sends Do Not Track or Global Privacy Control, the counter
  does not load and nothing is written."
- **Storage table:** two new rows, one for `tn.visit.v1` ("No. Only new or returning, and roughly how
  long ago, is sent") and one for `tn.analytics.optout.v1` ("No").
- **Rights paragraph** (~878): "...which sets no cookie, keeps only your first and last visit dates on
  your own device, and does not run at all if you turned it off or your browser sends Do Not Track or
  Global Privacy Control."
- **Processor sentence, only after the DPA is signed** (gate item 1): "PostHog processes this for us
  under a data processing agreement and may not use it for anything else."
- The "Last updated" date (lines 178 and 906, and the sentence at 913) moves to the ship date, and
  `privacy-page.test.ts` moves with it.
- The evidence comment gets a "WHAT CHANGED ON <ship date>" entry that names each file above.

## Legal gate: before merge

Research on 2026-09-14 by a background agent, from primary sources. **This is not legal advice.**

- **EU ePrivacy Art 5(3):** writing `tn.visit.v1` is "storage". Sending a bucket derived from it is
  "gaining access", whether or not it is personal data (EDPB Guidelines 2/2023 v2.0, §10, §44).
- **UK:** since 5 Feb 2026, PECR Schedule A1 para 5 exempts storage for statistics "with a view to
  making improvements". The conditions are clear information, a simple free way to object, and data
  shared only with someone who helps make those improvements. ICO guidance (29 Apr 2026) adds that the
  provider "must be a processor", that "you must not solely rely on browser settings", and that consent
  is needed if you "retain the individual-level information (after aggregating it)".
- **France (CNIL):** exempt if the only purpose is audience measurement for the publisher, the output
  is anonymous statistics, and the provider does not reuse the data. Recommended: a notice, a 13-month
  cap that visits do not renew, and 25-month retention.
- **Netherlands:** exempt for quality or effectiveness data with little privacy impact, if visitors are
  told.
- **Germany:** §25 TDDDG has no analytics exception. The DSK says simple visitor counts are not part of
  the basic service as such. Consent is probably needed.

| # | Condition | Met by | Owner |
|---|---|---|---|
| 1 | PostHog is a processor, under a signed DPA, with no other use of the data. Check what it says about transfers outside the EU. | PostHog DPA | **Sam** |
| 2 | A notice that states the purpose | Section 6 | this change |
| 3 | A simple objection that does not rely on browser settings | Section 5 | this change |
| 4 | The entry expires 13 months after the first visit, and visits do not renew it | Section 1 | this change |
| 5 | PostHog event retention is at most 25 months | PostHog project settings | **Sam** |
| 6 | No person profiles, no session replay, reads use totals only | `person_profiles`, `disable_session_recording`, a working rule | this change + practice |
| 7 | A decision on German visitors | see below | **Sam** |

**Still uncertain, and not created by this change:** PostHog keeps one row per event, with a per-tab
id. It is not clear whether that is "anonymous statistics" (CNIL) or retained individual-level
information (ICO). The beacon has had this property since 8 Sep. This change adds an objection path and
turns person profiles off, so it narrows the gap rather than widening it.

**Germany: a decision for Sam.** In 5 pulled rollup days, requests from DE were 3.9% of all
country-tagged requests. That figure counts requests, not people, and includes crawlers. The options:

- (a) Treat German visitors like everyone else, as the beacon has done since 8 Sep.
- (b) Do not load the beacon in a browser whose time zone is `Europe/Berlin` or `Europe/Busingen`.
  Nothing loads, nothing is sent, nothing is written. It is crude: it misses Germans on other time
  zones and includes anyone else set to Berlin time. It costs one line in `shouldCount`.
- (c) A consent prompt for EU visitors. This goes against the site's no-banner identity and is a
  project of its own.

## Reading the numbers (after Sam logs in to PostHog)

- **Returning share:** unique sessions with `visit_kind = returning` and `return_gap != same_day`,
  divided by unique sessions where `visit_kind` is set. `same_day` is left out of the headline, because
  a second tab on the same day is also a "return".
- **Gap distribution:** sessions by `return_gap`.
- **Usage, new against returning:** pageviews per session, median session duration, and each event per
  session, all broken down by `visit_kind`.
- **Safari check:** the returning share broken down by `$browser`.

**Warm-up.** On launch day every browser has no record, so every visit is `new`. Do not read the
returning share before 14 days. Do not read `8_30d` before 30 days or `over_30d` before 60 days.

## Known limits

- **Safari and iOS delete script-written storage** when a site is not used for 7 days of browser use
  (WebKit ITP). A Safari visitor who comes back after a longer gap looks `new`. Mobile was 734 of 1,015
  pageviews on the first rollup day, so this bias is large and the `$browser` breakdown exists to show it.
- Private windows, cleared storage and a second device all look `new`.
- A tracker blocker stops the events. The posthog-js chunk comes from our own origin, so the record can
  still be written for a blocked browser. Nothing is sent from it.
- A second tab on the same day is `returning / same_day`.
- A visitor whose record is 13 months old is counted as `new` once.

## Tests

vitest, node environment. Storage is injected. Each guard is proven red before it goes green.

- `tests/unit/return-flag.test.ts`
  - gap edges at 0, 1, 2, 7, 8, 30 and 31
  - a month and a year boundary (`2026-12-31` to `2027-01-01` is 1)
  - `localDay` near midnight
  - expiry at 394 against 395 days
  - every corrupt shape resets to `new`
  - a returning visit keeps `first`
  - **not armed means zero `setItem` calls**
- `tests/unit/analytics-opt-out.test.ts`
  - DNT `"1"` and `"yes"`, and GPC
  - the opt-out flag disarms
  - `optOut` deletes `tn.visit.v1`
- `tests/unit/usage-events.test.ts`
  - `track` does nothing before binding and after an opt-out
  - for each event, the property keys are a subset of an allowlist and every value is enumerated
  - an unknown layer id is dropped
  - a custom board sends `custom`
  - `applyPreset(..., { track: false })` sends nothing
- `tests/unit/beacon-config.test.ts`: pins `person_profiles` and `opt_out_capturing_persistence_type`.
- `tests/unit/privacy-page.test.ts`
  - the new date
  - the page names the `VISIT_KEY` and `OPT_OUT_KEY` constants' values, so renaming a key without moving
    the page fails

**Gate:** `npx tsc --noEmit && npm test`. There is not enough free RAM here for `next build`, so the
build evidence is the `Vercel` commit status on the PR head, read with
`gh api repos/011-sam-110/Provenance/commits/<sha>/statuses`.

## Verification after deploy

In Sam's browser:

- first load: `tn.visit.v1` exists, and the first `$pageview` request body carries `visit_kind: "new"`
- no cookie is set
- a reload keeps `new`
- a new tab gives `returning / same_day`
- **Stop counting** deletes `tn.visit.v1` and no further request goes to `eu.i.posthog.com`

## Out of scope

- day-N cohort retention and any per-person history
- the first-party access-log beacon (approach 3)
- a `stream_played` event
- a settings-tab copy of the control
- a consent banner
