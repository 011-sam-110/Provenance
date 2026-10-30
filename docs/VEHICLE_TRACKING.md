# Vehicle tracking on live camera video

A "Track vehicles" switch over a camera's live video. When it is on, every vehicle the
detector finds gets a traced outline, an ID that stays with it, a two-second trail and a
place in the counts at the top left. It is on the public camera page (`/camera/[id]`) and
in the console's camera panel (`CameraDetail`). It is not on the camera wall's tiles: one
detector per tile would run a dozen models at once.

Built 2026-10-30, after a competitor shipped boxes on its camera video.

## What runs where

Everything runs in the visitor's browser. No frame is sent anywhere and nothing is stored.

| Step | File | Where |
|---|---|---|
| Switch, outlines, counts | `components/TrackingOverlay.tsx` | page |
| Frame to model input, model, outlines | `lib/vision/detect.worker.ts` | Web Worker |
| Model output to vehicles | `lib/vision/decode.ts` (boxes, NMS), `lib/vision/contour.ts` (masks) | worker |
| Vehicles across frames | `lib/vision/tracker.ts` | page |
| Page side of the worker | `lib/vision/client.ts`, `lib/vision/protocol.ts` | page |

Frames reach the canvas readable because the video's bytes come through our own
`/api/hls`. A stream played from another origin would taint the canvas and could not be
read.

Three loops, on purpose: detection runs as fast as the worker answers (one frame in
flight); drawing runs every animation frame and asks the tracker where each vehicle is
now, so outlines move with the cars between detections; the counts reach React every
300 ms.

## The model

`public/models/yolo11n-seg.onnx` (12 MB), YOLO11n-seg from Ultralytics 8.4.0, trained
on COCO, exported on 2026-10-30 with:

```
yolo export model=yolo11n-seg.pt format=onnx imgsz=640 dynamic=True simplify=True opset=17
```

`dynamic=True` lets the input be a rectangle (a 16:9 stream runs at 1280x736, not
1280x1280). Five COCO classes are kept: bicycle, car, motorcycle, bus, truck. People
are dropped in `decode.ts`, on purpose.

**Licence: AGPL-3.0**, the same as this repository, so it is compatible. It would not
be if this code were ever relicensed: replace the model first.

The file name is not hashed and `next.config.ts` lets browsers keep it for a day (a
week while revalidating). **A new model gets a new file name**, never a replacement
under the old one.

Why YOLO11n-seg and not YOLO26n-seg (newer, NMS-free): on the Caltrans CCTV 822 frame of
2026-10-29 17:42 PDT at a 1280 input and confidence 0.05, YOLO11n-seg returned 84
candidate boxes and YOLO26n-seg 51. That is one frame, not a benchmark.

## ONNX Runtime

`onnxruntime-web` 1.31.1, pinned exactly. It is not bundled: the worker imports it at
run time from `/ort/`, where `scripts/copy-ort.mjs` copies the installed version's files
on `predev` and `prebuild`. `public/ort/` is in `.gitignore` (the WebGPU wasm alone is
28 MB). If `/ort/` is empty, switching tracking on says "the detector files are missing
from this server".

WebGPU is tried first, with the high-performance adapter requested (Chrome on Windows
may still use the GPU Windows gives it). Without a WebGPU adapter the plain WASM build
runs on one thread: threads need cross-origin isolation, which this site does not set
because it would break every third-party tile and image it shows.

The input starts at 1280 wide on WebGPU and 640 on WASM, and steps down when a frame
takes longer than 260 ms (WebGPU) or 900 ms (WASM).

## Measured (2026-10-30, development laptop, Chrome)

| | 1280x736 input | 640x384 input |
|---|---|---|
| Vehicles found a frame, Caltrans CCTV 178 | about 50 | about 27 |
| Time a frame, WebGPU | about 210 ms | about 70 ms |

Most of the time is the model itself; outlines and decoding take under 30 ms.

On Caltrans CCTV 822 at a single 0.25 confidence cut the model finds 14 boxes; at 0.05
it finds 84, nearly all of them real cars. That is why the cut is low and the tracker
decides.

## Two rules that are not style preferences

1. **A vehicle is shown only after it is matched three times AND has moved, unless the
   model scores it 0.5 or more.** Road signs, gantries and the operator's logo score
   0.2 to 0.45 as "truck" or "car" on almost every frame, and only movement tells them
   from a parked car. The cost is real: a stopped vehicle the model is unsure of is not
   shown (a jam, or the parked cars on SCDOT's I-26 camera at night). Change
   `TRACKER.SURE_SCORE` or the moved rule only with that trade in view.
2. **The counts are what this tab followed, not a traffic count.** The note under the
   video says so, and says that a small model misses distant, small and night-time
   vehicles. Do not put these numbers anywhere that reads as a measurement of traffic.

A vehicle fades when a detection pass looks and does not find it, never because a pass is
slow: WebGPU recompiles for a new input size and one pass took 1.3 s, which once faded
every outline at once.

## Known limits

- Night: the model sees headlights, not cars. On SCDOT's I-26 W at MM 220 at 20:41 EDT
  it showed nothing.
- Stills: tracking needs motion, so cameras that only publish stills get no switch.
- IDs restart when the video jumps back (a loop, a seek): the count of vehicles seen
  does not.

## Tests

- `tests/unit/vision-detect.test.ts`: letterbox, decode, NMS, outlines.
- `tests/unit/vision-tracker.test.ts`: IDs, the sign rule, the parked-car rule, fading.
- `tests/e2e/vehicle-tracking.spec.ts`: the real page, worker and model on a fixed 12 s
  Caltrans clip (`tests/fixtures/vehicle-tracking/`). It needs Google Chrome
  (`channel: "chrome"`): Playwright's own Chromium cannot decode H.264. Not in the gate.
- `scripts/vehicle-tracking-demo.mjs`: opens Google Chrome on a running server's camera page with this clip in place of the stream, looped, under a banner that says it is a recording. For seeing the tracker in daylight whatever the hour in the US.
