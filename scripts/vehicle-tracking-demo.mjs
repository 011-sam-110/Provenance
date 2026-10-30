// See vehicle tracking on a known daytime clip, whatever the time is where the
// cameras are. Opens Google Chrome on a running server's camera page and answers
// that camera's stream with the e2e fixture (12 s of Caltrans CCTV 178, recorded
// 2026-10-29 17:41 PDT), looped. A banner on the page says it is a recording.
//
//   node scripts/vehicle-tracking-demo.mjs --base=http://localhost:3000
//
// Not in the gate: it needs Google Chrome and a screen. Close the window to stop.

import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const base = (process.argv.find((a) => a.startsWith("--base=")) ?? "--base=http://localhost:3000").slice(7);
const FIXTURE = join(process.cwd(), "tests", "fixtures", "vehicle-tracking");
const playlist = readFileSync(join(FIXTURE, "index.m3u8"), "utf8").replace(/^(seg\d+\.mpegts)$/gm, "/__vt-fixture/$1");

const res = await fetch(`${base}/api/cameras`);
const live = (await res.json()).cameras.find((c) => c.live);
if (!live) {
  console.error("No live camera in this server's registry right now; nothing to open.");
  process.exit(1);
}

const browser = await chromium.launch({ channel: "chrome", headless: false });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await page.route(/\/api\/hls\?id=/, (r) =>
  r.fulfill({ status: 200, contentType: "application/vnd.apple.mpegurl", body: playlist }),
);
await page.route(/\/__vt-fixture\/seg\d+\.mpegts$/, (r) =>
  r.fulfill({
    status: 200,
    contentType: "video/mp2t",
    body: readFileSync(join(FIXTURE, new URL(r.request().url()).pathname.split("/").pop())),
  }),
);
await page.goto(`${base}/camera/${encodeURIComponent(live.id)}`);
await page.locator(".tn-cam-frame video").evaluate((v) => {
  v.loop = true;
  void v.play();
});
await page.evaluate(() => {
  const b = document.createElement("div");
  b.textContent =
    "Recorded clip: Caltrans CCTV 178, I-110 at Exposition Blvd, 29 Oct 2026 17:41 PDT. Not this camera, not live.";
  b.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:9999;padding:8px 14px;background:#b42318;color:#fff;font:600 13px system-ui";
  document.body.append(b);
});
console.log(`Opened ${base}/camera/${live.id} with the recorded clip. Press "Track vehicles".`);
await new Promise((resolve) => browser.on("disconnected", resolve));
