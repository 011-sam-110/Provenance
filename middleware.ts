import { NextResponse, type NextRequest } from "next/server";
import { isGatedPath } from "@/lib/gate/paths";
import { GATE_COOKIE, GATE_QUERY, GATE_DENIED, gateToken } from "@/lib/gate/token";
import { isTempKey, verifyTempKey } from "@/lib/gate/tempkey";
import { maintenanceHtml } from "@/lib/gate/page";

/**
 * The maintenance gate.
 *
 * Armed by `MAINTENANCE_MODE` on Vercel Production only, so previews are untouched and
 * stay behind Vercel Authentication as they already are. Disarmed, this function reads
 * one environment variable and passes through - that is the standing cost of having the
 * switch on `main` rather than on a branch, and it was chosen knowingly.
 *
 * The point of the gate is COST, not concealment. It answers before anything downstream
 * is invoked, so a gated request buys no React render, no ISR revalidation and no
 * upstream fetch. `docs/superpowers/specs/2026-09-07-maintenance-gate-design.md` has
 * the reasoning; `lib/gate/paths.ts` has the exemptions and why each one is exempt.
 *
 * THE MATCHER MUST EQUAL `gateMatcher()`. Next requires a string literal here, so it
 * cannot be imported. `tests/unit/gate.test.ts` derives it from `GATE_EXEMPT_STARTS`
 * and fails if the two drift apart - which is the only thing that stops an exemption
 * added to the list from still costing an invocation on every request.
 */
export const config = {
  matcher: "/((?!api/gate|_next/|_vercel/|\\.well-known/|sw\\.js|manifest\\.webmanifest|robots\\.txt|favicon|icons/|brand/).*)",
};

export default async function middleware(request: NextRequest) {
  if (!process.env.MAINTENANCE_MODE) return NextResponse.next();

  const { pathname, search, searchParams } = request.nextUrl;
  // The matcher has already excluded the exempt paths; this is the same list applied a
  // second time, because the matcher is a copy and copies drift.
  if (!isGatedPath(pathname)) return NextResponse.next();

  const code = process.env.MAINTENANCE_PASSWORD ?? "";
  const presented = request.cookies.get(GATE_COOKIE)?.value;
  if (code && presented) {
    // A TEMPORARY KEY re-checks its own expiry here, on every request. Max-Age asked
    // the browser to drop the cookie; this is what actually stops it, so a browser
    // that ignored the request, or a cookie copied to another machine, still expires
    // on time. The shape check comes first so the permanent path never pays for an
    // HMAC it was not going to match, and vice versa.
    if (isTempKey(presented)) {
      const verdict = await verifyTempKey(code, presented, Math.floor(Date.now() / 1000));
      if (verdict.ok) return NextResponse.next();
    } else if (presented === (await gateToken(code))) {
      return NextResponse.next();
    }
  }

  return new NextResponse(
    maintenanceHtml({
      next: pathname + search,
      denied: searchParams.get(GATE_QUERY) === GATE_DENIED,
      // Fail CLOSED. Failing open would leave the site up and billing, which is the
      // one failure this exists to prevent. Recovery is to set the variable and deploy.
      unconfigured: code === "",
    }),
    {
      status: 503,
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Load bearing. The CDN keys on URL, not on the cookie, so a cached 503 would
        // be replayed to everyone - including an unlocked browser, which looks exactly
        // like being locked out of your own site.
        "cache-control": "no-store",
        // Tells a crawler the absence is temporary, so the camera pages keep their
        // place in the index. This is the whole reason the status is 503 and not 200.
        "retry-after": "3600",
      },
    },
  );
}
