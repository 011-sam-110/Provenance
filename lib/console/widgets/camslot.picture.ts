// Is the picture a tile just received a picture of the road, or the operator telling
// us there is none?
//
// THE FAULT THIS EXISTS FOR (measured on the live site, 2026-10-23 14:54 PDT). A
// circle over downtown Los Angeles filled a nine-tile wall, and four of the nine
// showed Caltrans' white "Temporarily Unavailable" card. The bench in
// camslot.health.ts never took them out, because nothing about the card is a
// failure it can see: the JPEG answers 200 and decodes, so `onLoad` reported a
// healthy camera every time. The bench was judging the fetch, and the fetch was
// fine. What was wrong was the picture.
//
// WHERE THE CARD ACTUALLY COMES FROM (measured 2026-10-24, 04:28-05:12 PDT). All 8
// D7 stills sampled from cameras near downtown that were down (1052-1057, 596, 597)
// were the same 320x260 card, 16.67 KB, differing only in the timestamp burned into
// its bottom bar. Where a down camera lists a stream, the stream answered 404
// instead: six streams on that morning's wall did. So on the wall the card arrives
// through the STILL: first as the <video> element's poster while the stream is asked
// for, then as CameraImage once the player gives up. With Chrome's own HLS player,
// that second step needs the <video> element's error event, which CameraVideo.tsx
// now handles. The visible play and mute buttons belong to the <video> element
// showing that poster; they do not mean a stream is playing the card. Frames of a
// playing stream are checked all the same, so a stream that does play this card is
// caught too.
//
// TWO RULES, BOTH DELIBERATELY NARROW. This is not a classifier of "looks like a
// road", and it must never become one: fog, snow, glare and night all look unlike a
// sunny freeway, and every one of them is a camera doing its job. Only two things
// count as "no picture":
//   1. a KNOWN operator card, matched by fingerprint. A card nobody has added to
//      KNOWN_CARDS is shown, exactly as before. The failure direction is a card on
//      screen, never a working camera hidden.
//   2. a frame that is black everywhere. A dark frame with one street lamp, one pair
//      of headlights or the operator's own caption in it is not black.
//
// Everything here except `readPicture` is pure, so the rules are testable in the
// node environment tests/unit runs in. The frames behind every threshold are in
// tests/fixtures/camslot-picture-frames.json.

/** The grid a picture is judged on: 16 x 9, the shape of a road camera's frame. */
export const GRID_W = 16;
export const GRID_H = 9;

/**
 * The canvas a picture is DRAWN into, before it is averaged down to the grid.
 *
 * Ten canvas pixels per grid cell, and the averaging happens HERE, in `lumaGrid`,
 * rather than inside the browser's drawImage. Measured 2026-10-24 in Chromium,
 * headless and headed: drawing a 320x260 card straight to 16x9 landed 5.5 luma away
 * from a true area average, which flipped 27 of a plain dHash's 263 bits on the
 * card's flat white. Drawing to 160x90 and averaging in JS landed within 0.4, and a
 * worst-case point-sampled 160x90 still came out 8 trits from the card's own
 * fingerprint, against 113 for the nearest real road. Small enough to cost nothing:
 * 160x90 is 57,600 bytes read back, once per picture.
 */
export const DRAW_W = GRID_W * 10;
export const DRAW_H = GRID_H * 10;

/** A picture reduced to the grid: GRID_W x GRID_H luma values, 0-255, row-major. */
export type LumaGrid = Uint8Array;

/**
 * Average an RGBA buffer down to the grid, by exact area: every source pixel counts
 * in proportion to how much of it falls inside the cell.
 *
 * Returns null when any pixel is not fully opaque. That is how "nothing was drawn"
 * looks — a <video> with no current frame draws nothing, and a cleared canvas is
 * transparent black — and a picture we did not get must never be judged as a black
 * one. A genuinely translucent image is not a camera frame either way.
 */
