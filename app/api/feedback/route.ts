// Relay for the in-console feedback prompt: one validated response, forwarded to
// Sam's own Telegram. Mirrors app/api/telegram/route.ts in shape, and deliberately
// DIVERGES from it in one place — see "the credential oracle" below.
//
// THIS ROUTE IS NOT THE SAME RISK AS /api/telegram. That one relays the CALLER'S
// own bot token out of the request body, so the worst case is that someone spams
// themselves. This one spends the SITE OWNER'S token from the environment, which
// makes it an unauthenticated write path into a personal Telegram chat. The
// controls below are the load-bearing part of this file, not decoration.
//
// Dormant-safe, like every other route here: failures resolve to { ok: false } with
// a 200, never a 5xx, and the route is inert when its env vars are unset.

import {
  CAP_BODY_BYTES,
  formatFeedbackMessage,
  validateFeedback,
} from "@/lib/shell/feedback";

export const runtime = "nodejs";

/** Every failure the caller can see. One string for every upstream outcome — see
 *  the oracle note below. */
const GENERIC_FAILURE = "Could not send that just now.";
const OK = { ok: true } as const;

function fail(error: string): Response {
  return Response.json({ ok: false, error }, { status: 200 });
}

/* ── Rate limit ───────────────────────────────────────────────────────────
 * IN-MEMORY AND THEREFORE BEST-EFFORT, stated plainly rather than implied. Fluid
 * Compute instances are ephemeral and plural, so this counter is per-instance and
 * a determined flood spread across cold starts will get past it. It is a speed
 * bump. The real protection is the size cap + strict validation below, which are
 * deterministic and hold on every instance.
 *
 * This is the first inbound rate limit in this repo — there is no house helper to
 * reuse, which is why it is inline rather than imported.
 */
const WINDOW_MS = 60 * 60_000;
const MAX_PER_WINDOW = 3;
const hits = new Map<string, number[]>();

function rateLimited(key: string, now: number): boolean {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  // Unbounded growth would be a slow leak on a long-lived instance.
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return false;
}

/** A coarse, non-reversible bucket key. The address itself is never stored, never
 *  sent on, and never logged. */
async function bucketKey(req: Request): Promise<string> {
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  const bytes = new TextEncoder().encode(`feedback:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest).slice(0, 8))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Same-origin only. The prompt is served from this site; nothing else has any
 *  business posting here. A missing Origin is rejected rather than waved through —
 *  browsers send it on cross-origin POSTs, and a caller without one is not the
 *  console. */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request): Promise<Response> {
  const botToken = process.env.FEEDBACK_TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.FEEDBACK_TELEGRAM_CHAT_ID?.trim();
  // Dormant without secrets. The prompt does not mount when the feature is off, so
  // reaching here at all means a direct caller.
  if (!botToken || !chatId) return fail(GENERIC_FAILURE);

  if (!sameOrigin(req)) return fail(GENERIC_FAILURE);

  // Size is checked BEFORE the body is read and before any outbound call, so a junk
  // flood costs a header read rather than an upstream request. Content-Length is a
  // claim, so the decoded body is measured again below.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > CAP_BODY_BYTES) return fail(GENERIC_FAILURE);

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return fail(GENERIC_FAILURE);
  }
  if (new TextEncoder().encode(raw).length > CAP_BODY_BYTES) return fail(GENERIC_FAILURE);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail(GENERIC_FAILURE);
  }

  const checked = validateFeedback(parsed);
  if (!checked.ok) return fail(checked.error);

  if (rateLimited(await bucketKey(req), Date.now())) return fail(GENERIC_FAILURE);

  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: formatFeedbackMessage(checked.value),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });

    /* ── THE CREDENTIAL ORACLE, and why this route does not copy its sibling ──
     * app/api/telegram/route.ts ends with `error: j?.description`, handing
     * Telegram's own error text back to the caller. That is correct THERE: the
     * caller supplied the credential, so the failure is about their own bot.
     *
     * Here it would leak. An anonymous caller who can tell "Unauthorized" from
     * "chat not found" from success learns whether the owner's token is live and
     * whether the chat id resolves — and this repo is public, so they can read
     * this file and know exactly what each response means. So every upstream
     * outcome collapses to one string, and the real reason is neither returned
     * nor logged. The token-bearing URL above is never logged either.
     */
    if (!r.ok) return fail(GENERIC_FAILURE);
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean };
    if (j?.ok === false) return fail(GENERIC_FAILURE);
    return Response.json(OK);
  } catch {
    return fail(GENERIC_FAILURE);
  }
}
