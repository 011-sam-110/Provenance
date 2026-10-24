/**
 * One frame in, one row of tests/fixtures/camslot-picture-frames.json out.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/camslot-picture-row.mts <image-or-video> [--at=SECONDS]
 *
 * WHAT IT IS FOR. Adding a card to KNOWN_CARDS in lib/console/widgets/camslot.picture.ts,
 * or a frame to the fixture that proves the check leaves real roads alone. Capture the
 * frame THROUGH THE SITE'S OWN PROXY (/api/proxy for a still, /api/hls for a stream,
 * e.g. `ffmpeg -i "<site>/api/hls?id=caltrans%3Ad7-1030" -t 7 -c copy clip.ts`), so the
 * bytes are the ones a tile receives. Then run this on it and paste the row into the
 * fixture with its `id`, `kind`, `light`, `via` and `capturedUtc` filled in.
 *
 * The grid is made by the SAME `lumaGrid` the browser runs, from the same 160x90 RGBA
 * the browser draws. ffmpeg's area scaler stands in for the canvas drawImage, and the
 * two were measured within 0.4 luma of each other in Chromium (see DRAW_W).
 *
 * Needs ffmpeg on PATH. Makes no network request.
 */
import { execFileSync } from "node:child_process";
import { DRAW_H, DRAW_W, fingerprint, lumaGrid } from "@/lib/console/widgets/camslot.picture";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const at = args.find((a) => a.startsWith("--at="))?.slice("--at=".length);
if (!file) {
  console.error("usage: camslot-picture-row.mts <image-or-video> [--at=SECONDS]");
  process.exit(2);
}

const rgba = execFileSync(
  "ffmpeg",
  [
    "-v", "error",
    ...(at ? ["-ss", at] : []),
    "-i", file,
    "-frames:v", "1",
    "-vf", `scale=${DRAW_W}:${DRAW_H}:flags=area`,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ],
  { maxBuffer: 1 << 24 },
);
const grid = lumaGrid(rgba, DRAW_W, DRAW_H);
if (!grid) {
  console.error("no opaque frame decoded");
  process.exit(1);
}
console.log(JSON.stringify({ luma: Buffer.from(grid).toString("hex"), fingerprint: fingerprint(grid) }));