export function lumaGrid(rgba: ArrayLike<number>, w: number, h: number): LumaGrid | null {
  if (!(w > 0) || !(h > 0) || rgba.length < w * h * 4) return null;
  for (let i = 3; i < w * h * 4; i += 4) if (rgba[i] !== 255) return null;
  const out = new Uint8Array(GRID_W * GRID_H);
  for (let gy = 0; gy < GRID_H; gy++) {
    const y0 = (gy * h) / GRID_H;
    const y1 = ((gy + 1) * h) / GRID_H;
    for (let gx = 0; gx < GRID_W; gx++) {
      const x0 = (gx * w) / GRID_W;
      const x1 = ((gx + 1) * w) / GRID_W;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          const p = 4 * (y * w + x);
          // Rec. 601 weights, the usual ones for a luma hash. The fixture grids were
          // made by this same function, so the choice only has to be consistent.
          sum += wx * wy * (0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2]);
          area += wx * wy;
        }
      }
      out[gy * GRID_W + gx] = Math.round(sum / area);
    }
  }
  return out;
}

/**
 * Two neighbouring cells closer than this are "flat", and their trit is 0.
 *
 * THIS IS THE DIFFERENCE FROM A PLAIN dHASH, and the card is the reason. A dHash
 * stores one bit per neighbour pair, "is the left one brighter", so on a flat white
 * area the bit is decided by noise: two reads of the SAME card that agreed to within
 * one luma level on the white disagreed on up to 32 of 263 bits (measured
 * 2026-10-24, ffmpeg's area scaler against Chromium's canvas). Most of the card is
 * flat white. With a dead zone, flat stays 0 however it is sampled, and only real
 * edges — the lettering, the bar — carry the fingerprint. Comparing differences, not
 * levels, also keeps it blind to a brighter or darker encode of the same card: the
 * card scaled to limited range (16-235) moved 4 trits.
 */
export const FLAT_LUMA = 12;

/**
 * A picture's fingerprint: one trit per neighbouring pair of grid cells, "+" when
 * the first is brighter by more than FLAT_LUMA, "-" when it is darker, "0" when the
 * two are flat. The 15 x 9 horizontal pairs come first, then the 16 x 8 vertical
 * ones: 263 characters.
 */
export function fingerprint(grid: LumaGrid): string {
  let out = "";
  const trit = (a: number, b: number) => (a - b > FLAT_LUMA ? "+" : b - a > FLAT_LUMA ? "-" : "0");
  for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W - 1; x++) out += trit(grid[y * GRID_W + x], grid[y * GRID_W + x + 1]);
  for (let y = 0; y < GRID_H - 1; y++) for (let x = 0; x < GRID_W; x++) out += trit(grid[y * GRID_W + x], grid[(y + 1) * GRID_W + x]);
  return out;
}

/** How many trits two fingerprints disagree on. Unequal lengths are as far apart as
 *  they can be, so a malformed entry can never match anything. */
