import { expect, test, type Page, type Route } from "@playwright/test";
import { BRAND } from "../../lib/brand";

/**
 * The Discord pop-up (components/shell/CommunityNote.tsx, gate in lib/shell/community.ts).
 *
 *   - The real gate: a visitor who stays 15 visible seconds gets it once. Automation does
 *     not get it unasked, and neither does anyone typing or reading another dialog.
 *   - The old corner card's answers do not stop it, because the people who pressed Join on
 *     the dead link are stored as "joined".
 *   - It only says the link works if Discord did not call it dead, and every figure on it is
 *     Discord's: the real route's count on screen, and no number when Discord cannot answer.
 *   - It is easy to leave, it traps focus, and the page behind it does not scroll.
 *   - It fits a phone both ways up, on the landing page and the dashboard, and God's eye view
 *     never carries it. Reduced motion stills it.
 *
 * THE HOOKS: `?discord=1` opens it at once. navigator.webdriver is set to false by an init
 * script for the tests that walk the real gate, because a test browser is otherwise automation.
 * The gate (`npx tsc --noEmit && npm test`) does NOT run this file. See CLAUDE.md, "Build gate".
 * Set DISCORD_POPUP_SHOTS=<dir> to keep a screenshot of each state.
 */

test.describe.configure({ timeout: 120_000 });

const SHOTS = process.env.DISCORD_POPUP_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const LIVE = { state: "live", members: 265, online: 27 };

const popup = (page: Page) => page.getByRole("dialog", { name: "The Discord link works again." });
const joinLink = (page: Page) => page.getByRole("link", { name: "Join the Discord" });

/** The real gate needs a browser that does not say it is automated. */
const asVisitor = (page: Page) =>
  page.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => false }));

const answerWith = (page: Page, body: unknown, status = 200) =>
  page.route("**/api/community", (route: Route) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) }),
  );

