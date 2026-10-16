# Accounts, sign-in and settings sync: design

**Date:** 2026-10-15
**Branch:** `feat/accounts`, off `origin/main` at `a9d701c`
**Status:** design APPROVED by Sam on 2026-10-15. In conversation he chose the purpose, the
sign-in method, the approach (A) and Part 1. In the grill-me round after the plan, he approved the sync
list as written, chose `requireUser()` now with the entitlements table later, chose a `mail.`
subdomain for email (Resend first, then **Brevo** when a separate Resend team turned out to be a paid
feature), chose agent-driven setup with his approval at each step, and chose subagent-driven build.
Nothing is built.

## The request

Sam: "I want to introduce accounts, usernames and passwords. This should probably be done on supabase."
Then: "so todays the day it gets a database".

He chose three purposes for an account:

1. **Sync saved items.** The workspace, saved places, pins, alert rules and preferences follow the
   person to every device. Today all of it stays in one browser.
2. **Paid features later.** The account is the base for a future Pro tier. Nothing paid is built now.
3. **Know who comes back.** Count real returning people, not browser-days.

He did not choose public contributions. Nothing an account does is shown to other visitors.

## Summary

Provenance gets optional accounts on Supabase: email and password sign-in, a username as the display
name, and a Postgres database that keeps a copy of the settings a person made, so the console opens
the same way on every device. The map stays fully usable with no account. Every account feature is
dormant when the Supabase variables are not set, so self-hosters and preview builds behave exactly as
the site does today.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Provider | Supabase (Auth + Postgres) | Sam's choice. Free plan: 50,000 monthly active users, 500 MB database. |
| Approach | **A: the browser talks to Supabase directly**, protected by row-level security | No per-visitor work on the $12 Lightsail box. HTML stays identical for every visitor, so Cloudflare can keep caching it. Approved 2026-10-15. |
| Sign-in | **Email + password only** | Sam's choice. Supabase's built-in path, nothing custom. Password reset works by email. Billing needs an email later. |
| Username | Display name, set at sign-up, unique ignoring case, never used to sign in | Approved in Part 1. Unique now so it can become public later without a cleanup. |
| Session storage | `localStorage` (supabase-js default), **no cookie** | Keeps the beacon's "no cookies of ours" claim true and keeps HTML cacheable. |
| Region | **London (`eu-west-2`)** | Account data is personal data under UK GDPR. A UK region removes the international-transfer question for the controller. Browser-to-database latency for a US visitor is about 80 ms, which a settings sync does not feel. |
| Projects | Two: `provenance-dev` (local and preview) and `provenance` (production) | The free plan allows two active projects per organisation. Tests and experiments never touch real accounts. |
| Email delivery | **Brevo SMTP**, from `accounts@mail.provenance-online.com` (Sam, 2026-10-15: "Brevo instead of Resend") | Supabase's built-in sender is for testing only and sends a few emails an hour. Brevo's free plan sends 300 a day. Resend was the first choice; Sam's one Resend team already sends mail for another project, and a second team is a paid feature, so Provenance mail would have shared a quota and a reputation with it. A sending subdomain keeps the main domain's reputation apart, and another feature (breach-awareness) can get its own subdomain so the two never share a reputation. |
| Server-side check | **`requireUser(authorization)` in `lib/account/serverAuth.ts`**, the only file that reads the secret key (Sam, 2026-10-15) | Any future gated route (Pro, breach-awareness Tier C) calls it, so the secret key stays in one place. The `entitlements` table waits until Sam approves one of those. |
| Email links | `token_hash` links to our own pages, verified with `verifyOtp` in the browser | A PKCE code link fails when the email opens in a different browser from the one that signed up. A `token_hash` link works in any browser. |
| Retention | **First-party `activity_days` table in Supabase**, not PostHog `identify()` | On 2026-09-14 Sam rejected a persistent PostHog identifier. The beacon promises "nothing here calls identify()", and a test pins it. A row per account per active day lives in our own database and is deleted with the account by a cascade, so erasure needs no third-party call. |
| What syncs | An explicit allowlist, enforced in the client AND by a database check constraint | The privacy page can name exactly what is stored. Nobody can fill the free 500 MB with arbitrary keys. |
| Secrets | Never leave the device | The Telegram bot token, the Discord webhook URL and the alert webhook URL stay in localStorage, stripped before upload. |
| Conflicts | Last write wins, per key | Per-key granularity limits the damage. A database trigger stops an old client from overwriting a newer schema version. |
| Paid features | Not built | Approach A adds an `entitlements` table (server-writable only) and a token check when the Pro work starts, with no rework. |
| CAPTCHA | Not now | Email confirmation and Supabase's per-IP sign-up limits are enough at the current scale. Cloudflare Turnstile is the first response if bot sign-ups appear, and it would add a third party to /privacy. |

