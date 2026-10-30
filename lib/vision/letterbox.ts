// Fit a video frame into the model's input without distorting it.
//
// The model is exported with a dynamic input shape, so the input need not be
// square: a 16:9 stream at width 640 becomes 640x384 instead of 640x640, which is
// 40% less work for the same detail. Both sides must be multiples of the model's
// largest stride (32). The frame is scaled to fit and centred; the margin is the
// grey Ultralytics trains with (114).

export const STRIDE = 32;
export const PAD_GREY = 114;

export type Letterbox = {
  /** Model input size. */
  inW: number;
  inH: number;
  /** Source pixels -> input pixels. */
  scale: number;
  /** Offset of the scaled frame inside the input. */
  padX: number;
  padY: number;
  /** Size of the scaled frame inside the input. */
  drawW: number;
  drawH: number;
};

/**
 * `longSide` caps the input's longer side. It is never exceeded, and the frame is
 * never scaled UP: a 768x432 stream at a 1280 cap runs at 768x448, because enlarging
 * a blurry frame adds work and no detail.
 */
export function letterbox(srcW: number, srcH: number, longSide: number): Letterbox {
  const cap = Math.max(STRIDE, Math.floor(longSide / STRIDE) * STRIDE);
  const fit = Math.min(1, cap / Math.max(srcW, srcH));
  const inW = Math.min(cap, Math.ceil((srcW * fit) / STRIDE) * STRIDE);
  const inH = Math.min(cap, Math.ceil((srcH * fit) / STRIDE) * STRIDE);
  const scale = Math.min(inW / srcW, inH / srcH);
  const drawW = Math.round(srcW * scale);
  const drawH = Math.round(srcH * scale);
  return {
    inW,
    inH,
    scale,
    padX: Math.floor((inW - drawW) / 2),
    padY: Math.floor((inH - drawH) / 2),
    drawW,
    drawH,
  };
}

/** Input-space point -> source-space point. */
export function toSource(lb: Letterbox, x: number, y: number): [number, number] {
  return [(x - lb.padX) / lb.scale, (y - lb.padY) / lb.scale];
}
