import { NextResponse, type NextRequest } from "next/server";
import {
  gateToken,
  constantTimeEqual,
  safeNext,
  withDenied,
  gateCookieHeader,
} from "@/lib/gate/token";

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

  if (expected === "" || !(await constantTimeEqual(presented, expected))) {
    return NextResponse.redirect(new URL(withDenied(next), request.url), { status: 303 });
  }

  // 303 so the browser reissues the request as a GET; a 307 would repost the form.
  const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
  response.headers.set(
    "set-cookie",
    gateCookieHeader(await gateToken(expected), request.nextUrl.protocol === "https:"),
  );
  return response;
}