## Architecture

```
 Browser (/app)                                   Supabase, London
 ┌───────────────────────────────┐   HTTPS, JWT   ┌──────────────────────────┐
 │ lib/account/client.ts         │ ─────────────► │ Auth  (auth.users)       │
 │   supabase-js, lazy-loaded,   │                │ Postgres + RLS           │
 │   null when env is unset      │ ◄───────────── │   profiles               │
 │ lib/account/sync.ts           │   rows (own    │   user_state             │
 │   pull at boot, push on save  │   rows only)   │   activity_days          │
 │ lib/shell/persist.ts          │                └────────────┬─────────────┘
 │   savePersisted → sync queue  │                             │ SMTP
 │ localStorage (source of truth │                      ┌──────▼──────┐
 │   for the running console)    │                      │ Brevo       │──► confirm / reset email
 └──────────────┬────────────────┘                      └─────────────┘
                │ POST /api/account/delete  (Bearer JWT)
 ┌──────────────▼────────────────┐   secret key   ┌──────────────────────────┐
 │ Lightsail box (Next.js)       │ ─────────────► │ auth.admin.deleteUser    │
 │ the ONLY account route        │                │ (cascades every row)     │
 └───────────────────────────────┘                └──────────────────────────┘
```

**localStorage stays the source of truth for the running console.** Every store keeps reading and
writing it exactly as it does today. Sync is a layer around it: it copies allowlisted keys up after a
save, and it writes newer account values into localStorage before the stores hydrate. No store learns
about Supabase.

## Supabase configuration

Set in both projects (dev and production), written down in `docs/ACCOUNTS.md` so it can be repeated:

- **Auth, email provider:** on. **Confirm email:** on. Changing the email address is not offered in the
  UI yet, so no change-email flow is built.
- **Minimum password length:** 10. No composition rules (NIST SP 800-63B favours length).
  Leaked-password protection is a Pro-plan feature, so it is off for now.
- **Site URL:** `https://provenance-online.com` (production), `http://localhost:3000` (dev).
- **Redirect URLs:** `https://provenance-online.com/account/**` (production);
  `http://localhost:3000/account/**` and the preview box origin (dev).
- **SMTP:** Brevo (`smtp-relay.brevo.com:587`), sender `Provenance <accounts@mail.provenance-online.com>`.
  Brevo authenticated the subdomain `mail.provenance-online.com` on 2026-10-15 with four DNS-only
  records in the Cloudflare zone for `provenance-online.com`: a `brevo-code` TXT on `mail`, two DKIM
  CNAMEs (`brevo1._domainkey.mail`, `brevo2._domainkey.mail`) and a DMARC TXT on `_dmarc.mail`
  (`p=none`). One SMTP key per project (`supabase-dev`, `supabase-prod`), so either can be revoked alone.
  Brevo expires a key that sends nothing for 90 days, so the production key needs replacing if launch
  comes after 2027-01-13.
- **Brevo settings that the privacy page depends on.** Brevo keeps **no preview** of a sent message
  ("Never store previews") and deletes its delivery logs after **1 month**, the shortest it offers.
  Brevo **always** counts opens and clicks on transactional mail: it rewrites each link to pass through
  its own server, and it cannot be switched off below its Enterprise plan. The most it allows is
  "Anonymous email tracking", which stops tying opens and clicks to the recipient: set it to Yes.
  So the confirm and reset links pass through Brevo, and `/privacy` says so.
