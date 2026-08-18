import { getRegistry } from "@/lib/sources/registry";
import { camerasBody, camerasCacheControl } from "@/lib/cameras/body";

export const dynamic = "force-dynamic";

// A route module may export ONLY the fields Next recognises, so `camerasBody` and its
// test seam live in lib/cameras/body.ts, where the reasoning for the memo is written up.

export async function GET() {
  // `Response.json` is not used only because the body is already a string; it sets
  // exactly this Content-Type, so the response is unchanged on the wire.
  return new Response(camerasBody(await getRegistry()), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": camerasCacheControl(),
    },
  });
}
