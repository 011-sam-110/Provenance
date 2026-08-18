import { getWebcams } from "@/lib/webcams/registry";
import { webcamsBody, webcamsCacheControl } from "@/lib/webcams/body";

export const dynamic = "force-dynamic";

// A route module may export ONLY the fields Next recognises; `webcamsBody` and its
// test seam therefore live in lib/webcams/body.ts, where the reasoning is written up.
// That file also carries the route documentation - what this endpoint returns, why the
// coverage record is shaped the way it is, and why no image URL ever leaves here.

export async function GET() {
  // `Response.json` is not used only because the body is already a string; it sets
  // exactly this Content-Type, so the response is unchanged on the wire.
  return new Response(webcamsBody(await getWebcams()), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": webcamsCacheControl(),
    },
  });
}