- **Email templates** (committed under `supabase/templates/`, pasted into the dashboard):
  - Confirm sign-up: `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=email`
  - Reset password: `{{ .SiteURL }}/account/confirm?token_hash={{ .TokenHash }}&type=recovery`
- **API keys:** the new key types. `sb_publishable_…` ships in the browser. `sb_secret_…` lives only
  on the box. The legacy `anon` and `service_role` keys are not used.
- **Data Processing Addendum:** none to sign. Supabase states that its DPA "is incorporated into our
  Terms of Service" and that "no separate signed DPA is needed" (checked 2026-10-15). Brevo's DPA is
  likewise part of its General Conditions of Use.

## Data model

One migration, `supabase/migrations/20261015000000_accounts.sql`, applied to both projects.
Row-level security is ON for every table. Policies use `(select auth.uid())`, which Postgres evaluates
once per statement and not once per row.

### `profiles`

| Column | Type | Rule |
|---|---|---|
| `user_id` | `uuid` PK | references `auth.users(id)` on delete cascade |
| `username` | `text` not null | 3 to 24 characters, `^[a-z0-9_]+$` after lower-casing; unique index on `lower(username)` |
| `created_at` | `timestamptz` | default `now()` |

- A trigger on `auth.users` insert creates the profile from `raw_user_meta_data->>'username'`, which
  the sign-up call sends, so no account without a profile can exist. A missing, invalid or taken name
  gets a placeholder (`u_` and 22 hex characters) and the person chooses a name after confirming.
  The trigger never fails the sign-up: an error for a new address only would tell a prober which
  addresses already have an account (changed after the M1 review, 2026-10-15).
- `username_available(name text) returns boolean`, a `security definer` function callable by `anon`,
  lets the form say "That username is taken" before submit. It reveals only whether a name is in use,
  and usernames are not secret.
- Policies: select and update own row. Update can change `username` only (a column grant).

### `user_state`

| Column | Type | Rule |
|---|---|---|
| `user_id` | `uuid` | references `auth.users(id)` on delete cascade |
| `key` | `text` | check: `key in (<the allowlist>)` |
| `version` | `int` not null | the persist envelope version |
| `value` | `jsonb` not null | check: `pg_column_size(value) <= 65536` |
| `updated_at` | `timestamptz` | set by trigger to `now()` on insert and update; the client never sends it |

- Primary key `(user_id, key)`.
- A `before update` trigger raises an error when `new.version < old.version`. An old open tab cannot
  overwrite data that a newer release wrote.
- Policies: select, insert, update, delete own rows only.

### `activity_days`

| Column | Type | Rule |
|---|---|---|
| `user_id` | `uuid` | references `auth.users(id)` on delete cascade |
| `day` | `date` | primary key `(user_id, day)` |

- Policy: insert own row only when `day = (now() at time zone 'utc')::date`. A client cannot back-date
  or forge a history. Select own rows. No update, no delete (the cascade removes them with the account).

### Abuse limits

The publishable key is public, so anyone can call the API as a signed-in user of their own account.
The database, not the client, enforces every limit: the key allowlist (at most one row per allowlisted
key per user, about 20 rows), 64 KB per row (about 1.3 MB per user at the very worst), one profile per
user, one activity row per user per day.

## What syncs

**The rule.** A key syncs if it holds something the person made or chose. A key stays on the device
if it holds a secret, a setting for this one screen, a cache, a "seen it" flag or analytics state.

The allowlist lives in ONE pure module, `lib/account/syncKeys.ts`. A unit test fails if the
migration's check constraint lists different keys.

