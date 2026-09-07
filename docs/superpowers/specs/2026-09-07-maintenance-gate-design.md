# Maintenance gate — design

**Date:** 2026-09-07
**Branch:** `feat/maintenance-gate`
**Status:** approved, not yet implemented

## Why

Visitor volume pushed Provenance's running cost past what the project carries. The site
comes down while the cost is fixed. The stated window on the curtain is **within two
weeks** (revised down from "about a month" on 2026-09-07, before the gate was armed).

The goal is **cost, not concealment**. A gate that hides the UI but still renders pages,
revalidates ISR and fetches upstreams would have solved nothing. Success is measured as:
a gated request costs one edge invocation and no more — no React render, no ISR write,
no upstream fetch, no large asset transfer.

A password lets one person (Sampo) through to the live site from any browser.

## Decision

A Next.js edge middleware gate, armed by an environment variable, merged to `main` and
left switched off between uses.

**Rejected — Vercel Password Protection.** It is a paid add-on; the docs say plainly it
"requires an eligible plan". Paying a subscription to reduce a bill is the wrong shape.

**Rejected — a static holding deployment.** Truly zero compute, and nothing of the site
would even be present to leak, but there is no password path: the real site would only be
reachable from a separate Vercel-authenticated preview URL. That is not what was asked for.

## Prior work already on disk

`lib/gate/` exists, untracked, in this worktree: `paths.ts`, `token.ts`, `page.ts` (254
lines). It is sound and is kept. It stops short of doing anything — there is no
`middleware.ts` and no `/api/gate` route, so nothing invokes it.

Four changes are made to it, each recorded below with its reason:

1. **The `noindex` meta comes out** (`page.ts`). It contradicts the index-preservation
   reasoning in `paths.ts`. On a 503 it is largely inert, but if the status ever
   regressed to 200 it would silently deindex every camera page. It is a loaded gun for
   no benefit.
2. **`/api/*` becomes gated**, except `/api/gate`. See the exemption principle below.
3. **The copy is replaced** with the wording agreed on 2026-09-07, and a Discord link is
   added — the page currently has neither.
4. **Two defects are fixed.** `gateMatcher()` does `s.replace(/\./g, "\.")`, and `"\."`
   in a JS string literal is just `"."` — the dots it claims to escape are not escaped.
   And the `~1M requests a day` figure in the `paths.ts` header cites `next.config.ts`,
   which contains no such number; the claim is unsourced and is removed rather than
   repeated.

## What is gated

The prior work carries a flat exemption list. It is replaced by a principle, because a
list gives no guidance about a file added later:

> **Chrome and crawl signals pass. Pages, data and compute are gated.**

Measured against `public/` on 2026-09-07 (`du -sh public/*`):

| Path | Size | Gated? | Why |
|---|---|---|---|
| `/api/*` | — | **gated** | 42 routes and every upstream feed. This is where the cost is. |
| `/api/gate` | — | exempt | The unlock endpoint. Gating it would lock everyone out permanently. |
| pages (`/`, `/app`, `/camera/*`, …) | — | **gated** | The point of the exercise. |
| `sitemap`, `sitemap.xml` | — | **gated** | It is a render that may fan out to the camera registry. A 503 sitemap is a mild signal Google retries. *Differs from the prior work, deliberately.* |
| `public/webcams/` | 8.4 MB | **gated** | The largest thing served. Only ever fetched by gated HTML, so legitimate traffic is zero either way — gating it means a scraper costs one invocation instead of 8.4 MB of egress. |
| `public/textures/`, `public/sky/` | 3.8 MB | **gated** | Same reasoning. Only the globe requests them, and the globe is behind the gate. |
| `public/geo/` | 208 KB | **gated** | Data. |
| `robots.txt` | — | exempt | A 503 on robots.txt makes Google stop crawling the site entirely, which is louder than the outage warrants. |
| `_next/`, `_vercel/` | — | exempt | Build assets, RSC payloads, the analytics beacon. Served from the CDN with **no function invocation**; gating them would add an invocation per request and leak nothing, because the HTML that references them is gated. |
| `public/brand/` | 912 KB | exempt | OG card images. Keeps already-shared links rendering a card. |
| `favicon.svg`, `icons/`, `sw.js`, `.well-known/` | 128 KB | exempt | Chrome. A 503 here breaks the installed PWA and hides nothing. |

