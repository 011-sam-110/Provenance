import { edgeCacheHeaders } from "@/lib/http/cache";
import { getInviteStatus, inviteTtlMs } from "@/lib/community/invite";

// GET /api/community: is the Discord invite alive, and how many members and people online
// does Discord report for the server. The Discord pop-up asks once, just before it opens.
//
// IT TAKES NO INPUT AND READS NOTHING FROM THE REQUEST. The handler has no parameter, so no
// IP address, cookie, header or query can reach it, and the request to Discord carries the
// invite code and this project's name and nothing about the visitor. See lib/community/invite.ts.
//
// THE ONE /api CALL THE LANDING PAGE MAY MAKE. `/` makes none on load, and that still holds:
// this one comes after 15 seconds of visible time, at most once per browser, and the shared
// cache answers it. The header's lifetime is the same as the server's own copy.
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getInviteStatus();
  return Response.json(status, { headers: edgeCacheHeaders(inviteTtlMs(status)) });
}
