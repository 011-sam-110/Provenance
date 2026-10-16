import { fetchAircraftInfo, type FlightEnrichment } from "@/lib/sources/adsbdb";
import { fetchVrsRoute } from "@/lib/sources/vrsRoutes";

export const dynamic = "force-dynamic";

/**
 * GET /api/flight?callsign=BAW117&hex=A835AF — server-side enrichment for one
 * flight: the route from Virtual Radar Server's CC0 standing data
 * (lib/sources/vrsRoutes.ts), the airframe from adsbdb. The client calls neither
 * upstream (no CORS), and both are cached in memory. Either param is optional; missing/unknown ids resolve to null
 * so the dossier degrades gracefully. Never throws (dormant-safe).
 *
 * Response: { route: FlightRoute | null, aircraft: AircraftInfo | null }
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const callsign = searchParams.get("callsign")?.trim() ?? "";
  const hex = searchParams.get("hex")?.trim() ?? "";

  const [route, aircraft] = await Promise.all([
    callsign ? fetchVrsRoute(callsign) : Promise.resolve(null),
    hex ? fetchAircraftInfo(hex) : Promise.resolve(null),
  ]);

  const body: FlightEnrichment = { route, aircraft };
  return Response.json(body);
}