`isGatedPath()` stays the single source of truth, and `middleware.ts` carries a
`config.matcher` derived from the same list so an exempt request never invokes the
function at all. Next requires the matcher to be a string literal, so it cannot import
the list — a unit test derives the literal and fails if the two drift apart.

## Behaviour

1. `MAINTENANCE_MODE` unset → `next()` on the first line, no other work.
2. Armed, path exempt → never matched, so the function does not run.
3. Armed, valid `pv_gate` cookie → `next()`.
4. Armed, `POST /api/gate` → verify the code, set the cookie, `303` to `safeNext(next)`.
5. Armed, anything else → the curtain.

**Fail closed.** If `MAINTENANCE_MODE` is set and `MAINTENANCE_PASSWORD` is missing or
empty, the gate still serves the curtain and the page says the code is not configured.
Failing open would leave the site up and billing, which is the failure this exists to
prevent. Recovery is: set the variable, redeploy.

**Production only.** Both variables are set on Vercel Production. Previews are
unaffected and stay behind Vercel Authentication as they already are.

## The response

- `503 Service Unavailable`
- `Retry-After: 3600`
- `Cache-Control: no-store` — **load-bearing.** The CDN keys on URL, not on the cookie. A
  cached 503 would be replayed to everyone including an unlocked browser, which looks
  exactly like being locked out of your own site.
- `Content-Type: text/html; charset=utf-8`
- **No `X-Robots-Tag`, and no `noindex` in the document.** A directive to remove pages is
  the opposite of what a 503 is for.

### Why 503 and not 200

There are camera pages in Google's index. A `200` tells Google this holding page *is* the
content of every one of them, and it begins dropping them. A `503` with `Retry-After`
says the absence is temporary.

**It is the best signal available, not a guarantee.** Google treats 503 as "come back
later" and slows crawling, which is correct for days. Across two weeks some erosion is
likely regardless — 503 minimises it, it does not prevent it. The shorter the outage the
smaller that risk, so the window shrinking from a month to two weeks strengthens this
argument rather than changing it; a slip back towards a month is the case to re-read. The cheap hedge, if the
index turns out to matter more than the saving, is to let `/` alone through as a static
page: it costs nothing to serve and keeps one live URL for crawlers. Not built; a
one-line change to the exempt list.

## The session

`lib/gate/token.ts` is kept as written. The cookie is `sha256(prefix + code)`:

- no server state — every deployment validates it with nothing but the env var
- changing the code logs every browser out at once, so rotation is one edit
- the code itself never enters the cookie
- `pv_gate`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, 30 days
- `constantTimeEqual` hashes both sides first, so the compare is always over 64
  characters and length is not itself the leak. The edge runtime has Web Crypto but not
  Node's `timingSafeEqual`, which is why this is hand-rolled.
- `safeNext()` refuses anything that is not a same-origin path, so the unlock redirect
  cannot be turned into an open redirect.

### Choose a long code

The prior work's input is `inputmode="numeric"` and its comment describes a six-digit
code. Six digits is 10⁶, exposed for a month, with no rate limiting in front of it — a
script walks that in minutes. **Use a long random alphanumeric passphrase instead**, and
if the gate ever needs real resistance, the place for it is a Vercel Firewall rate-limit
rule on `/api/gate`, not middleware. The `inputmode` hint is removed.

## The curtain

One self-contained HTML document. Inline CSS, system fonts, no script, no asset request
of any kind — the stylesheet it would otherwise load lives behind the gate it is standing
in for. It follows the calm light identity by value (`--tn-*` values copied, not imported).

Reads `BRAND.name`, `BRAND.repoUrl`, `BRAND.license` and `BRAND.discordUrl` from
`lib/brand.ts`. Every interpolated value passes through `escapeHtml`.

