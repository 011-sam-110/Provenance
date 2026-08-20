import { NextResponse } from "next/server";
import { isProduction } from "@/lib/discovery/devOnly";
import { estateStats } from "@/lib/discovery/analytics";
import { getRegistry } from "@/lib/sources/registry";

/**
 * What the live camera estate is made of, right now, on this instance.
 *
 * DEV ONLY (404 in production).
 *
 * Reading it means the full registry refresh — fourteen upstream feeds, one of which
 * is measured at ~18.5s warm — which is why the overview page asks for this rather
 * than server-rendering it.
 */

export const dynamic = "force-dynamic";
// No maxDuration: see app/api/admin/discover/route.ts. A dev-only route has no
// production execution to bound, and an out-of-plan value fails the DEPLOY, not the
// build.

export async function GET() {
  if (isProduction()) {
    return new NextResponse(null, { status: 404 });
  }
  try {
    const cameras = await getRegistry();
    return NextResponse.json({ stats: estateStats(cameras) });
  } catch (e) {
    return NextResponse.json(
      { error: "The registry could not be read: " + (e instanceof Error ? e.message : String(e)) },
      { status: 502 },
    );
  }
}
