# Feedback prompt — design

Date: 2026-08-18
Branch: `feat/feedback-prompt` off `origin/main` (80b684d)
Status: awaiting approval

## What it is

A one-time in-console prompt that asks a visitor four things:

1. What occupation are you in?
2. What do you find useful here?
3. Rate the tool 1–10.
4. Optional email, so Sam can arrange a 15-minute video call.

It appears only to visitors who have plausibly *used* the thing — 15 minutes of
active time, or a return visit — and only to a third of them, and never twice.

## Why the shape is what it is

Provenance has **no database, no auth and no server-side storage**. Every route
under `app/api/` is a stateless relay or proxy; all persistence is `localStorage`
through the versioned envelope in `lib/shell/persist.ts`. A feedback feature that
assumed a table would have meant provisioning Neon, which is the thing that stalled
the ops-analytics milestone. So the design deliberately stays inside the grain of the
codebase: client-side gating in `localStorage`, delivery through a thin relay that
mirrors `app/api/telegram/route.ts`.

## Components

Three new units plus one mount line. Each is separately testable.

### `lib/shell/feedback.ts` — the gate (pure, no React, no DOM)

Owns every decision about *whether* to show the prompt. Storage is injectable, the
same trick `persist.ts` uses, so the whole thing is unit-testable in the node vitest
environment without a `window`.

Persisted state, under one versioned key `tn.feedback.v1`:

| field | meaning |
|---|---|
| `visits` | count of distinct visits (incremented once per page load) |
| `activeMs` | cumulative **visible** time across all visits |
| `resolved` | `"submitted"` \| `"dismissed"` \| absent — the permanent stop |

Ephemeral (in memory, per visit): whether this visit's roll has been made, and its
outcome.

Exported pure functions: `qualifies(state)`, `rollFor(visit)`, `shouldPrompt(state,
context)`, `recordVisit`, `addActiveMs`, `markSubmitted`, `markDismissed`.

### `components/shell/FeedbackPrompt.tsx` — the modal

Centred card over a dimmed app, matching the tour's menu card so it reads as part of
the console rather than a bolted-on widget. Uses the existing `--tn-*` tokens, so it
inherits light/dark and the terminal skin for free.

### `app/api/feedback/route.ts` — the relay

`POST` only. Validates, then forwards one `sendMessage` to Telegram using
**server-side** env vars. Fails closed to `{ ok: false }` with a 200, the
dormant-safe convention both sibling relays already follow.

### `components/shell/ConsoleShell.tsx` — one line

Mounted as overlay chrome alongside `<TourOverlay />`, after `<TerminalFooter />`.

## Trigger logic

```
qualifies   = activeMs > 15 min  OR  visits >= 2
blocked     = resolved is set
             OR boot sequence playing
             OR tour open (tourStore.isActive())
             OR cinematic dive running
roll        = 1-in-3, made ONCE per visit
show        = qualifies AND !blocked AND rollWon
```

Four judgement calls inside that, each of which you can veto:

**The roll is per visit, not per browser.** "Never ask twice" plainly means never
nag someone who already answered or said no — so `submitted` and `dismissed` are
permanent. But if a *lost roll* were also permanent, two thirds of everyone who ever
uses the tool would be silently excluded forever, which is not a sampling policy, it
is a cap. A returning visitor gets a fresh roll.

**15 minutes means 15 minutes of visible time, not wall clock.** A ticker accumulates
only while `document.visibilityState === "visible"`. Otherwise a tab left open
overnight — completely normal for a live map — qualifies without anyone having looked
at it, and the trigger stops meaning what it says.

**It re-checks mid-session.** A first-time visitor who crosses 15 minutes is prompted
during that visit, not on their next one. That is the whole point of the 15-minute arm.

**It yields to the boot plate, the tour and the cinematic dive.** Landing a modal on
top of a first-run walkthrough would be the worst possible first impression.

`?feedback=1` forces it open for review, the same override precedent as `?boot=1`.

## The form

| Field | Control | Required | Cap |
|---|---|---|---|
| Occupation | select + free-text "Other" | yes | 100 chars |
| What's useful | textarea | yes | 1000 chars |
| Rating 1–10 | radio group, ①–⑩ | yes | int 1–10 |
| Email | `type="email"` | **no** | 200 chars |

