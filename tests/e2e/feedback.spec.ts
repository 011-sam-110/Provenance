import { test, expect } from "@playwright/test";

// The feedback prompt, end to end. The gate maths is covered exhaustively by
// tests/unit/feedback.test.ts; what only a browser can prove is the rest:
// that the dialog is really a dialog, that the network call carries what the
// person typed and nothing else, that all three exits are permanent, and that
// a blank email really does submit.
//
// `?feedback=1` is the review override the component reads (same precedent as
// `?boot=1`). Without it these tests would have to fake fifteen minutes.

/** Suppress the launch plate, which is modal and would intercept every click.
 *  `d`, not `data` — that is the key PersistEnvelope actually writes. */
async function seedSeen(page: import("@playwright/test").Page) {
  await page.goto("/app");
  await page.evaluate(() => {
    localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
    localStorage.removeItem("tn.feedback.v1");
  });
}

/** The prompt holds off for the length of the boot plate plus a beat, so every
 *  wait here has to clear that, not just a render tick. */
const PROMPT = ".tn-fb-card";
const APPEAR_MS = 20_000;

test("the prompt is a real dialog, and sends only what was typed", async ({ page }) => {
  test.setTimeout(90_000);
  await seedSeen(page);

  const posted: Array<Record<string, unknown>> = [];
  await page.route("**/api/feedback", async (route) => {
    posted.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/app?feedback=1");
  const card = page.locator(PROMPT);
  await expect(card).toBeVisible({ timeout: APPEAR_MS });

  // Dialog semantics, not a div that looks like one.
  const dialog = page.locator(".tn-fb[role='dialog']");
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(page.locator("#tn-fb-title")).toBeVisible();

  await page.locator("#tn-fb-occ").selectOption("Journalist");
  await page.locator("#tn-fb-useful").fill("The camera wall, and the country dossiers.");
  await page.locator(".tn-fb-rate", { hasText: /^8$/ }).click();
  await page.locator("#tn-fb-email").fill("jo@example.com");

  // The dwell guard rejects anything faster than a human, so a scripted fill has
  // to wait it out exactly as a person would.
  await page.waitForTimeout(3500);
  await page.locator(".tn-fb-btn.is-primary").click();

  await expect(page.locator(".tn-fb-card.is-thanks")).toBeVisible({ timeout: 10_000 });

  expect(posted).toHaveLength(1);
  const body = posted[0];
  expect(body.occupation).toBe("Journalist");
  expect(body.rating).toBe(8);
  expect(body.email).toBe("jo@example.com");
  expect(body.website).toBe(""); // honeypot left alone by a real interaction
  // Nothing about the person that they did not type.
  expect(Object.keys(body).sort()).toEqual(
    ["dwellMs", "email", "occupation", "rating", "trigger", "useful", "website"],
  );
});

test("a blank email submits with no error - optional means optional", async ({ page }) => {
  test.setTimeout(90_000);
  await seedSeen(page);

  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/feedback", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/app?feedback=1");
  await expect(page.locator(PROMPT)).toBeVisible({ timeout: APPEAR_MS });

  await page.locator("#tn-fb-occ").selectOption("Student");
  await page.locator("#tn-fb-useful").fill("Watching the wildfire layer during the summer.");
  await page.locator(".tn-fb-rate", { hasText: /^7$/ }).click();
  // Email deliberately untouched.
  await page.waitForTimeout(3500);
  await page.locator(".tn-fb-btn.is-primary").click();

  await expect(page.locator(".tn-fb-error")).toHaveCount(0);
  await expect(page.locator(".tn-fb-card.is-thanks")).toBeVisible({ timeout: 10_000 });
  expect(sent).not.toBeNull();
  expect(sent!.email).toBe("");
});

test("choosing Other reveals a text box and sends what was typed there", async ({ page }) => {
  test.setTimeout(90_000);
  await seedSeen(page);

  let sent: Record<string, unknown> | null = null;
  await page.route("**/api/feedback", async (route) => {
    sent = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/app?feedback=1");
  await expect(page.locator(PROMPT)).toBeVisible({ timeout: APPEAR_MS });

  const other = page.locator("input[aria-label='Your occupation']");
  await expect(other).toHaveCount(0);
  await page.locator("#tn-fb-occ").selectOption("__other__");
  await expect(other).toBeVisible();
  await other.fill("Harbour pilot");

  await page.locator("#tn-fb-useful").fill("AIS around the approaches.");
  await page.locator(".tn-fb-rate", { hasText: /^9$/ }).click();
  await page.waitForTimeout(3500);
  await page.locator(".tn-fb-btn.is-primary").click();

  await expect(page.locator(".tn-fb-card.is-thanks")).toBeVisible({ timeout: 10_000 });
  expect(sent!.occupation).toBe("Harbour pilot");
});

// The three exits are the promise the whole feature rests on: ask once, never
// again. Each is checked by RELOADING, because a flag that only lives in React
// state would pass an in-page assertion and fail the actual promise.
for (const exit of [
  { name: "the close button", act: (p: import("@playwright/test").Page) => p.locator(".tn-fb-x").click() },
  { name: "No thanks", act: (p: import("@playwright/test").Page) => p.locator(".tn-fb-btn.is-ghost").click() },
  { name: "Escape", act: (p: import("@playwright/test").Page) => p.keyboard.press("Escape") },
]) {
  test(`dismissing with ${exit.name} is permanent across a reload`, async ({ page }) => {
    test.setTimeout(90_000);
    await seedSeen(page);
    await page.goto("/app?feedback=1");
    await expect(page.locator(PROMPT)).toBeVisible({ timeout: APPEAR_MS });

    await exit.act(page);
    await expect(page.locator(PROMPT)).toHaveCount(0);

    const stored = await page.evaluate(() => localStorage.getItem("tn.feedback.v1"));
    expect(stored).toContain("dismissed");

    // Even WITH the force override, a recorded "no" is respected - review must not
    // be able to silently undo a visitor's decision.
    await page.goto("/app?feedback=1");
    await page.waitForTimeout(APPEAR_MS);
    await expect(page.locator(PROMPT)).toHaveCount(0);
  });
}

test("it does not appear for a first-time visitor who has only just arrived", async ({ page }) => {
  test.setTimeout(90_000);
  await seedSeen(page);
  // No override: a fresh visit qualifies on neither arm.
  await page.goto("/app");
  await page.waitForTimeout(APPEAR_MS);
  await expect(page.locator(PROMPT)).toHaveCount(0);
});
