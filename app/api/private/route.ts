import { NextResponse, type NextRequest } from "next/server";
import { constantTimeEqual, safeNext, withDenied } from "@/lib/gate/token";
import {
  isPrivatePath,
  privateClearCookieHeader,
  privateCookieHeader,
  privateToken,
  readPrivateConfig,
} from "@/lib/gate/private";

/**
 * The one door into the private endpoint.
 *
 * `lib/gate/paths.ts` exempts this path and the middleware matcher excludes it, for
 * the same reason `/api/gate` is exempt: a form gated by the gate it opens is a
 * locked door with the key inside.
 *
 * It answers 404 when no private endpoint is configured, matching `/api/gate` and
 * `/admin`. A password endpoint standing on a deployment that has no password is a
 * target and nothing else, and every preview build and every fork is in exactly that
 * state.
 *
 * NO RATE LIMITING HERE, deliberately, and the same reasoning as the maintenance
 * door: a middleware-shaped limiter would cost a function invocation to say no. What
 * carries the weight instead is that the PATH is the first factor — an attacker has
 * to know a 16-character secret slug before this handler is worth submitting to, and
 * `readPrivateConfig` refuses to configure anything shorter. If this ever needs real
 * resistance, the place for it is a Vercel Firewall rule on this path.
 */
export async function POST(request: NextRequest) {
  const config = readPrivateConfig(process.env);
  if (!config) return new NextResponse(null, { status: 404 });

  const form = await request.formData();
  // safeNext refuses anything that is not a same-origin path, so this redirect cannot
  // be aimed off-site by anyone who gets someone else to submit the form.
  const requested = safeNext(form.get("next"));
  // AND it must land back INSIDE the endpoint. safeNext alone would happily send a
  // successful unlock to `/` — which works, but hands out a private-session cookie on
  // a journey that ends on the public site, so the person sees no difference and
  // cannot tell whether the password worked. Anything outside goes to the slug root.
  const next = isPrivatePath(new URL(requested, "http://gate.invalid").pathname, config.slug)
    ? requested
    : `/${config.slug}`;

  const presented = typeof form.get("password") === "string" ? String(form.get("password")) : "";
  const secure = request.nextUrl.protocol === "https:";

  if (await constantTimeEqual(presented, config.password)) {
    // 303 so the browser reissues as a GET; a 307 would repost the form.
    const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
    response.headers.set("set-cookie", privateCookieHeader(await privateToken(config.password), secure));
    return response;
  }

  const refused = NextResponse.redirect(new URL(withDenied(next), request.url), { status: 303 });
  // CLEAR ON REFUSAL. After the password is rotated, every browser holding the old
  // cookie sends it, is refused at the edge, and would otherwise keep sending it
  // forever — the form would appear to accept the new password and then bounce,
  // because the stale cookie is still the one being read. Clearing here means one
  // failed attempt is enough to get back to a clean state.
  refused.headers.set("set-cookie", privateClearCookieHeader(secure));
  return refused;
}