| Key | What it is | Sync | Transform |
|---|---|---|---|
| `tn.watchlist.v1` | saved places | yes, **list merge** by `id` | none |
| `tn.map.pins.v1` | map pins | yes, **list merge** of `pins` by `id` | `activeId` stays local |
| `tn.events.assets.v1` | operator sites for alerts | yes, **list merge** by `id` | none |
| `tn.mkalerts.v1` | market price alerts | yes, **list merge** by `id` | none |
| `tn.console.v1` | the board on screen | yes | none |
| `tn.console.boards.v1` | one saved layout per board | yes | none |
| `tn.console.presets.v1` | custom presets | yes | none |
| `tn.console.activePreset.v1` | which board is open | yes | none |
| `tn.console.sceneChrome.v1` | hidden widgets per board | yes | none |
| `tn.inspector.v1` | World and drawn areas, their sources | yes | none |
| `tn.variant.v1` | monitor variant, custom variants | yes | none |
| `tn.scope.v1` | World / near me / region / AOI | yes | place scope is already dropped by `coerceSavedScope` |
| `tn.events.alerting.v1` | hazard alert rule | yes | **strip `webhookUrl`, `fired`, `seeded`**; keep the local values on download |
| `tn.notify.rules.v1` | area notification rules | yes | none (coercion drops a rule whose area does not exist) |
| `tn.notifications.v1` | per-widget notification rules | yes | **strip `discordWebhook`**; keep the local value on download |
| `tn.keymap.v1` | rebound shortcuts | yes | none |
| `tn.lang.v1` | language | yes | none |
| `tn.hud.v1` | HUD preferences | yes | none |
| `tn.camslot.prefs.v1` | camera tile preferences | yes | none |

Stays on this device: `tn.telegram.v1` (bot token, a secret), `tn.sources.railw`, `tn.viewmode.v1`
and `tn.terminal.mode.v1` (this screen; a wall display is one device), `tn.ui.v1` (a constant),
`tn.timewindow.v1` (not persisted by design, see CLAUDE.md), every boot, intro, notice, banner and
feedback flag, every cache (`tn.news.snapshot.v1`, `tn.planes.track.v1`, `tn.series.v1`,
`tn.notify.obs.v1`, `tn.camslot.history`, `tn.issOrbit.v1`), and all analytics state
(`tn.analytics.optout.v1`, `tn.visit.v1`, `tn.presence.id.v1`). `tn.profile.v1` stays local and is
superseded by `profiles.username` while signed in.

The implementation plan re-reads each store's persisted shape before it writes the transform. If a
store holds a field this table does not list, the plan stops and asks.

## Sync behaviour

### Upload (push)

- `savePersisted` gains a save listener that the sync queue sets while someone is signed in. It hears
  the key of each save; the queue ignores keys outside the allowlist. The ~20 stores do not change.
- The queue waits 2 seconds after the last note, then reads each noted key from localStorage, applies
  the key's upload transform, and compares the result with the last synced JSON for that key
  (kept in `tn.account.sync.v1`). Only a changed key is sent. This matters because every store's
  `hydrate()` re-saves its value at boot, and an unchanged value must not cause an upload.
- One `upsert` call sends all changed keys. On success the queue records each key's new synced JSON
  and the server's `updated_at`.
- On `pagehide`, a pending queue flushes at once.
- The queue does nothing when no one is signed in.

### Download (pull)

- **At boot only**, not on tab focus. A mid-session re-hydrate would have to replay the ordered
  hydrate sequence in `ConsoleShell` (variant before inspector, rules after inspector, and so on),
  and that order is load-bearing. A change made on another device appears the next time /app opens.
- **The console boots from localStorage exactly as today. The pull runs AFTER hydrate, and a newer
  account value is applied by writing it to localStorage and reloading /app once.** (Revised while
  writing the plan. The first draft pulled BEFORE hydrate with a 1,500 ms cap. That was rejected:
  while hydrate waits, child components and timers can write defaults into localStorage, and a
  reload is the only way to replay the load-bearing hydrate order in `ConsoleShell`.) Signed-out
  visitors and self-hosted builds never wait and never reload.
- The reload happens only within 4 seconds of boot and only once per tab session. A pull that
  finishes later does not reload under the person's hands: the Account tab says "Your account has
  newer settings from another device" with a "Load them" button.