export function fingerprintDistance(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export interface KnownCard {
  id: string;
  /** Whose card it is. */
  operator: string;
  /** What the card says, for a person reading this list. */
  says: string;
  /** Where and when the reference frame was seen, so the entry can be re-checked. */
  seen: string;
  fingerprint: string;
}

/**
 * The operator cards this check knows. One entry per card actually seen.
 *
 * A second Caltrans card, a different size of this one, or any other operator's
 * card is NOT matched until a real frame of it is added here and to the fixture.
 * That is the approved rule: known cards only, never a guess at what a card might
 * look like.
 */
export const KNOWN_CARDS: readonly KnownCard[] = [
  {
    id: "caltrans-temporarily-unavailable",
    operator: "Caltrans",
    says: "Temporarily Unavailable",
    seen: "caltrans:d7-1053 through /api/proxy, 2026-10-24T11:28:33Z (320x260 still)",
    // The 135 horizontal trits, then the 128 vertical ones. The fixture's card rows
    // must all match this, and the test fails if the two drift apart.
    fingerprint:
      "000000000000000000000000000000000-0000000000000+0-+-0-+-+--00++000000000-0000+0+0000000-0000000000000000000000000000000000+0000-+-000+0" +
      "0000000000000000000+000000000000000+++++++++++0000+-----------0000-00+0000000000000----------0000000000000000000++++++++++++++++",
  },
];

/**
 * How far a picture's fingerprint may sit from a known card and still be that card.
 *
 * The measured gap, 2026-10-24: the eight real card stills sat 0 apart; a
 * point-sampled worst case of the drawing path sat 8 away; the closest thing that is
 * NOT the card — a white frame carrying the card's own timestamp bar and no
 * lettering — sat 53 away, a blank white, grey or black frame 74, and the 46 real
 * road frames by day and night 116 or more (113 when Chromium did the drawing). 20
 * leaves room on both sides.
 */
export const CARD_MATCH_MAX = 20;

export function matchKnownCard(grid: LumaGrid): KnownCard | null {
  const fp = fingerprint(grid);
  for (const card of KNOWN_CARDS) {
    if (fingerprintDistance(fp, card.fingerprint) <= CARD_MATCH_MAX) return card;
  }
  return null;
}

/**
 * The brightest a grid cell may be in a "black" frame.
 *
 * EVERY cell, not the average, and that is the whole defence against night. Measured
 * at 04:30 PDT on 2026-10-24, the darkest of 22 night frames from downtown Los
 * Angeles still had a cell averaging 114: street lamps, headlights and the operator's
 * caption all survive the averaging. A frame with no picture at all is 0 everywhere,
 * or 16 if a decoder takes limited range for full. A frame that is black apart from
 * a burned-in caption is NOT matched, on purpose: the failure direction is a dark
 * tile left on screen, never a night camera taken off it.
 */
export const BLACK_MAX_LUMA = 24;

export function isBlackFrame(grid: LumaGrid): boolean {
  for (let i = 0; i < grid.length; i++) if (grid[i] > BLACK_MAX_LUMA) return false;
  return grid.length > 0;
}

/** What a tile's picture shows. */
export type PictureVerdict = "picture" | "placeholder" | "black";

export function judgeGrid(grid: LumaGrid): PictureVerdict {
  if (matchKnownCard(grid)) return "placeholder";
  if (isBlackFrame(grid)) return "black";
  return "picture";
}

/**
 * How often a PLAYING stream's picture is looked at again.
 *
 * One look per segment: Caltrans cuts its streams into 10-second segments (measured
 * against D11 on 2026-09-08, see the prefetch note in camslot.tsx), so each look is
 * at a frame from a fetch the last one did not see. That matters for a black frame,
 * which is benched on its second strike: two looks at one segment would be one
 * frame counted twice. A known card is benched on its first.
 */
export const VIDEO_RECHECK_MS = 10_000;

/** A verdict, or "unknown" when the picture could not be read at all. */
export type PictureRead = PictureVerdict | "unknown";

/**
 * What the bench is told. "unknown" is NOT a strike: a picture we could not read
 * (a cross-origin image, a video with no frame yet) loaded all the same, so it
 * reports exactly what it reported before this file existed.
 */
export function pictureOutcome(read: PictureRead): true | "placeholder" | "black" {
  return read === "placeholder" || read === "black" ? read : true;
}

// ── Browser side ─────────────────────────────────────────────────────────────
//
// The one impure function. It reads ONLY a picture that is already in the page:
// the <img> or <video> a tile just loaded through /api/proxy, /api/hls or
// /api/webcam-image. It makes no request of its own, so it adds nothing to any
// operator's load.

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

/**
 * Draw the picture small and judge it.
 *
 * A cross-origin picture taints the canvas, and reading a tainted canvas throws a
 * SecurityError. That is "unknown", never a strike. A tainted canvas also stays
 * tainted, so the shared one is dropped and the next picture gets a fresh one.
 */
export function readPicture(el: HTMLImageElement | HTMLVideoElement): PictureRead {
  if (typeof document === "undefined") return "unknown";
  if (el instanceof HTMLVideoElement) {
    // HAVE_CURRENT_DATA. Below it there is no frame, and drawing one draws nothing.
    if (el.readyState < 2 || !el.videoWidth) return "unknown";
  } else if (!el.complete || !el.naturalWidth) {
    return "unknown";
  }
  try {
    if (!canvas || !ctx) {
      canvas = document.createElement("canvas");
      canvas.width = DRAW_W;
      canvas.height = DRAW_H;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return "unknown";
    }
    ctx.clearRect(0, 0, DRAW_W, DRAW_H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(el, 0, 0, DRAW_W, DRAW_H);
    const grid = lumaGrid(ctx.getImageData(0, 0, DRAW_W, DRAW_H).data, DRAW_W, DRAW_H);
    return grid ? judgeGrid(grid) : "unknown";
  } catch {
    canvas = null;
    ctx = null;
    return "unknown";
  }
}