The occupation select is a judgement call worth naming: a free-text box gives you
prose you have to read and cannot count, whereas a short list — Journalist,
Researcher/Academic, OSINT / investigations, Security / defence, Software /
engineering, Emergency response, Student, Other — is one tap, lifts completion, and
lets you actually segment who is showing up. "Other" reveals a text input so the
unexpected answers still land.

## Data flow

1. `ConsoleShell` mounts `FeedbackPrompt`.
2. On mount: `recordVisit()`, start the visible-time ticker.
3. Ticker (every 30s) re-evaluates `shouldPrompt`.
4. On first true: roll, and if won, open the modal.
5. Submit → `POST /api/feedback` → `markSubmitted()` → thank-you state → auto-close.
6. Esc, ✕, or "No thanks" → `markDismissed()`. All three are permanent.

## Privacy

There is **no `/privacy` page in this repo**, and this feature collects an email
address and an occupation from UK/EU visitors. The point-of-collection duty is met
inside the form itself:

- A line under the email field stating plainly who receives it, what it will be used
  for (one message, to ask for a call), and that it goes via Telegram.
- Email is optional and the form submits without it.
- The payload carries **only what the visitor typed**, plus which arm triggered the
  prompt. No IP, no user agent, no session id, no board state.
- The email address is **never persisted anywhere**. It is not written to
  `localStorage` (only the `resolved` flag is), not attached to any analytics event,
  and **not logged server-side** — the route must not `console.log` the body, including
  on the error path, because that is exactly where an address leaks into Vercel's log
  drain.

A standalone `/privacy` page is a real gap but a separate piece of work; I am not
smuggling it into this branch. Flagging it, not fixing it.

## Abuse controls

This route differs from `/api/telegram` in a way that matters: that one relays the
*user's own* credentials, so the worst case is they spam themselves. This one holds
**your** bot token, which makes it an unauthenticated write path into your Telegram.

- A hard **server-side** body-size cap, read off `Content-Length` and enforced again
  while reading the stream. The client's own caps are a convenience, not a control;
  nothing trusts them.
- Malformed or oversized JSON is rejected **before** any outbound fetch is attempted,
  so a junk flood never costs an upstream call.
- Same-origin check on the `Origin` header.
- Honeypot field a human never sees and never fills.
- Minimum dwell: reject a submit under 3 seconds after the form opened.
- Hard length caps and a strict field whitelist; total message size capped.
- Best-effort per-IP-hash rate limit, in memory. Stated honestly as best-effort:
  Fluid Compute instances are ephemeral and plural, so this is a speed bump, not a
  guarantee. The caps above are the real protection.
- If `FEEDBACK_TELEGRAM_BOT_TOKEN` / `FEEDBACK_TELEGRAM_CHAT_ID` are unset the route
  is dormant and the prompt never mounts — no dead form on a deploy without secrets.

## Testing

Test files live at **`tests/unit/feedback.test.ts`** and nowhere else. `vitest.config.ts`
includes only `tests/unit/**/*.test.ts`, so a file at `tests/` root — or any `.test.tsx`
— is silently skipped and still reports green. There is also no React testing library
in the repo, so `FeedbackPrompt` gets no component test; its behaviour is covered by the
pure gate module underneath it plus the Playwright pass.

**Unit (vitest, node):** eligibility maths at the boundaries; visible-time
accumulation ignoring hidden time; roll fresh per visit; `dismissed`/`submitted`
permanent; version bump invalidating a stale shape; the route's validator accepting a
good payload and rejecting each malformed one.

**E2E (Playwright):** force with `?feedback=1`, assert dialog semantics and focus
trap, fill and submit against a stubbed route, assert the permanent flag and that a
reload does not re-prompt. Esc dismisses permanently.

## Out of scope

Aggregate reporting or a dashboard for responses; a `/privacy` page; showing the
prompt on the marketing landing page; i18n of the form copy.

## Deploy note

Two new env vars in Vercel: `FEEDBACK_TELEGRAM_BOT_TOKEN`, `FEEDBACK_TELEGRAM_CHAT_ID`.
Until they are set the feature is dormant in production.