- For each remote row: if `version` equals this device's stored version and the remote `updated_at`
  is newer than the one this device last synced, apply the key's download transform (merge in the
  local secrets) and write the envelope into localStorage. A remote row with a different version is
  not applied; if this device's version is newer, this device uploads its value.
- **An unsent local change wins.** If this device changed a key since its last sync (the upload
  failed or has not run), the pull skips that key and the queue uploads it.
- If the pull fails, the console keeps running from localStorage, and the account status reads
  "Not synced".

### First sign-in on a browser that already has data

Sign-in runs one reconciliation, then reloads /app so the hydrate sequence runs in its normal order:

| Account | This browser | Result |
|---|---|---|
| no row | has data | upload this browser's value |
| has row | default or empty | take the account's value |
| has row | has data, list key | merge by `id`; same `id` in both: the account's copy wins; then the store's cap applies |
| has row | has data, other key | take the account's value |

A brand-new account on a browser with data therefore uploads everything that browser has. A second
device then receives it.

**A different person on the same browser.** The sync meta keeps `lastUserId` through sign-out. When a
different account signs in, the browser's data is NOT merged or uploaded: the account's values
replace it, and any synced key the new account does not have is removed from this browser. The
device secrets go too: the Telegram bot token and both webhook addresses are reset, so the new
person's alerts cannot go to the last person's channels. One person's watchlist never lands in
another person's account.

The same reconciliation runs whether the session came from the password form or from an email
link, because the boot step compares the session's user with the meta's `userId`.

### Sign-out

Sign-out ends the session and stops sync. This browser's localStorage stays as it is: the person had
those settings before they signed in, and a map workspace is not sensitive. The account panel says so
in one line.

### Failure

Supabase down, offline, or a rejected write: the console works from localStorage, the queue retries
with backoff (5 s, 30 s, 2 min, then on the next save), and the account panel shows "Not synced. Last
synced 2 min ago" or "Synced". A rejected write for one key (for example the version trigger) drops
that key from the queue and logs it to the console; it does not block the other keys.

## UI

All new copy follows ASD-STE100 Strict (UI strings and error text). Design work runs through the
design skills (impeccable, taste, ui-ux-pro-max, frontend-design) with at least two critique rounds,
inside the console's existing calm light identity and `.tn-*` tokens.

- **Header entry.** One new `.tnx-hdr-btn` at the end of the `TerminalHeader` right cluster, after
  SETTINGS. Signed out: `SIGN IN`. Signed in: the username. Its label uses `.tnx-hdr-btn-label`, so it
  collapses to an icon under 720 px. It renders nothing when Supabase is not configured.
- **Settings drawer, new "Account" tab.** `SETTINGS_TABS` gains `account` (label "Account", blurb
  "Your sign-in and sync"). The header button opens the drawer on this tab. Placed last, so Main stays
  the landing tab.
  - Signed out: Sign in (email, password), Create account (username, email, password), Forgot password
    (email). One form visible at a time.
  - Waiting for confirmation: "Check your email. Open the link to finish."
  - Signed in: username (editable), email, sync status, "Sign out", "Delete account" (asks for the
    password again, then a typed confirmation).
- **`/account/confirm`**, a client page outside the console: reads `token_hash` and `type`, calls
  `verifyOtp`. `email` goes to `/app`. `recovery` shows a "Set a new password" form,
  then goes to `/app`. A bad or expired link shows one sentence and a link back to /app.
- **The dead `ProfileMenu.tsx`** (its sign-in "coming soon" seam) is not reused. `StatusBar` no longer
  mounts anywhere, so neither does it. Deleting both is a separate follow-up, not part of this work.

Error messages map Supabase errors to fixed sentences. The client never shows a raw upstream message.
Examples: "Email or password is wrong." "That username is taken." "Too many tries. Wait a minute and
try again." "Confirm your email first. We sent you a link."

## Server: `POST /api/account/delete`

- Reads `Authorization: Bearer <access token>`. Verifies it with
  `admin.auth.getUser(token)` (a network check that the user still exists).
