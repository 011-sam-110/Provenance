import { expect, test } from "@playwright/test";

test("a US camera detail shows live video (or gracefully falls back to a still)", async ({ page, request }) => {
  const { cameras } = await (await request.get("/api/cameras")).json();
  const us = cameras.find((c: { id: string }) => c.id.startsWith("caltrans:") || c.id.startsWith("scdot:"));
  test.skip(!us, "no US camera available from live sources right now");

  await page.goto(`/camera/${encodeURIComponent(us.id)}`);
  await expect(page.getByTestId("attribution")).toBeVisible();
  // Either a <video> mounts, or (offline stream) the still-image fallback appears.
  const media = page.locator(".tn-cam-frame video, .tn-cam-frame img");
  await expect(media.first()).toBeVisible();
});
