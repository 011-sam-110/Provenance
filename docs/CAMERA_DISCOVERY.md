# Camera discovery, and the person who has to approve it

Adding a camera network to this repository used to cost an adapter module, an import
and a line in `registry.ts`. The fourteen adapters in `lib/sources/` differ from each
other almost entirely in which key holds the latitude. This subsystem turns that work
into data, and puts a human in front of the result.

Two commands is the whole workflow:

```bash
npm run dev            # then open http://localhost:3000/admin
```

`/admin` runs a discovery sweep. `/admin/verify` shows you one camera at a time.
Promote writes `lib/sources/discovered.data.ts`. You commit it.

---

## What discovery actually does

It asks open-data catalogues, not the web.

That is the load-bearing choice. The admission policy for this project says a camera
source must be **operator-primary** and must carry a **licence we can name**. A
catalogue entry gives both by construction: it is published *by* the agency that runs
the cameras, and CKAN, Socrata and ArcGIS Hub all carry a licence field. A web crawl
gives neither, and would mostly return aggregators — because aggregators are what rank
for "traffic cameras", and an aggregator cannot license video it does not own.

The funnel, with the honest attrition at each stage:

| Stage | What survives |
|---|---|
| 13 CKAN portals x 4 queries, plus Socrata and ArcGIS Hub | a few hundred datasets |
| `looksLikeCameraDataset` | most of the rest are speed cameras, enforcement notices and traffic *counts* |
| `machineReadable` | most published resources are PDFs and spreadsheets |
| fetch + sniff + normalise | many endpoints 404, or turn out not to be cameras |
| `runGates` | relays, bare-IP hosts and already-served networks die here |
| **a person at `/admin/verify`** | this is the only stage that can admit anything |

A run producing five candidates from several hundred datasets is the system working,
not failing.

## The column sniffer

Given rows of somebody else's JSON, it decides which key holds the latitude, which
holds the picture, and which is a stable id.

Every field is scored on **two independent axes and needs both**: the key's *name* must
look right, and the *values* must behave right across a sample. Either alone is a trap.
Name alone admits an ArcGIS layer whose column is literally called `y` and holds
6,712,004 metres of Web Mercator. Values alone cannot tell a camera's coordinate from
the coordinate of the nearest weather station.

Where the column names are not in English, two fallbacks take over, and both lean on
signals that do not depend on language:

- **A column of `.jpg` URLs is an image column** whatever it is called. A file extension
  is not ambiguous the way a number is.
- **The coordinate pair is resolved by country fit.** Given the country the catalogue
  says the data is about, exactly one of `(A,B)` and `(B,A)` puts the cameras on land
  and the other puts them in the sea. The pair is accepted only when it fits **and its
  reverse does not**, so an ambiguous feed is left unassigned rather than pinned on a
  coin flip.

There are deliberately **no non-English aliases in the pattern table**. Teaching it the
language of every feed you have already seen produces a sniffer that only ever
discovers feeds you have already seen. The Iceland fixture in
`tests/unit/discovery-sniff.test.ts` is the proof: its columns are `Breidd`, `Lengd` and
`Slod`, the name check scores all three zero, and the sibling test asserts the same
fixture resolves **nothing** without a country hint.

`confidence` is the sniffer's opinion of its own column assignment. It is an ordering
hint for the review queue and nothing else — the failure this subsystem actually fears,
a confident and wrong pin, scores high by construction.

## The gates

A **fail** is a rule this project has already settled and does not want re-litigated per
feed. A **warn** is a fact the reviewer needs and the code cannot rule on.

| Gate | Fails when | Why it is a rule and not a judgement |
|---|---|---|
| `relay` | the endpoint or any picture is on a known aggregator | a directory republishing an operator's video cannot license it to us, so it cannot be attributed honestly |
| `media-host` | a picture is on a bare IP address | an unsecured box on `IP:port` is somebody's leaked camera; indexing those turns this product into a leaked-camera index |
| `yield` | no row parsed | the mapping is wrong, not the feed |
| `country-fit` | most coordinates fall outside the declared country | the signature of a swapped lat/lon pair |
| `overlap` | most sampled cameras are already served | re-adding a network double-counts every camera in a figure this project quotes |
| `licence` | never fails | plenty of legitimate operators publish none, and the honest response is to *say so* on the source, not to invent a name |
| `transport` | never fails | plain-http pictures are blocked as mixed content, which a reviewer should know before admitting |
| `media-origin` | never fails | asks whether the picture host is the operator's own; on ArcGIS-hosted datasets the picture host is the *best* evidence of who the operator is |

The gates deliberately do **not** include "does the image load". That is a live network
fact that goes stale between the run and the review, so it is measured in the review UI,
at the moment of review, against the real URL.

### What a clean `overlap` is allowed to mean

A pass on `overlap` speaks only for the feeds that were in the registry snapshot when
the run happened, and it now says so.

The first live admission found out why. An ArcGIS mirror of **Caltrans District 4**
passed with "No sampled camera sits within 60 m of one already served". All twelve of
its samples were within 50 m of a camera this product already serves and eleven had
byte-identical image URLs — it was the `caltrans` adapter's own cameras, offered back
under a second key, and admitting it would have double-counted 746 of them.