- Calls `admin.auth.admin.deleteUser(id)`. The cascades remove `profiles`, `user_state` and
  `activity_days`.
- Answers 204 on success, 401 for a missing or bad token, 503 when Supabase is not configured, and one
  generic 502 for any upstream failure. It never echoes an upstream error (the credential-oracle rule
  from `/api/feedback`).
- `Cache-Control: no-store`. Checks `Origin` against the site URL.
- The handler is a pure function with an injected admin client, so a unit test covers each answer.
- `/privacy` names it as a route that reads an identifying header, and the IP-claim test's pattern
  learns `authorization`.

## Retention

- When a session exists, the client inserts today's `activity_days` row once per UTC day per browser
  (a local date in `tn.account.sync.v1` avoids repeat calls; the primary key absorbs any duplicate).
- `docs/analytics/accounts-retention.md` holds the SQL Sam runs in the Supabase SQL editor: accounts
  created per week, accounts active per week, accounts active again N weeks after sign-up, and
  "accounts active on more than 6 days" (the question PostHog could not answer on 2026-10-04).
- Nothing is sent to PostHog. The beacon config and its test do not change.

## Public claims that change

The privacy page is built at deploy time, and `NEXT_PUBLIC_SUPABASE_URL` is fixed at build time too.
So the page renders the **account version of each claim only when accounts are configured**, and the
current wording otherwise. The page stays exactly true for production and for every self-hoster.

| Where | Today | With accounts configured |
|---|---|---|
| `/privacy` card "No account" | "There is no sign-up, no login and no password." | "Accounts are optional." Names what an account stores and that the map needs none. |
| `/privacy` card "No database" | "No database …" | Names the one database (Supabase, London), its three tables, and that it holds only account data. |
| `/privacy` card "Settings stay local" | "They are never uploaded." | "Saved in your browser. If you sign in, a copy goes to your account so other devices get it. Secrets never leave the device." |
| `/privacy` "What your own browser keeps" | lists storage keys | adds the Supabase session key and `tn.account.sync.v1` |
| `/privacy` "Who sees your IP address" | no Supabase entry | Supabase entry (signed-in visitors, and anyone who opens the Account tab) |
| `/privacy` "No account" card and "Your rights" | no email sender | Brevo, named as the sender that receives the email address to deliver confirmation and reset mail, and as the service that counts opens and clicks and that each link passes through |
| `/privacy` "Your rights" | "There is no account …" | self-serve delete, what it deletes, and that the browser copy stays until you clear it |
| `lib/brand.ts` description | "No login, no API keys." | "No account needed, no API keys." (true in both states, so not conditional) |
| Landing hero `app/(site)/page.tsx` | "Free, open source, no login." | "Free, open source, no account needed." |
| OG card `app/api/og/route.tsx` | "open data · no login" | "open data · no account needed" |
| README line 26 | "needs no key and no login" | unchanged: still exactly true |

The page's evidence comment and its "last checked" date are re-run and re-dated, and
`tests/unit/privacy-page.test.ts` gains assertions for the new claims.

## Environment variables

| Name | Where | Kind |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | GitHub Actions **variable**, build step of `deploy.yml` | public |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | GitHub Actions **variable**, build step | public by design |
| `SUPABASE_SECRET_KEY` | box only, `/srv/provenance/shared/.env` (owner `app`, 600) | secret |

All three get a `KEY_REQUIREMENTS` entry (id `accounts`, in `NON_SIGNAL_IDS`) so `/api/status`
reports the capability honestly, plus a section in `docs/API_KEYS.md`. With the two public variables
unset, the client module returns `null`, and no account UI, no pull, no queue and no Supabase script
loads. With only the secret unset, accounts work and delete answers 503; the Account tab then hides
the delete button and says to open an issue, which is the contact route /privacy already gives.

`@supabase/supabase-js` is imported dynamically from the account code, so a signed-out visitor who
never opens the Account tab downloads only a small session check (a localStorage read), not the
library.

## Security