**The source link is not decoration.** This page becomes what a network user of an
AGPL-3.0 program sees, and section 13 says they must be offered the Corresponding Source.
The console header and the site footer are the only two places that offer exists, and the
gate replaces both. `CLAUDE.md` says not to remove those links; keeping one on the curtain
is how that is honoured.

### Copy

> **Provenance is offline**
>
> A surge in visitors pushed the running cost past what this project can carry, so the
> site is down for now.
>
> A lot of feedback came in with those visitors. A new release is planned in about a
> month, and development updates go to the Discord.

Refusal line: *That code is not right. Check for a space on the end.*

### The Discord invite

`BRAND.discordUrl` is updated to `https://discord.gg/q45NU8qWk`, confirmed by Sampo on
2026-09-07 as the live invite, replacing `H5vB8TsVK`. One source of truth — the curtain
reads the constant rather than carrying a second copy.

**The invite must be set to never expire.** Discord invites expire by default and an
expired one renders a dead page with no error anywhere we would see it. On the curtain it
is the only link. This is a setting on Discord's side — *Edit invite → Expire after:
Never → Max uses: No limit* — and no test can verify it, because nothing in CI can reach
`discord.gg`. The existing comment in `lib/brand.ts` already records this rule; it now
also applies to a page where the link is the only way anyone learns anything.

## Files

| File | |
|---|---|
| `middleware.ts` | new — the gate, with a matcher derived from `GATE_EXEMPT_STARTS` |
| `app/api/gate/route.ts` | new — verify the code, set the cookie, 303 |
| `lib/gate/paths.ts` | kept, edited — `/api` gated, data dirs gated, escape bug fixed, unsourced figure removed |
| `lib/gate/token.ts` | kept as written |
| `lib/gate/page.ts` | kept, edited — `noindex` removed, copy replaced, Discord link added |
| `lib/brand.ts` | edited — `discordUrl` updated |
| `tests/unit/gate.test.ts` | new |

Environment, Production only: `MAINTENANCE_MODE=1`, `MAINTENANCE_PASSWORD=<long random>`.

## Tests

vitest, node environment, `tests/unit/gate.test.ts`, per the repo convention. Each
assertion is watched fail before the code that satisfies it is written — a pinning test
nobody saw go red is decoration.

- `isGatedPath` gates `/`, `/app`, `/camera/tfl:JamCams_00001.01234`, `/api/coverage`,
  `/sitemap.xml`, `/webcams/manifest.json`; exempts `/api/gate`, `/robots.txt`,
  `/_next/static/x.js`, `/favicon.svg`
- a camera id containing dots is gated — the list must never be "anything with a dot is a
  file"
- `gateMatcher()` equals the literal in `middleware.ts` (drift guard), and its escaping is
  a real regex escape
- `gateToken` is deterministic; a different code yields a different token
- `constantTimeEqual` is true for equal inputs and false for unequal ones of differing
  length
- `safeNext` rejects `//evil.example`, `/\evil.example` and absolute URLs, and strips a
  previous `?gate=denied`
- the curtain contains `BRAND.discordUrl`, `BRAND.repoUrl` and the licence short name
- the curtain contains **no** `noindex` and no same-origin `src`/`href` — proving it is
  self-contained

## What this does not do

- **No rate limiting.** One user, one long code. If it is ever needed, Vercel Firewall,
  not middleware.
- **It does not make a blocked request free.** Every gated request still costs one edge
  invocation. If the bill is still bad with the gate on, the next lever is Firewall rules,
  which deny before any function runs.
- **No instant toggle.** Arming and disarming both need a redeploy. Edge Config would
  remove that, at the price of a store to manage and a read per request; not worth it for
  a switch thrown twice.

## Accepted trade

`middleware.ts` merges to `main` and stays. Switched off it is an environment read and a
pass-through, but it runs on every non-exempt request forever. That is the price of
maintenance mode being a variable flip rather than a branch merge, and it was chosen
knowingly on 2026-09-07.