The registry read was not empty, so the gate ran. It simply had no `caltrans` cameras in
it, because a feed that fails resolves to `[]` rather than throwing — the same last-good
behaviour that stops one outage emptying a region also makes an absent feed and an
absent duplicate look identical from inside a gate.

So `runGates` now takes `expectedSources`, the feed keys the registry is supposed to
contain, and a zero-overlap result with any of them missing is a **warn naming the
absent feeds** rather than a pass. The rule is the same one the licence gate follows:
where the code cannot know, it says it cannot know instead of reporting the comfortable
answer.

## The review tool

One camera at a time, and that is the point. A grid of thumbnails gets skimmed, and
skimming is how a pin 400 m into a field gets approved — every camera looks like a road
at 180 px.

Each card shows the live picture at full size and **satellite imagery** centred on the
coordinate with a crosshair. Satellite rather than a street map, because a street map
will happily draw a road name at a coordinate that is nowhere near the road: the label
comes from the nearest way.

| Key | Verdict |
|---|---|
| `→` | good camera |
| `←` | the picture is dead |
| `P` | the pin is wrong |
| `N` | not a camera |
| `U` | not sure |
| `R` | reload the picture |
| `⌫` | back, and clear that verdict |
| `⇧A` | admit the whole feed |
| `⇧X` | reject the feed |

The three rejections stay distinct rather than folding into one "bad", because they say
different things about the **feed**. A dead picture is usually one camera. A wrong pin is
usually a wrong column, and therefore every camera. A reviewer who sees three bad pins
in a row should reject the network — and can only notice that if the three were recorded
separately.

Before a feed can be admitted you have to type the **operator's name** and the
**attribution line**. Those are the two fields discovery cannot get right and must not
fake: the first live run offered `mailto:spatial@nzta.govt.nz` and `pweeks_DOIT` as
publisher names, and this repo puts the operator's own wording on a public line.

## Where things are written

| File | What it holds |
|---|---|
| `data/discovery/candidates.json` | the queue a run produced |
| `data/discovery/ledger.json` | every verdict, signed and dated |
| `lib/sources/discovered.data.ts` | **generated** by promote; the only thing the registry serves |

All three are committed. A review session ends with a `git diff` showing exactly which
cameras were opened and what was concluded, which is a better audit trail than a row in
a table nobody can see — and it is the reason this needs no database.

`lib/sources/discovered.ts` registers **one feed entry per admitted network**, not one
for all of them, because `registry.ts` keeps last-good per feed and a shared key would
let one network's outage discard every other discovered network's cameras in the same
round.

## Adding a feed changes two documents

`CAMERA_FEED_COUNT` is `14 + admitted.length`. When it moves,
`tests/unit/claude-md-counts.test.ts` and `tests/unit/readme-counts.test.ts` go red until
`CLAUDE.md` and `README.md` state the new figures. That is the guard working. The
promote endpoint says so in its response so nobody meets a red suite and assumes they
broke something.

## Security

There is none beyond a **production 404 on every route** under `/admin` and
`/api/admin`. No password, no session, no rate limit — because there is no listener.
These tools run against `npm run dev`, on the machine holding the checkout the verdicts
get committed to.

That is a deliberate trade. The previous attempt at an operator surface here needed a
passphrase, a TOTP secret, a lockout policy, a signed session cookie and a Postgres to
hold the attempt log: six pieces of security-critical code and a database this repo does
not otherwise have, all to protect a review queue. Not deploying it protects the review
queue completely.

`tests/unit/discovery-admin-gate.test.ts` enumerates the directory rather than a list, so
the failure it catches is someone **adding** a route and not thinking about the gate. It
was proven in both directions before it was committed: an unguarded route added to the
tree fails with its path named, and deleting the guard from an existing route fails too.

If this ever does need to be hosted, `feat/ops-analytics` has the wall already built and
reviewed. Reach for that rather than bolting a check onto this.

## Extending it

Adding a portal is one line in `CKAN_PORTALS`. Adding a country box for the coordinate
tie-break is one line in `COUNTRY_BOXES`. Neither needs a code change anywhere else, and
both are the reason the probe is catalogue-shaped rather than portal-shaped.

`upgradeMediaToHttps` on a descriptor rewrites that feed's `http://` media to `https://`.
Catalogues publish the URL the operator wrote down, and agencies still write http for
hosts that have served https for years — those pictures are then blocked as mixed content
on an https page, so the cameras are real, reviewed and invisible. It is **opt-in per
feed and set only after fetching the https form of real samples and getting images back**:
Houston TranStar carries it because all twelve of its sampled URLs answered `200
image/jpeg` over https. Blanket-upgrading instead would break the operators for whom http
is the only thing that answers, silently and only in production.

Known gaps, stated rather than left to be discovered:

- **Socrata and ArcGIS Hub give no country hint**, so their candidates only resolve a
  coordinate pair when the column names say which is which, or when `inferCountry` finds
  exactly one fitting box. A feed in a country with no box on file will not resolve.
- **CSV is not parsed.** A good number of catalogue resources are CSV and this pipeline
  is JSON-only.
- **No content-level dedupe.** Two catalogue entries pointing at the same data under
  different URLs both become candidates; the `overlap` gate catches it only once one of
  them is already served.
- **`country` is inferred from coordinates** where the catalogue is silent. It is
  recorded as inferred and shown to the reviewer, but a network straddling a border will
  get one country and the reviewer has to notice.
