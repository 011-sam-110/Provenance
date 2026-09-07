import { count, heartbeat } from "@/lib/presence/store";

// GET  /api/presence — how many visitors are on the site right now, or null.
// POST /api/presence — "I am still here", from an open tab.
//
// Both are `force-dynamic` and must stay that way: a cached presence count is a
// contradiction in terms, and Next will happily serve one otherwise. See also the
// no-store header below — `dynamic` governs Next's own cache, the header governs
// every CDN and browser between here and the reader.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It reads no IP, no user agent, no route and
// no cookie, and it writes nothing to disk. The whole record of a visitor is a
// random token their own browser made up for the tab session plus the time it
// last spoke, held in memory, evicted three minutes later. See lib/presence/store.ts
// for why that is the entire design rather than a first version of one.
export const dynamic = "force-dynamic";

/** No cache, anywhere, at any layer. */
const HEADERS = { "cache-control": "no-store, max-age=0" } as const;

export async function GET() {
  // `online: null` is the honest answer below the threshold, and the route cannot
  // tell the caller which side of it a small number sits on — `count()` has
  // already discarded it. A client that wants to render "nobody here" and a
  // client that wants to render "23 here" get the same response, because the
  // second one is not a thing this endpoint is willing to say.
  return Response.json({ online: count() }, { headers: HEADERS });
}

export async function POST(req: Request) {
  let id: unknown;
  try {
    ({ id } = (await req.json()) as { id?: unknown });
  } catch {
    // A malformed body is a client bug, not an upstream failure, so it is worth
    // saying so rather than resolving to a silent no-op the way an upstream
    // adapter would.
    return Response.json({ ok: false, reason: "expected a JSON body" }, { status: 400, headers: HEADERS });
  }

  if (typeof id !== "string" || !heartbeat(id)) {
    return Response.json(
      { ok: false, reason: "id must be 8-64 characters of [A-Za-z0-9_-]" },
      { status: 400, headers: HEADERS },
    );
  }

  // The heartbeat response carries the count too, so an open tab needs ONE
  // request per interval rather than a POST and a GET. That halves the request
  // count on the box for free, and matters because this is the only endpoint in
  // the app that every open tab hits on a timer.
  return Response.json({ ok: true, online: count() }, { headers: HEADERS });
}
