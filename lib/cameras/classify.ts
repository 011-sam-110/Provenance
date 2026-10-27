// Classify a camera by what it streams. Two icon shapes:
//   • "video" — a stream our /api/hls proxy can play, which played at its last
//               check (lib/liveness/playcheck.ts)
//   • "still" — a refreshing JPEG snapshot
// The icon's COLOUR encodes the region (see lib/icons/svg.ts), so the two
// dimensions together (shape = feed, colour = region) give a maximal camera
// taxonomy.
//
// IMPORTANT: "video" is keyed on whether we can play a LIVE stream, not just on
// the raw mediaType. TfL JamCams advertise short MP4 clips (mediaType "both")
// but we present them as refreshing stills, so they read as "still" here.
// Caltrans/SCDOT expose live HLS, so they read as "video". Pure + unit-tested.

export type CameraFeed = "video" | "still";

/** Feed shape from whether a live (HLS-proxyable) stream is available. */
export function cameraFeed(live: boolean): CameraFeed {
  return live ? "video" : "still";
}
