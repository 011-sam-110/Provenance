import type { Camera } from "@/lib/types";
import { fetchMy511, type My511System } from "@/lib/sources/my511";

// 511 Newfoundland and Labrador (Government of Newfoundland and Labrador), through the keyed My511 developer API.
// 48 camera sites on the public list on 2026-10-16. Licence: none is stated (the /terms page has no re-use clause).
// Dormant until NL_511_KEY is set. The client, the shape and the liveness rule are in
// ./my511.ts.

export const MY511_NL_SYSTEM: My511System = {
  key: "my511-nl",
  host: "511nl.ca",
  env: "NL_511_KEY",
  country: "CA",
  region: "Newfoundland and Labrador",
  source: {
    id: "my511-nl",
    name: "511 Newfoundland and Labrador (Government of Newfoundland and Labrador)",
    license: "Government of Newfoundland and Labrador (511 NL) — no stated licence",
    attribution: "Highway-camera images © Government of Newfoundland and Labrador (511 NL)",
    refreshSeconds: 300,
    needsKey: true,
  },
};

export async function fetchRegistry(): Promise<Camera[]> {
  return fetchMy511(MY511_NL_SYSTEM);
}
