import { NextResponse, type NextRequest } from "next/server";
import { isGatedPath } from "@/lib/gate/paths";
import { GATE_COOKIE, GATE_QUERY, GATE_DENIED, gateToken } from "@/lib/gate/token";
import { isTempKey, verifyTempKey } from "@/lib/gate/tempkey";
import { maintenanceHtml } from "@/lib/gate/page";
import { isMaintenanceArmed } from "@/lib/gate/armed";
import { legacyRedirect } from "@/lib/brand.legacy";
import {
  PRIVATE_COOKIE,
  isPrivatePath,
  privateToken,
  readPrivateConfig,
} from "@/lib/gate/private";
import { privateUnlockHtml } from "@/lib/gate/private.page";

/** The board the private endpoint opens on. The endpoint exists to show this work;
 *  a visitor arriving at a secret URL should not have to find it in a menu. */
const PRIVATE_PRESET_ID = "streets";

/**
 * The maintenance gate.
 *
 * Armed by `MAINTENANCE_MODE`, which is now a line in the box's EnvironmentFile rather
 * than a row in a Vercel dashboard - see lib/gate/armed.ts, which exists entirely
 * because those two are edited with different gestures and `=0` means opposite things
 * in them. The preview box is untouched simply by not carrying the variable. Disarmed,
 * this function reads one environment variable and passes through - that is the standing
 * cost of having the switch on `main` rather than on a branch, and it was chosen
 * knowingly.
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
  // THE LEGACY-HOST REDIRECT RUNS FIRST, AND THAT ORDER IS THE POINT.
  //
  // The obvious home for this is `redirects()` in next.config.ts, where it would cost no
  // function invocation at all. It cannot go there: middleware runs BEFORE the routing
  // layer applies those rules, so while MAINTENANCE_MODE is armed on the Vercel project
  // the curtain would answer every request and the redirect would never fire. The old
  // host would sit on 503 while search engines decided it was dead — losing exactly the
  // ranking this redirect exists to move.
  //
  // Above the gate, it wins regardless of the curtain, and the old host consolidates
  // into the new one whether or not anyone remembers to unset a variable.
  const moved = legacyRedirect(request.headers.get("host"), request.nextUrl.pathname + request.nextUrl.search);
  // 301 and not 308: this is GET traffic from crawlers and shared links, and 301 is the
  // status every search engine treats as "move the ranking".
  if (moved) return NextResponse.redirect(moved, 301);

  const { pathname, search, searchParams } = request.nextUrl;

  // THE MAINTENANCE CURTAIN RUNS FIRST AND FULLY, and unlocking it does NOT fall
  // through to the private endpoint being unlocked too. When the site is down it is
  // down for everyone including the private path; when someone opens the curtain with
  // the maintenance code, execution continues to the private check below rather than
  // returning, so their maintenance session buys them the public site and nothing
  // more. Two audiences, two secrets, two cookies — see lib/gate/private.ts.
  if (isMaintenanceArmed() && isGatedPath(pathname)) {
    // The matcher has already excluded the exempt paths; isGatedPath is the same list
    // applied a second time, because the matcher is a copy and copies drift.
    const curtain = await maintenanceCurtain(request, pathname, search, searchParams);
    if (curtain) return curtain;
  }

  // THE PRIVATE ENDPOINT. Absent configuration this is one env read and a miss, which
  // is the standing cost of the switch living on `main`, chosen the same way the
  // maintenance switch was.
  const priv = readPrivateConfig(process.env);
  if (priv && isPrivatePath(pathname, priv.slug)) {
    const presentedPriv = request.cookies.get(PRIVATE_COOKIE)?.value;
    const expected = await privateToken(priv.password);
    if (presentedPriv === expected) {
      // THE PRESET GOES ON THE PRIVATE URL, NOT ONLY ON THE REWRITE TARGET, and that
      // is forced by a constraint worth restating. A rewrite is invisible to the
      // browser, so `?preset=` added only to the /app target never reaches
      // ConsoleShell, which reads `window.location.search` — measured: the endpoint
      // unlocked correctly and then opened on the default globe. The obvious fix is
      // for app/(console)/app/page.tsx to take `searchParams` and pass it down, and
      // that file opens by forbidding exactly that: taking searchParams makes the
      // route dynamic for EVERY request, which cost ~150 uncached function
      // invocations a day the last time it happened, and tests/unit/console-static.
      // test.ts pins it. So the parameter is put where the client can actually see
      // it — on the private path itself — with one redirect on first arrival.
      //
      // It cannot loop: the redirect only fires when neither parameter is present,
      // and it adds one. `?c=` is a complete saved layout and outranks a preset by
      // design, so a shared board opened inside the endpoint is left alone.
      const sp = request.nextUrl.searchParams;
      if (!sp.has("preset") && !sp.has("c")) {
        const seeded = new URL(request.url);
        seeded.searchParams.set("preset", PRIVATE_PRESET_ID);
        const bounce = NextResponse.redirect(seeded, 307);
        bounce.headers.set("cache-control", "no-store");
        bounce.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
        return bounce;
      }

      // Serve the console. The secret slug never reaches the app: this is a rewrite,
      // not a redirect, so the address bar keeps the private URL while Next renders
      // /app — which also means the slug is never handed to client code that might
      // log it or put it into a share link.
      const target = new URL("/app", request.url);
      for (const [k, v] of sp) target.searchParams.set(k, v);
      const passed = NextResponse.rewrite(target);
      // The URL is the secret. A shared CDN cache keyed on it would be a copy of an
      // unreleased page sitting on an edge node, and `noindex` covers the case where
      // the link reaches a crawler through a referrer header or a pasted chat message.
      passed.headers.set("cache-control", "no-store");
      passed.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      return passed;
    }

    return new NextResponse(
      privateUnlockHtml({
        next: pathname + search,
        denied: searchParams.get(GATE_QUERY) === GATE_DENIED,
      }),
      {
        // 401, not 503: this is not an outage and not temporary. The path answers at
        // all only because the slug was already known, so there is nothing left to
        // conceal by pretending otherwise.
        status: 401,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      },
    );
  }

  return NextResponse.next();
}

/**
 * The maintenance curtain, or null when this request may continue.
 *
 * Split out of the middleware body when the private endpoint arrived, so that "the
 * curtain is open" and "the request is finished" stopped being the same statement.
 * Returning null means only that the curtain does not stop this request.
 */
async function maintenanceCurtain(
  request: NextRequest,
  pathname: string,
  search: string,
  searchParams: URLSearchParams,
): Promise<NextResponse | null> {
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
      if (verdict.ok) return null;
    } else if (presented === (await gateToken(code))) {
      return null;
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
