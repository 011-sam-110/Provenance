import { getRegistry } from "@/lib/sources/registry";
import { camerasBody, camerasCacheHeaders } from "@/lib/cameras/body";
import { ensurePlayCheck } from "@/lib/liveness/playcheck.server";

export const dynamic = "force-dynamic";

// A route module may export ONLY the fields Next recognises, so `camerasBody` and its
// test seam live in lib/cameras/body.ts, where the reasoning for the memo is written up.

export async function GET() {
  const cams = await getRegistry();
  // Starts the play check once per process (and loads its saved results first), so the
  // `live` flags in this body come from it. See lib/liveness/playcheck.server.ts.
  ensurePlayCheck(getRegistry);
  // `Response.json` is not used only because the body is already a string; it sets
  // exactly this Content-Type, so the response is unchanged on the wire.
  return new Response(camerasBody(cams), {
    headers: {
      "Content-Type": "application/json",
      ...camerasCacheHeaders(),
    },
  });
}
