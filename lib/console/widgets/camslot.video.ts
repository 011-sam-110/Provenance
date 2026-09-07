import type { StreamRef } from "@/lib/console/widgets/camslot.model";

/**
 * Whether a tile should mount the HLS player rather than a refreshing image.
 *
 * Pure and injectable, so the rule is testable in node and the component does not
 * grow a second copy of it.
 *
 * ONLY road cameras qualify. A Windy webcam has no stream behind it at all — the
 * catalogue serves still images — and a YouTube ref is an iframe the widget
 * already renders its own way. `live` is the caller's lookup into
 * `loadedCamerasStore`, whose `live` flag `lib/cameras/body.ts` sets from
 * `isLiveStreamUrl`: true means /api/hls can actually serve it, not merely that
 * the upstream advertised a video mediaType. TfL JamCams advertise MP4 clips and
 * are correctly false here.
 *
 * FALSE IS THE SAFE ANSWER and is what an unknown id gets. A wrong false shows a
 * still where video was possible; a wrong true mounts a player against a URL that
 * cannot serve it and shows a broken tile.
 */
export function playsVideo(ref: StreamRef, live: (id: string) => boolean): boolean {
  return ref.k === "cam" && live(ref.id);
}