const openReview = async (page: Page, path = "/") => {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}discord=1`);
  await expect(popup(page)).toBeVisible({ timeout: 90_000 });
};

/** The answer saved in this browser. */
const saved = (page: Page) =>
  page.evaluate(() => {
    const raw = window.localStorage.getItem("tn.community.v1");
    return raw ? (JSON.parse(raw) as { v: number; d: { resolved?: string } }) : null;
  });

test.describe("the real gate", () => {
  test("a visitor who stays 15 visible seconds gets it, with Discord's real count", async ({ page, request }) => {
    await asVisitor(page);
    await page.goto("/");
    await page.waitForTimeout(9_000);
    await expect(popup(page)).toHaveCount(0);
    await expect(popup(page)).toBeVisible({ timeout: 15_000 });

    // Read through the route itself: this is the one journey with no stub in it.
    const route = (await (await request.get("/api/community")).json()) as typeof LIVE;
    expect(route.state).toBe("live");
    expect(route.members).toBeGreaterThan(0);
    await expect(popup(page).getByText(`${route.members.toLocaleString("en-GB")} members`)).toBeAttached();
    await expect(joinLink(page)).toHaveAttribute("href", BRAND.discordUrl);
    await shot(page, "real-gate-landing");
  });

  test("the old corner card's answer does not stop it", async ({ page }) => {
    await asVisitor(page);
    await answerWith(page, LIVE);
    await page.addInitScript(() => {
      if (window.sessionStorage.getItem("seeded")) return;
      window.sessionStorage.setItem("seeded", "1");
      window.localStorage.setItem("tn.community.v1", JSON.stringify({ v: 1, d: { visits: 8, activeMs: 900000, resolved: "joined" } }));
    });
    await page.goto("/");
    await expect(popup(page)).toBeVisible({ timeout: 25_000 });
  });

  test("once answered it does not come back", async ({ page }) => {
    await asVisitor(page);
    await answerWith(page, LIVE);
    await page.goto("/");
    await expect(popup(page)).toBeVisible({ timeout: 25_000 });
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(popup(page)).toHaveCount(0);
    expect((await saved(page))?.d.resolved).toBe("dismissed");

    await page.reload();
    await page.waitForTimeout(20_000);
    await expect(popup(page)).toHaveCount(0);
  });

  test("a dead invite keeps it shut, spends nothing, and the next visit asks again", async ({ page }) => {
    await asVisitor(page);
    await answerWith(page, { state: "dead", members: null, online: null });
    const asked = page.waitForRequest("**/api/community", { timeout: 25_000 });
    await page.goto("/");
    await asked;
    await page.waitForTimeout(3_000);
    await expect(popup(page)).toHaveCount(0);
    expect((await saved(page))?.d.resolved).toBeUndefined();

    await page.unroute("**/api/community");
    await answerWith(page, LIVE);
    await page.reload();
    await expect(popup(page)).toBeVisible({ timeout: 10_000 });
  });

  test("it waits while someone is typing", async ({ page }) => {
    await asVisitor(page);
    await answerWith(page, LIVE);
    await page.goto("/");
    await page.evaluate(() => {
      const field = document.createElement("input");
      field.id = "typing-here";
      document.body.append(field);
      field.focus();
    });
    await page.waitForTimeout(20_000);
    await expect(popup(page)).toHaveCount(0);
    await page.evaluate(() => (document.getElementById("typing-here") as HTMLElement).blur());
    await expect(popup(page)).toBeVisible({ timeout: 6_000 });
  });

  test("a browser driven by automation does not get it unasked, and never asks the API", async ({ page }) => {
    const asked: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/api/community")) asked.push(req.url());
    });
    await page.goto("/");
    await page.waitForTimeout(19_000);
    await expect(popup(page)).toHaveCount(0);
    expect(asked).toEqual([]);
  });
});

test.describe("what it says", () => {
  test("the brief's four points and the live figures", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page);
    const dialog = popup(page);
    await expect(dialog.getByRole("heading", { name: "The Discord link works again." })).toBeVisible();
    await expect(dialog.getByText("The community is open.")).toBeVisible();
    await expect(dialog.getByText("The devs are active.")).toBeVisible();
    await expect(dialog.getByText("We would love your feedback.")).toBeVisible();
    await expect(dialog.getByText("265 members")).toBeAttached();
    await expect(dialog.getByText("27 online")).toBeVisible();
    // The globe finishes its burst and the reel lands.
    await page.waitForTimeout(2_200);
    await shot(page, "landing-1440");
  });

  test("a much larger count still fits, with its comma", async ({ page }) => {
    await answerWith(page, { state: "live", members: 12480, online: 901 });
    await openReview(page);
    await expect(popup(page).getByText("12,480 members")).toBeAttached();
    await page.waitForTimeout(2_200);
    const overflow = await page.evaluate(() => {
      const count = document.querySelector(".tn-join-count")!.getBoundingClientRect();
      const card = document.querySelector(".tn-join-card")!.getBoundingClientRect();
      return count.right - card.right;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await shot(page, "five-digits");
  });

  test("when Discord cannot answer it opens with no figure at all", async ({ page }) => {
    await answerWith(page, { state: "unknown", members: null, online: null });
    await openReview(page);
    await expect(popup(page).locator(".tn-join-count")).toHaveCount(0);
    await expect(popup(page).getByText(/\bonline\b/)).toHaveCount(0);
    await expect(popup(page).locator(".tn-join-stats svg")).toBeVisible();
    await expect(joinLink(page)).toBeVisible();
    await page.waitForTimeout(1_500);
    await shot(page, "no-figures");
  });

  test("a failing route is the same as no answer", async ({ page }) => {
    await page.route("**/api/community", (route) => route.abort());
    await openReview(page);
    await expect(popup(page).locator(".tn-join-count")).toHaveCount(0);
  });
});

test.describe("leaving it", () => {
  test("Join opens the invite in a new tab, closes it and records the answer", async ({ page, context }) => {
    await answerWith(page, LIVE);
    await context.route("https://discord.gg/**", (route) => route.fulfill({ status: 200, body: "stub" }));
    await openReview(page);
    await expect(joinLink(page)).toHaveAttribute("target", "_blank");
    const [tab] = await Promise.all([context.waitForEvent("page"), joinLink(page).click()]);
    await tab.waitForURL(`**${new URL(BRAND.discordUrl).pathname}*`);
    await tab.close();
    await expect(popup(page)).toHaveCount(0);
    expect((await saved(page))?.d.resolved).toBe("joined");
  });

  for (const [how, leave] of [
    ["the Escape key", (page: Page) => page.keyboard.press("Escape")],
    ["the X", (page: Page) => page.getByRole("button", { name: "Close, and do not show this again" }).click()],
    ["Not now", (page: Page) => page.getByRole("button", { name: "Not now" }).click()],
  ] as const) {
    test(`${how} closes it and records a no`, async ({ page }) => {
      await answerWith(page, LIVE);
      await openReview(page);
      await leave(page);
      await expect(popup(page)).toHaveCount(0);
      expect((await saved(page))?.d.resolved).toBe("dismissed");
    });
  }

  test("a click on the veil closes it, but not one already on its way when it opened", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page);
    await page.mouse.click(8, 8);
    await expect(popup(page)).toBeVisible();
    await page.waitForTimeout(900);
    await page.mouse.click(8, 8);
    await expect(popup(page)).toHaveCount(0);
  });

  test("Escape still closes it after a click has taken the focus out of it", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page);
    // Inside the veil's grace period: nothing closes, and the focus falls to the page.
    await page.mouse.click(8, 8);
    await expect(popup(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(popup(page)).toHaveCount(0);
  });

  test("Tab comes back into it after a click has taken the focus out of it", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page);
    await page.mouse.click(8, 8);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".tn-join")))).toBe(true);
  });

  test("a reload shows it again under the review flag, so a review needs no second tab", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page);
    await page.keyboard.press("Escape");
    await expect(popup(page)).toHaveCount(0);
    await page.reload();
    await expect(popup(page)).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("keyboard and scroll", () => {
  test("focus lands on the card, not on Join, and Tab stays inside", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page);
    await expect(page.locator(".tn-join-card")).toBeFocused();

    // A stray Enter joins nothing.
    await page.keyboard.press("Enter");
    await expect(popup(page)).toBeVisible();

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".tn-join")))).toBe(true);
    }
  });

  test("the landing page does not scroll behind it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await answerWith(page, LIVE);
    await openReview(page);
    await page.mouse.move(40, 400);
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    for (const key of ["PageDown", "Space", "ArrowDown", "End"]) await page.keyboard.press(key);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(popup(page)).toBeVisible();
  });
});

test.describe("every screen", () => {
  const measure = (page: Page) =>
    page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      const cta = box(".tn-join-cta");
      const x = box(".tn-join-x");
      const orb = box(".tn-join-orb");
      const sheet = document.querySelector(".tn-join-sheet") as HTMLElement;
      return {
        orbTop: orb.top,
        ctaBottom: cta.bottom,
        ctaHeight: cta.height,
        xHeight: x.height,
        xRight: x.right,
        vh: window.innerHeight,
        vw: window.innerWidth,
        sheetScrolls: sheet.scrollHeight > sheet.clientHeight,
        wide: document.documentElement.scrollWidth > window.innerWidth,
      };
    });

  for (const [name, width, height] of [
    ["phone-390", 390, 844],
    ["small-phone-360", 360, 640],
    ["phone-side-844", 844, 390],
    ["laptop-1280", 1280, 720],
    ["wide-1920", 1920, 1080],
  ] as const) {
    test(`${name}: Join is on screen and large enough to press`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await answerWith(page, LIVE);
      await openReview(page);
      await page.waitForTimeout(2_200);
      const m = await measure(page);
      expect(m.ctaBottom).toBeLessThanOrEqual(m.vh);
      expect(m.ctaHeight).toBeGreaterThanOrEqual(44);
      expect(m.xHeight).toBeGreaterThanOrEqual(44);
      expect(m.xRight).toBeLessThanOrEqual(m.vw);
      expect(m.wide).toBe(false);
      // The planet stays on screen, and all three lines show with nothing to scroll.
      expect(m.orbTop).toBeGreaterThanOrEqual(0);
      expect(m.sheetScrolls).toBe(false);
      await shot(page, name);
    });
  }

  test("the smallest phone can scroll the words, and Join stays on screen", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await answerWith(page, LIVE);
    await openReview(page);
    await page.waitForTimeout(2_200);
    const m = await measure(page);
    expect(m.ctaBottom).toBeLessThanOrEqual(m.vh);
    expect(m.wide).toBe(false);
    await shot(page, "smallest-phone-320");
  });

  test("the console shows it, and a reload keeps it after the map rewrites the address", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page, "/app");
    await page.waitForTimeout(2_200);
    await shot(page, "console-light");
    await page.keyboard.press("Escape");
    // A second visit can roll the feedback prompt, one time in three, and the pop-up rightly
    // waits behind it (the test below). Answered, so this journey has one outcome.
    await page.evaluate(() =>
      localStorage.setItem("tn.feedback.v1", JSON.stringify({ v: 1, d: { visits: 2, activeMs: 0, resolved: "dismissed" } })),
    );
    await page.reload();
    await expect(popup(page)).toBeVisible({ timeout: 90_000 });
  });

  test("the feedback prompt goes first, and it opens once that has closed", async ({ page }) => {
    await answerWith(page, LIVE);
    await page.goto("/app?feedback=1&discord=1");
    const prompt = page.locator(".tn-fb-card");
    await expect(prompt).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(6_000);
    await expect(popup(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Close, and do not ask again" }).click();
    await expect(prompt).toHaveCount(0);
    await expect(popup(page)).toBeVisible({ timeout: 6_000 });
  });

  test("the console's dark skin changes nothing about it", async ({ page }) => {
    await answerWith(page, LIVE);
    await openReview(page, "/app");
    await page.evaluate(() => document.documentElement.setAttribute("data-tnx-skin", "dark"));
    await page.waitForTimeout(2_200);
    await expect(joinLink(page)).toHaveCSS("background-color", "rgb(88, 101, 242)");
    await shot(page, "console-dark");
  });

  test("God's eye view never shows it, even when a review asks for it", async ({ page }) => {
    await answerWith(page, LIVE);
    await page.goto("/eye?discord=1");
    await page.waitForSelector("main[data-eye-state]", { timeout: 60_000 });
    await page.waitForTimeout(6_000);
    await expect(popup(page)).toHaveCount(0);
  });
});

test.describe("reduced motion", () => {
  test("nothing moves, and the number is already there", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await answerWith(page, LIVE);
    await openReview(page);
    const moving = await page.evaluate(() =>
      document.getAnimations().filter((a) => {
        const el = (a.effect as KeyframeEffect | null)?.target as Element | null;
        return Boolean(el?.closest(".tn-join")) && a.playState === "running";
      }).length,
    );
    expect(moving).toBe(0);
    await expect(page.locator(".tn-join-flash")).toBeHidden();
    await expect(page.locator(".tn-join-ring").first()).toBeHidden();
    await shot(page, "reduced-motion");
  });
});
