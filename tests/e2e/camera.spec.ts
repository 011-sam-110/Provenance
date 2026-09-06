import { expect, test } from "@playwright/test";

test("a camera detail page shows a proxied image and TfL attribution", async ({ page, request }) => {
  const res = await request.get("/api/cameras");
  expect(res.ok()).toBeTruthy();
  const { cameras } = await res.json();
  expect(cameras.length).toBeGreaterThan(0);
  const id: string = cameras[0].id;

  await page.goto(`/camera/${encodeURIComponent(id)}`);
  await expect(page.getByTestId("attribution")).toContainText("Powered by TfL Open Data");

  const img = page.locator(".tn-cam-frame img");
  await expect(img).toBeVisible();
  // The proxy actually serves image bytes:
  const proxyRes = await request.get(`/api/proxy?id=${encodeURIComponent(id)}`);
  expect(proxyRes.ok()).toBeTruthy();
  expect(proxyRes.headers()["content-type"]).toContain("image");
});

test("the proxy rejects a request with no id", async ({ request }) => {
  const res = await request.get("/api/proxy");
  expect(res.status()).toBe(400);
});

test("camera list carries country/live; detail exposes mediaType but never the raw streamUrl", async ({ request }) => {
  const { cameras } = await (await request.get("/api/cameras")).json();
  expect(cameras[0].country).toBeTruthy(); // list now carries country
  expect(typeof cameras[0].live).toBe("boolean"); // …and the live-stream flag
  const res = await request.get(`/api/camera/${encodeURIComponent(cameras[0].id)}`);
  const { camera } = await res.json();
  expect(camera.mediaType).toBeTruthy();
  expect(camera.streamUrl).toBeUndefined();
});
