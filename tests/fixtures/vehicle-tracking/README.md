# Vehicle tracking e2e fixture

Twelve seconds of **Caltrans CCTV 178, I-110 north of Exposition Blvd, Los Angeles**
(`caltrans:d7-1001` in the registry), recorded through Provenance's own `/api/hls`
proxy on 2026-10-29 at 17:41 PDT, the same stream the product plays.

Re-cut for the test, nothing else changed:

```
ffmpeg -i recorded.ts -t 12 -vf "scale=1280:720,fps=15" -an \
  -c:v libx264 -profile:v main -preset veryfast -crf 31 -g 30 -keyint_min 30 -sc_threshold 0 \
  -f hls -hls_time 2 -hls_list_size 0 -hls_playlist_type vod \
  -hls_segment_filename "seg%d.ts" index.m3u8
```

The segments are then renamed `.mpegts` (and the playlist with them): a `.ts` file
in this repo is TypeScript to `tsc` and `next build`, which fail on the binary.

Used only by `tests/e2e/vehicle-tracking.spec.ts`, which answers every
`/api/hls?id=` request with this playlist. Source: California Department of
Transportation (Caltrans), public CCTV feed.
