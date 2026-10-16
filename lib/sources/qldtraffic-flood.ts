import type { Camera, Source } from "@/lib/types";
import { FrameProber } from "@/lib/sources/feedKit";
import { QLD_LICENSE, fetchQld } from "@/lib/sources/qldtraffic";

// Queensland flood cameras, QLDTraffic's second file. A separate feed from the
// traffic cameras so each keeps its own last-good; the shape, the liveness rule and
// the licence are the same, see ./qldtraffic.ts. Some flood-camera images come from
// a council, and that council is named in the camera's attribution.

export const QLDTRAFFIC_FLOOD_SOURCE: Source = {
  id: "qldtraffic-flood",
  name: "QLDTraffic flood cameras (Queensland)",
  license: QLD_LICENSE,
  attribution: "Flood-camera images via QLDTraffic, State of Queensland (Department of Transport and Main Roads)",
  refreshSeconds: 300,
  needsKey: false,
};

const prober = new FrameProber({ revisitMs: 15 * 60_000, concurrency: 8, waitMs: 2_500 });

export async function fetchRegistry(): Promise<Camera[]> {
  return fetchQld(
    "qldtraffic-flood",
    "https://data.qldtraffic.qld.gov.au/floodcameras.geojson",
    QLDTRAFFIC_FLOOD_SOURCE,
    prober,
  );
}
