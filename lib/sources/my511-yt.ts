import type { Camera } from "@/lib/types";
import { fetchMy511, type My511System } from "@/lib/sources/my511";

// 511 Yukon (Government of Yukon, Highways and Public Works), through the keyed My511 developer API.
// 15 camera sites on 2026-10-16. These are hourly road-weather cameras, so the refresh is 15 minutes. Licence: none is stated (only a disclaimer).
// Dormant until YUKON_511_KEY is set. The client, the shape and the liveness rule are in
// ./my511.ts.

export const MY511_YT_SYSTEM: My511System = {
  key: "my511-yt",
  host: "511yukon.ca",
  env: "YUKON_511_KEY",
  country: "CA",
  region: "Yukon",
  source: {
    id: "my511-yt",
    name: "511 Yukon (Government of Yukon, Highways and Public Works)",
    license: "Government of Yukon (511 Yukon) — no stated licence",
    attribution: "Highway-camera images © Government of Yukon (511 Yukon)",
    refreshSeconds: 900,
    needsKey: true,
  },
};

export async function fetchRegistry(): Promise<Camera[]> {
  return fetchMy511(MY511_YT_SYSTEM);
}
