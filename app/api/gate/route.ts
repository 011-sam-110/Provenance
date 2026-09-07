import { NextResponse, type NextRequest } from "next/server";
import {
  gateToken,
  constantTimeEqual,
  safeNext,
  withDenied,
  gateCookieHeader,
} from "@/lib/gate/token";
import { verifyTempKey } from "@/lib/gate/tempkey";

/**
 * The one door through the maintenance curtain.
 *
 * `lib/gate/paths.ts` exempts this path, so the middleware never runs for it - if it
 * did, the form would be gated by the gate it is trying to open.
 *
 * It answers 404 when the gate is not armed, matching how `/admin` and `/api/admin`
 * disappear in production rather than announcing themselves. A password endpoint that
 * exists on a site with no password is a target and nothing else.
 *
 * TEMPORARY KEYS come through this same door. A key is minted offline by
 * `scripts/mint-gate-key.mjs`, carries its own expiry and is signed with the master
 * code, so verifying one needs no storage. Presenting one buys a cookie that lasts
 * exactly as long as the key has left. See lib/gate/tempkey.ts.
 *
 * There is no rate limiting here, so the access code must be long. Six digits is 10^6,
 * exposed for a month; a script walks that while nobody is watching. If the gate ever
 * needs real resistance the place for it is a Vercel Firewall rule on this path, not
 * this handler - a middleware-shaped limiter would cost an invocation to say no.
 */
export async function POST(request: NextRequest) {
  if (!process.env.MAINTENANCE_MODE) {
    return new NextResponse(null, { status: 404 });
  }

  const form = await request.formData();
  // `safeNext` refuses anything that is not a same-origin path, so the redirect cannot
  // be aimed off-site by anyone who can get someone to submit this form.
  const next = safeNext(form.get("next"));
  const presented = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const expected = process.env.MAINTENANCE_PASSWORD ?? "";

  if (expected === "") {
    return NextResponse.redirect(new URL(withDenied(next), request.url), { status: 303 });
  }

  const secure = request.nextUrl.protocol === "https:";

  // The master code: a full thirty-day session, as before.
  if (await constantTimeEqual(presented, expected)) {
    // 303 so the browser reissues the request as a GET; a 307 would repost the form.
    const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
    response.headers.set("set-cookie", gateCookieHeader(await gateToken(expected), secure));
    return response;
  }

  // A TEMPORARY KEY. The cookie's lifetime is the key's REMAINING life, not the
  // permanent one — issuing the thirty-day cookie here would turn a thirty-minute key
  // into a permanent one, and nothing would look wrong while it happened.
  //
  // The cookie's value is the signed key itself rather than a digest of it, so the
  // expiry is re-checked at the edge on every request. Max-Age asks the browser to drop
  // it; the signature is what actually stops it.
  const temp = await verifyTempKey(expected, presented, Math.floor(Date.now() / 1000));
  if (temp.ok) {
    const remaining = temp.expiresAt - Math.floor(Date.now() / 1000);
    const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
    response.headers.set("set-cookie", gateCookieHeader(presented, secure, remaining));
    return response;
  }

  return NextResponse.redirect(new URL(withDenied(next), request.url), { status: 303 });
}
