/**
 * HLS playlist facts, and the only question that matters about them: is this stream
 * ALIVE right now?
 *
 * WHY THIS IS NOT A ONE-LINE CHECK. This project has already learned, twice, that an
 * upstream answering HTTP 200 is not an upstream serving anything — BIHAMK and ACT both
 * publish dead cameras as 200, which is why every still gets a Last-Modified age check.
 * Video has the same trap in three extra flavours:
 *
 *   1. A finished recording is a perfectly valid playlist. `#EXT-X-ENDLIST` is the only
 *      thing separating "a live camera" from "a saved clip of one".
 *   2. A stalled encoder keeps serving its last playlist forever. It parses, it has
 *      segments, and nothing about a single read distinguishes it from a healthy feed.
 *      Only a SECOND read, seconds later, can tell — which is why the verdict takes a
 *      pair rather than a body.
 *   3. A master playlist has no segments at all. Judged as a media playlist it looks
 *      like an empty stream, so it gets its own verdict telling the caller to follow a
 *      variant rather than a dead-or-alive answer it cannot honestly give.
 *
 * Every function here is pure. Fetching lives in scripts/, so these can be tested
 * against saved fixtures with no network — the same split lib/discovery already uses.
 */

export interface PlaylistFacts {
  /** Whether the body is an HLS playlist at all. A 403 HTML page is not. */
  isPlaylist: boolean;
  /** A master playlist lists variant renditions rather than segments. */
  isMaster: boolean;
  /** `#EXT-X-ENDLIST` — the stream has finished. A recording, not a live feed. */
  hasEndList: boolean;
  /** `#EXT-X-MEDIA-SEQUENCE`, or null when the tag is absent (which is legal). */
  mediaSequence: number | null;
  /** Segment URIs, in order, exactly as written. Empty for a master. */
  segmentUris: string[];
  /** Variant URIs, in order. Empty for a media playlist. */
  variantUris: string[];
  /** `#EXT-X-TARGETDURATION` in seconds — how long to wait before the second read. */
  targetDurationS: number | null;
}

const NUMBER_TAG = (line: string, tag: string): number | null => {
  if (!line.startsWith(tag)) return null;
  const n = Number(line.slice(tag.length).trim());
  return Number.isFinite(n) ? n : null;
};

export function parsePlaylist(text: string): PlaylistFacts {
  const facts: PlaylistFacts = {
    isPlaylist: false,
    isMaster: false,
    hasEndList: false,
    mediaSequence: null,
    segmentUris: [],
    variantUris: [],
    targetDurationS: null,
  };
  if (typeof text !== "string") return facts;

  // CRLF is what several real CDNs serve. Splitting on \n alone leaves a trailing \r on
  // every URI, which then fails to resolve and makes a healthy stream look broken.
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  if (lines[0] !== "#EXTM3U") return facts;
  facts.isPlaylist = true;

  // A URI belongs to the tag immediately before it. Tracking that is the only way to
  // tell a variant URI from a segment URI, since both are bare lines.
  let nextUriIsVariant = false;

  for (const line of lines.slice(1)) {
    if (line === "") continue;

    if (line.startsWith("#")) {
      if (line === "#EXT-X-ENDLIST") facts.hasEndList = true;
      else if (line.startsWith("#EXT-X-STREAM-INF")) {
        facts.isMaster = true;
        nextUriIsVariant = true;
      } else {
        const seq = NUMBER_TAG(line, "#EXT-X-MEDIA-SEQUENCE:");
        if (seq !== null) facts.mediaSequence = seq;
        const dur = NUMBER_TAG(line, "#EXT-X-TARGETDURATION:");
        if (dur !== null) facts.targetDurationS = dur;
      }
      continue;
    }

    if (nextUriIsVariant) {
      facts.variantUris.push(line);
      nextUriIsVariant = false;
    } else {
      facts.segmentUris.push(line);
    }
  }

  return facts;
}

/**
 * Did the stream move between two reads?
 *
 * Three signals, because relying on the sequence number alone is wrong for real servers:
 * a sliding window bumps `#EXT-X-MEDIA-SEQUENCE`, but an EVENT playlist APPENDS and
 * never bumps it, and some encoders roll the window while pinning the number. Testing
 * only the first would record every EVENT stream as dead.
 */
export function advanced(before: PlaylistFacts, after: PlaylistFacts): boolean {
  if (before.mediaSequence !== null && after.mediaSequence !== null) {
    if (after.mediaSequence > before.mediaSequence) return true;
  }
  if (after.segmentUris.length > before.segmentUris.length) return true;
  const lastBefore = before.segmentUris.at(-1);
  const lastAfter = after.segmentUris.at(-1);
  if (lastBefore !== undefined && lastAfter !== undefined && lastBefore !== lastAfter) return true;
  return false;
}

export type HlsVerdict =
  /** Serving now. Safe to put in front of a human. */
  | { status: "live"; reason: string }
  /** A fact about the CAMERA: it parses, and it is not serving. */
  | { status: "dead"; reason: string }
  /**
   * A fact about OUR RUN, not about the camera. A 403 from a VPN exit, an unparseable
   * body, a playlist with no segments. Kept separate from `dead` on purpose: recording
   * a blocked request as dead is how a bad network quietly deletes a good operator, and
   * under default-deny that deletion is permanent and silent.
   */
  | { status: "unknown"; reason: string }
  /** A master playlist. Follow `followUri` and judge that instead. */
  | { status: "follow"; reason: string; followUri: string };

export function judgeHlsPair(before: PlaylistFacts, after: PlaylistFacts): HlsVerdict {
  if (!before.isPlaylist || !after.isPlaylist) {
    return { status: "unknown", reason: "response was not an HLS playlist" };
  }
  if (before.isMaster || after.isMaster) {
    const followUri = (after.isMaster ? after : before).variantUris[0];
    if (!followUri) return { status: "unknown", reason: "master playlist listed no variants" };
    return { status: "follow", reason: "master playlist", followUri };
  }
  if (before.hasEndList || after.hasEndList) {
    return { status: "dead", reason: "EXT-X-ENDLIST: a finished recording, not a live feed" };
  }
  if (before.segmentUris.length === 0 || after.segmentUris.length === 0) {
    return { status: "unknown", reason: "playlist carried no segments" };
  }
  if (!advanced(before, after)) {
    return { status: "dead", reason: "playlist did not advance between reads: stalled" };
  }
  return { status: "live", reason: "playlist advanced between reads" };
}

/**
 * How long to wait between the two reads. One target duration is the interval the
 * server itself says it publishes at; below that, a healthy stream can legitimately be
 * unchanged and would be recorded as stalled.
 */
export function readGapMs(facts: PlaylistFacts): number {
  const target = facts.targetDurationS && facts.targetDurationS > 0 ? facts.targetDurationS : 10;
  return Math.min(Math.max(target, 4), 20) * 1000 + 500;
}
