import type { Camera } from "@/lib/types";
import { fetchMy511, type My511System } from "@/lib/sources/my511";

// Manitoba 511 (Manitoba Transportation and Infrastructure), through the keyed My511 developer API.
// 46 camera sites on the public list on 2026-10-16. Licence: the OpenMB Information and Data Use Licence, stated on the developer page.
// Dormant until MANITOBA_511_KEY is set. The client, the shape and the liveness rule are in
// ./my511.ts.

export const MY511_MB_SYSTEM: My511System = {
  key: "my511-mb",
  host: "www.manitoba511.ca",
  env: "MANITOBA_511_KEY",
  country: "CA",
  region: "Manitoba",
  source: {
    id: "my511-mb",
    name: "Manitoba 511 (Manitoba Transportation and Infrastructure)",
    license: "OpenMB Information and Data Use Licence (Manitoba)",
    attribution: "Highway-camera images © Government of Manitoba (Manitoba 511)",
    refreshSeconds: 300,
    needsKey: true,
  },
};

export async function fetchRegistry(): Promise<Camera[]> {
  return fetchMy511(MY511_MB_SYSTEM);
}
