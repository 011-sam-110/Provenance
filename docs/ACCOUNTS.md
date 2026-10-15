# Accounts

Optional sign-in on Supabase. Design: `docs/superpowers/specs/2026-10-15-accounts-design.md`.
Dormant unless `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` were set at build.

## Projects
| Project | Region | Used by |
|---|---|---|
| `provenance-dev` | London (`eu-west-2`) | `npm run dev`, the preview box, scripts, e2e |
| `provenance` | London (`eu-west-2`) | production only |

## Settings (both projects)
- Email provider on, Confirm email on, minimum password length 10.
- Site URL and redirect URLs: see the list in `docs/superpowers/plans/2026-10-15-accounts.md`, Task 0.
- Custom SMTP: Brevo, `smtp-relay.brevo.com:587`, user = the login on Brevo's SMTP & API page,
  password = one SMTP key per project (`supabase-dev`, `supabase-prod`), sender
  `Provenance <accounts@mail.provenance-online.com>`. The Brevo domain is the subdomain
  `mail.provenance-online.com`. Another feature that sends mail gets its own subdomain and its own key.
- Brevo, Settings → Transactional emails: Tracking "Anonymous email tracking" Yes; Retention rules: logs
  1 month, "Never store previews". Brevo always rewrites links to count clicks (switching that off needs
  its Enterprise plan), so the confirm and reset links pass through Brevo. `/privacy` will say so from launch (M5).
- Confirm email and Confirm phone are both on (`mailer_autoconfirm` and `sms_autoconfirm` are both false, checked 2026-10-15 in both projects). Keep both confirmations on. Supabase then answers a sign-up for a known address like one for a new address. If either one auto-confirms, Supabase answers a known address with "User already registered".
- Email rate limit: 30 an hour (Authentication → Rate Limits). Email links expire after 1 hour.
- The Brevo keys have no fixed expiry, but Brevo expires any SMTP key that sends nothing for 90 days.
  Production sends nothing until launch, so if M5 ships after 2027-01-13, generate a new
  `supabase-prod` key first and paste it into the production project's SMTP password.
- Email templates: paste `supabase/templates/confirm.html` into "Confirm signup" and
  `supabase/templates/recovery.html` into "Reset password" (the files arrive in M2). Subjects: "Confirm your Provenance account",
  "Reset your Provenance password".

## Schema
`supabase/migrations/`. Apply each new file to dev, run the RLS check, then apply to production.
Never edit a migration that production has run; add a new one.

    ACCOUNTS_RLS_TARGET=dev node --env-file=.env.local scripts/check-account-rls.mjs

The RLS check needs the DEV project's three values in `.env.local`, including `SUPABASE_SECRET_KEY`. Production keys never go in `.env.local`.

Applied: dev on 2026-10-15 (Management API, begin and commit; sha256 `9c36b979…aae0d7`; RLS check: 41 of 41 passed). Production: not yet. It gets the file at launch (M5), wrapped in begin and commit. Record the date and the file's sha256 here. An apply through the SQL editor or the Management API writes no row in `supabase_migrations.schema_migrations`, so never run `supabase db push` against a project that got the file that way.

## Keys
| Name | Build (GitHub variable) | Box `.env` |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | yes |
| `SUPABASE_SECRET_KEY` | **never** | yes |

## Operations
- The Free plan pauses a project after 7 days with no API calls. Resume it in the dashboard.
- Brevo's free plan sends 300 emails a day. A sign-up burst can use them up. Sent mail: Brevo,
  Transactional → Logs (kept 1 month).
- To delete an account by hand: Authentication, Users, the user, Delete. The cascade removes every row.
- Retention queries: `docs/analytics/accounts-retention.md` (arrives in M4).
- A user created without `username` metadata (for example with `auth.admin.createUser`) gets a placeholder name that starts with `u_`. The trigger never refuses a sign-up because of the name, so the trigger cannot tell a prober which addresses have an account.