- Row-level security on every table; the RLS check script proves it against the dev project.
- The secret key never enters the browser bundle or CI. A unit test fails if `SUPABASE_SECRET_KEY`
  appears in any file under `components/` or in a `"use client"` module.
- No raw upstream error reaches the client.
- Email enumeration: Supabase returns the same answer for a new and an existing email at sign-up when
  confirmation is on (`mailer_autoconfirm` and `sms_autoconfirm` both false). Our copy keeps that:
  "Check your email" in both cases. The profile trigger never raises, so it cannot break the match.
  One limit is Supabase's own and stays: it rate-limits emails per address, so two sign-up or reset
  requests for the same address inside a minute fail through the API only when that address has an
  account. Our UI shows the same sentence either way (M2), but a direct API caller can see it.
  Public copy must therefore never say that nobody can find out whether an address has an account.
- Passwords never touch our server. Supabase hashes them with bcrypt.
- Cloudflare: account calls go to `*.supabase.co`, not through our origin, so no cache rule can
  replay one person's answer to another.

## Testing

| Layer | What | In the gate |
|---|---|---|
| Unit (vitest, node) | `syncKeys`: allowlist, transforms strip every secret field, list merge, diff, version rule | yes |
| Unit | allowlist equals the migration's check constraint (parses the SQL file) | yes |
| Unit | every allowlisted key is a real persist key in the code | yes |
| Unit | delete handler: 204, 401, 503, 502, no upstream text | yes |
| Unit | env guard: three new names declared; secret key absent from client code | yes |
| Unit | privacy page: conditional claims present for both states | yes |
| Script | `scripts/check-account-rls.mjs` against `provenance-dev`: two throwaway users; B cannot read or write A's rows; non-allowlisted key refused; 65 KB value refused; version downgrade refused; back-dated activity row refused; anonymous reads nothing; delete cascades | no (needs the dev project), run at M1 and before launch |
| E2E | `tests/e2e/accounts.spec.ts`: sign up (link from `auth.admin.generateLink`), confirm, change a board, sign in from a second browser context, see the board | no (Playwright is not in the gate), run before launch |

## Roadmap

Each milestone is one commit `M<n>: <name>`, its own PR off the latest `main`, solo attribution, as
CLAUDE.md requires. Every milestone merges dormant: nothing changes on production until the two
public variables are set and the site is redeployed.

| Stage | Delivers | Depends on |
|---|---|---|
| **M0: Sam's setup** | Supabase organisation and two London projects, Brevo account and DNS records, SMTP and email templates in both projects, keys handed over | none |
| **M1: Database and client** | migration, RLS check script, `lib/account/client.ts` (dormant-safe), env vars declared, `docs/ACCOUNTS.md` | M0 |
| **M2: Sign-in** | header button, Account tab, `/account/confirm`, username check, error copy, email templates | M1 |
| **M3: Sync** | `syncKeys`, queue in `savePersisted`, boot pull, first-sign-in merge, status line | M2 |
| **M4: Delete and retention** | `/api/account/delete`, `activity_days` writes, retention SQL doc | M2 (runs beside M3) |
| **M5: Public copy and launch** | conditional `/privacy`, tagline, landing, OG card, `deploy.yml` variables, box secret, e2e run, production switch-on | M3, M4 |

## Risks

- **A reload on boot for signed-in visitors** when another device changed something since this one
  last synced. Measure how often and how fast at M3. On the device a person uses every day it does
  not happen.
- **The free project pauses after 7 days with no API calls.** Real sign-ins prevent it. While the site
  is dormant the dev project may pause; resuming takes a click.
- **Brevo's 300 emails a day.** A bot burst at sign-up could use up the day and delay real
  confirmation emails. Turnstile is the planned response.
- **The reset link passes through Brevo.** Brevo's click tracking rewrites it, so Brevo's systems see
  a working reset link. It is single use and expires after one hour (Supabase's email OTP expiry),
  and Brevo keeps no message preview. Removing the rewrite needs Brevo's Enterprise plan or another
  sender.
- **Last write wins** can lose an edit when two devices change the same key between syncs. Accepted:
  per-key granularity keeps the loss to one store.
