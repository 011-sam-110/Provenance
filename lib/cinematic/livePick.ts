// lib/cinematic/livePick.ts
// Pick a currently-live camera for the palette's "Dive to a live feed" showcase (SP6).
// Deterministic — first available && live in input order, so it is unit-testable
// and the showcase is reproducible. Generic so it works on the loaded-camera
// store records without importing them.

export function pickLiveCamera<T extends { available: boolean; live: boolean }>(
  cams: readonly T[],
): T | null {
  for (const cam of cams) {
    if (cam.available && cam.live) return cam;
  }
  return null;
}
