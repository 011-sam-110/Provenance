/**
 * What the media proxy last SAW for a camera: the operator's "unavailable" card, or
 * a picture.
 *
 * Some operators answer a dead camera with HTTP 200 and a stock card, and say nothing
 * about it in their camera list. Traffic Scotland is the measured case: on
 * 2026-10-16, 10 of 50 sampled cameras served one byte-identical "Currently
 * Unavailable" JPEG while the list carried no status at all. Fetching 415 HTML pages
 * per refresh just to look would cost the operator far more than the map is worth to
 * it, so nothing is fetched for this. The proxy already holds the bytes when someone
 * opens a camera; it records what it saw here, and the adapter reads it on the next
 * refresh.
 *
 * In-process memory, like the registry's own last-good map: it survives between
 * refreshes on one server and starts empty after a restart, which only means a card
 * is reported a little later. An entry expires, so a camera that comes back is not
 * held down by a card someone saw yesterday.
 */

/** How long one sighting of a card counts. Longer than any camera's refresh. */
export const PLACEHOLDER_MEMORY_MS = 2 * 60 * 60 * 1000;

const seen = new Map<string, { card: boolean; at: number }>();

/** Record what the proxy just served for camera `id`. */
export function notePlaceholder(id: string, card: boolean, now: number = Date.now()): void {
  seen.set(id, { card, at: now });
  if (seen.size > 20_000) {
    // A bound, not a policy: drop the oldest entries if this ever grows past every
    // camera on the map.
    const oldest = [...seen.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 5_000);
    for (const [k] of oldest) seen.delete(k);
  }
}

/** True when the last thing seen for `id`, recently enough, was the operator's card. */
export function showsPlaceholder(id: string, now: number = Date.now()): boolean {
  const s = seen.get(id);
  return !!s && s.card && now - s.at <= PLACEHOLDER_MEMORY_MS;
}

/** Test seam. */
export function resetPlaceholderMemo(): void {
  seen.clear();
}
