// Where the God's eye view may stand a card or hang a tag without covering another
// one or the HUD. Pure screen geometry over points the caller has already projected,
// so tests/unit/eye-declutter.test.ts can hold it without a map.
//
// GREEDY, IN THE CALLER'S ORDER. The caller sorts by what matters most (the camera a
// link named, then what is already on screen, then nearness to the middle), and each
// candidate takes the first free spot or is left out. Nothing is nudged off its
// object: a card stands on its camera's spot or it is not shown.

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The screen, and the bands at its edges the HUD keeps for itself. */
export interface Frame {
  width: number;
  height: number;
  top: number;
  bottom: number;
  side: number;
  /** The right edge's band, where it differs from the left's (a 9:16 recording). */
  right?: number;
}

export function overlaps(a: Box, b: Box): boolean {
  return !(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0);
}

export function insideFrame(b: Box, f: Frame): boolean {
  return b.x0 >= f.side && b.x1 <= f.width - (f.right ?? f.side) && b.y0 >= f.top && b.y1 <= f.height - f.bottom;
}

/** A card stands on a stalk above its anchor, centred over it. */
export interface CardSize {
  width: number;
  height: number;
  stalk: number;
}

/** Space kept clear around every placed box, so plates never touch. */
export const GAP = 6;

export function cardBox(x: number, y: number, s: CardSize): Box {
  return {
    x0: x - s.width / 2 - GAP,
    x1: x + s.width / 2 + GAP,
    y0: y - s.stalk - s.height - GAP,
    y1: y + GAP,
  };
}

export interface Candidate {
  id: string;
  /** The anchor on screen: the object's own spot. */
  x: number;
  y: number;
}

export interface PlacedCard {
  id: string;
  x: number;
  y: number;
}

/**
 * Stand at most `max` cards, in order. `taken` holds what is already placed and gains
 * each new card's box.
 */
export function placeCards(cands: readonly Candidate[], size: CardSize, frame: Frame, max: number, taken: Box[]): PlacedCard[] {
  const out: PlacedCard[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    const box = cardBox(c.x, c.y, size);
    if (!insideFrame(box, frame)) continue;
    if (taken.some((t) => overlaps(t, box))) continue;
    taken.push(box);
    out.push({ id: c.id, x: c.x, y: c.y });
  }
  return out;
}

/** A tag hangs off a short leader, up and to the right of its object, or to the left. */
export interface TagCandidate extends Candidate {
  width: number;
  height: number;
}

export interface PlacedTag extends PlacedCard {
  /** True when the tag opens to the LEFT of its object. */
  flip: boolean;
}

/** The leader's run, sideways and up, from the object to the tag's corner. */
export const LEADER = 14;

export function tagBox(c: TagCandidate, flip: boolean): Box {
  const y1 = c.y - LEADER + GAP;
  const y0 = c.y - LEADER - c.height - GAP;
  return flip
    ? { x0: c.x - LEADER - c.width - GAP, x1: c.x + GAP, y0, y1 }
    : { x0: c.x - GAP, x1: c.x + LEADER + c.width + GAP, y0, y1 };
}

/**
 * Hang at most `max` tags, in order. Each opens to the right where it fits and to the
 * left where only that fits; where neither does, it is left out.
 */
export function placeTags(cands: readonly TagCandidate[], frame: Frame, max: number, taken: Box[]): PlacedTag[] {
  const out: PlacedTag[] = [];
  for (const c of cands) {
    if (out.length >= max) break;
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y)) continue;
    let placed: PlacedTag | null = null;
    for (const flip of [false, true]) {
      const box = tagBox(c, flip);
      if (!insideFrame(box, frame) || taken.some((t) => overlaps(t, box))) continue;
      taken.push(box);
      placed = { id: c.id, x: c.x, y: c.y, flip };
      break;
    }
    if (placed) out.push(placed);
  }
  return out;
}

/** How many tags of each kind a frame hangs at most. */
export interface TagCaps {
  ship: number;
  plane: number;
  road: number;
  signal: number;
}

const WIDE_CAPS: TagCaps = { ship: 8, plane: 3, road: 2, signal: 2 };
const PHONE_CAPS: TagCaps = { ship: 4, plane: 2, road: 1, signal: 1 };
/**
 * A phone sees a small patch of street, so it gets more of TfL's road plates than a wide
 * screen: up to four (Leon, 30 Oct). Each one still has to fit clear of the frame's words,
 * the cards and the other plates, so a crowded view hangs fewer. A notice beyond the cap, or
 * with no room, stays a street line or a ring, which can still be tapped.
 */
export const PHONE_ROAD_TAGS = 4;

/**
 * The tag caps for a frame: a portrait phone's, or a wide screen's. A portrait or a
 * landscape phone takes the four road plates; a recording or a film keeps the old caps, so a
 * reel looks as it did.
 */
export function tagCaps(f: { portrait: boolean; record: boolean; landscapePhone: boolean }): TagCaps {
  const base = f.portrait ? PHONE_CAPS : WIDE_CAPS;
  if (f.record || !(f.portrait || f.landscapePhone)) return base;
  return { ...base, road: PHONE_ROAD_TAGS };
}

/**
 * The width a tag's text needs, near enough to keep tags apart. Inter at the tag's
 * sizes runs about 0.62 em a character in capitals and 0.55 em otherwise.
 */
export function estimateTextWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) em += ch >= "A" && ch <= "Z" ? 0.66 : ch === " " ? 0.28 : 0.56;
  return Math.ceil(em * px);
}

/**
 * Order candidates for placement: the pinned id first, then the ones already on
 * screen (so a turning view does not shuffle its cards), then the nearest to `centre`.
 */
export function placementOrder<T extends Candidate>(
  cands: readonly T[],
  centre: { x: number; y: number },
  shown: ReadonlySet<string>,
  pinned?: string | null,
): T[] {
  const rank = (c: T) => (c.id === pinned ? 0 : shown.has(c.id) ? 1 : 2);
  return [...cands].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return Math.hypot(a.x - centre.x, a.y - centre.y) - Math.hypot(b.x - centre.x, b.y - centre.y);
  });
}
