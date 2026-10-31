import { expect, test, type Page } from "@playwright/test";

/**
 * The landing page's main button, which offers a different place every few seconds
 * (components/marketing/CtaRotor.tsx, lib/marketing/ctaDeck.ts, lib/marketing/ctaTurn.ts).
 *
 * The pure half is in tests/unit/landing-cta-*.test.ts. This file holds what only a browser
 * can: that the characters really do go round, that a phrase never moves the button beside
 * it, that the button stops under a pointer, and that each kind of door opens what it says.
 *
 * `/#hero` skips the opening intro (INTRO_GATE_SCRIPT), except in the test about the intro.
 *
 * The gate does not run this file. See CLAUDE.md, "Build gate".
 */

const HERO = 'a[data-rotor="hero"]';
const REST_PLUS_TURN_MS = 5500;

const ready = (page: Page) => page.waitForFunction(() => !!window.__pvCta, null, { timeout: 30_000 });
const hero = (page: Page) => page.locator(HERO);
const label = (page: Page, which = "hero") => page.locator(`a[data-rotor="${which}"] .lp-rotor`);
const turns = (page: Page) => page.evaluate(() => window.__pvCta!.turns);

/** Wait until this button is in the middle of a turn. */
const turning = (page: Page, which = "hero") =>
  page.waitForFunction(
    (w) => document.querySelector(`a[data-rotor="${w}"] .lp-rotor`)?.hasAttribute("data-turning"),
    which,
    { timeout: 15_000, polling: 16 },
  );

test.describe("in Madrid", () => {
  test.use({ timezoneId: "Europe/Madrid", viewport: { width: 1440, height: 900 } });

  test("the served words turn into the visitor's own city, and the link goes with them", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await expect(hero(page)).toHaveAttribute("href", "/eye?place=madrid", { timeout: 8000 });
    await expect(label(page)).toHaveText("See Madrid in 3D", { timeout: 8000 });
    await expect(hero(page)).toHaveAttribute("aria-label", "See Madrid in 3D");
  });

  test("each changed character goes all the way round, and the words that stay do not", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await turning(page);
    const turn = await page.evaluate((sel) => {
      const root = document.querySelector(sel)!;
      const spins = [...root.querySelectorAll(".lp-rs")];
      const angles = spins.map((s) => {
        const a = s.getAnimations()[0];
        const k = (a.effect as KeyframeEffect).getKeyframes();
        return [k[0].transform, k[k.length - 1].transform];
      });
      return {
        cells: root.querySelectorAll(".lp-rc").length,
        spins: spins.length,
        first: angles[0],
        hidden: [...root.querySelectorAll(".lp-rc")].every((c) => c.getAttribute("aria-hidden") === "true"),
      };
    }, HERO);
    expect(turn.spins).toBeGreaterThan(0);
    expect(turn.spins).toBeLessThan(turn.cells);
    expect(turn.first[0]).toContain("rotateY(0deg)");
    expect(turn.first[1]).toContain("rotateY(360deg)");
    expect(turn.hidden).toBe(true);
  });

  test("between turns the words are one plain text node again", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await expect(label(page)).toHaveText("See Madrid in 3D", { timeout: 8000 });
    const shape = await label(page).evaluate((el) => ({
      nodes: el.childNodes.length,
      type: el.firstChild?.nodeType,
      turning: el.hasAttribute("data-turning"),
    }));
    expect(shape).toEqual({ nodes: 1, type: 3, turning: false });
  });

  test("a new phrase never moves the button, or the button beside it", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    const boxes = () =>
      page.evaluate((sel) => {
        const a = document.querySelector(sel)!.getBoundingClientRect();
        const b = document.querySelector('a[href="/app?sources=open"].lp-btn')!.getBoundingClientRect();
        return [a.x, a.width, b.x, b.width];
      }, HERO);
    const before = await boxes();
    const start = await turns(page);
    await page.waitForFunction((n) => window.__pvCta!.turns >= n + 2, start, { timeout: 20_000 });
    expect(await boxes()).toEqual(before);
  });

  test("only one button turns at a time, and the nav takes over past the hero", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await turning(page);
    await expect(label(page, "nav")).not.toHaveAttribute("data-turning", "");
    expect(await page.evaluate(() => window.__pvCta!.active())).toBe("hero");

    await page.evaluate(() => document.querySelector("#plates")!.scrollIntoView());
    await expect.poll(() => page.evaluate(() => window.__pvCta!.active())).toBe("nav");
    await turning(page, "nav");
    await expect(label(page, "hero")).not.toHaveAttribute("data-turning", "");

    await page.evaluate(() => document.querySelector(`a[data-rotor="close"]`)!.scrollIntoView({ block: "center" }));
    await expect.poll(() => page.evaluate(() => window.__pvCta!.active())).toBe("close");
    await turning(page, "close");
    await expect(label(page, "nav")).not.toHaveAttribute("data-turning", "");
  });

  test("it holds still under the pointer, so the words cannot change under a click", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await expect(label(page)).toHaveText("See Madrid in 3D", { timeout: 8000 });
    await page.waitForFunction(() => window.__pvCta!.turns >= 1);
    await hero(page).hover();
    // A turn that had already started finishes, then nothing starts.
    await page.waitForTimeout(1500);
    const words = await hero(page).getAttribute("aria-label");
    const href = await hero(page).getAttribute("href");
    const count = await turns(page);
    await page.waitForTimeout(REST_PLUS_TURN_MS);
    expect(await turns(page)).toBe(count);
    expect(await hero(page).getAttribute("aria-label")).toBe(words);
    expect(await hero(page).getAttribute("href")).toBe(href);

    await page.mouse.move(5, 5);
    await page.waitForFunction((n) => window.__pvCta!.turns > n, count, { timeout: 8000 });
  });

  test("it holds still under the keyboard too", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await hero(page).focus();
    await page.waitForTimeout(1500);
    const count = await turns(page);
    await page.waitForTimeout(REST_PLUS_TURN_MS);
    expect(await turns(page)).toBe(count);
  });

  test("the page still asks this site's API for nothing, and fetches no map", async ({ page }) => {
    const bad: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/api/") || /openfreemap|cartocdn|arcgisonline/.test(u.host)) bad.push(r.url());
    });
    await page.goto("/#hero");
    await ready(page);
    await page.waitForFunction(() => window.__pvCta!.turns >= 2, null, { timeout: 20_000 });
    expect(bad).toEqual([]);
  });

  test("the button opens the city it names, under its own name", async ({ page }) => {
    await page.goto("/#hero");
    await ready(page);
    await expect(hero(page)).toHaveAttribute("href", "/eye?place=madrid", { timeout: 8000 });
    await page.evaluate(() => window.__pvCta!.hold(true));
    await hero(page).click();
    await expect(page).toHaveURL(/\/eye\?place=madrid/);
    await expect(page.getByText("Madrid", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Madrid", level: 1 })).toBeVisible();
    await expect(page.getByText("Spain").first()).toBeVisible();
  });
});

test.describe("somewhere else", () => {
  test.describe("New York", () => {
    test.use({ timezoneId: "America/New_York", locale: "en-US" });
    test("leads with Manhattan, and offers North Carolina", async ({ page }) => {
      await page.goto("/#hero");
      await ready(page);
      const deck = await page.evaluate(() => window.__pvCta!.deck.map((d) => d.words));
      expect(deck[0]).toBe("See Manhattan in 3D");
      expect(deck).toContain("See North Carolina in 3D");
      await expect(label(page)).toHaveText("See Manhattan in 3D", { timeout: 8000 });
    });
  });

  test.describe("Tokyo", () => {
    test.use({ timezoneId: "Asia/Tokyo", locale: "ja-JP" });
    test("leads with Tokyo, and is not offered North Carolina", async ({ page }) => {
      await page.goto("/#hero");
      await ready(page);
      const deck = await page.evaluate(() => window.__pvCta!.deck.map((d) => d.words));
      expect(deck[0]).toBe("See Tokyo in 3D");
      expect(deck).not.toContain("See North Carolina in 3D");
    });
  });

  test.describe("London", () => {
    test.use({ timezoneId: "Europe/London" });
    test("rests on the served words first, then moves on", async ({ page }) => {
      await page.goto("/#hero");
      await ready(page);
      expect(await page.evaluate(() => window.__pvCta!.deck[0].words)).toBe("See London in 3D");
      // Read at once: the first turn comes a rest later, and a fixed wait here races it.
      expect(await hero(page).getAttribute("href")).toBe("/eye");
      expect(await turns(page)).toBe(0);
      await page.waitForFunction(() => window.__pvCta!.turns >= 1, null, { timeout: 8000 });
      await expect(hero(page)).not.toHaveAttribute("href", "/eye");
    });
  });
});

for (const { name, width, height } of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
  { name: "small phone", width: 360, height: 640 },
]) {
  test.describe(`at ${name} size`, () => {
    test.use({ viewport: { width, height } });

    test("every phrase on every list fits the button it can land on", async ({ page }) => {
      await page.goto("/#hero");
      await ready(page);
      const tooWide = await page.evaluate((sel) => {
        const label = document.querySelector(`${sel} .lp-rotor`) as HTMLElement;
        const probe = document.createElement("span");
        probe.className = "lp-rotor-probe";
        label.appendChild(probe);
        const out: string[] = [];
        for (const d of window.__pvCta!.deck) {
          probe.textContent = d.words;
          if (probe.getBoundingClientRect().width > label.clientWidth) out.push(d.words);
        }
        probe.remove();
        return out;
      }, HERO);
      expect(tooWide).toEqual([]);
    });

    test("the nav's button keeps inside the screen, whatever it lands on", async ({ page }) => {
      await page.goto("/#hero");
      await ready(page);
      await page.evaluate(() => window.scrollTo(0, innerHeight * 3));
      await turning(page, "nav");
      const fit = await page.evaluate(() => {
        const a = document.querySelector('a[data-rotor="nav"]')!.getBoundingClientRect();
        const b = document.querySelector(".lp-nav .lp-brand")!.getBoundingClientRect();
        return { right: a.right, left: a.left, brandRight: b.right, width: innerWidth, scroll: document.documentElement.scrollWidth };
      });
      expect(fit.right).toBeLessThanOrEqual(fit.width);
      expect(fit.left).toBeGreaterThanOrEqual(fit.brandRight);
      expect(fit.scroll).toBeLessThanOrEqual(fit.width);
    });
  });
}

test.describe("with reduced motion", () => {
  test.use({ timezoneId: "Europe/Madrid" });

  test("the button takes the visitor's first phrase once, and stays there", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(label(page)).toHaveText("See Madrid in 3D", { timeout: 15_000 });
    await expect(hero(page)).toHaveAttribute("href", "/eye?place=madrid");
    const anims = await page.evaluate(() => document.querySelector(".lp-rotor")!.getAnimations({ subtree: true }).length);
    expect(anims).toBe(0);
    await page.waitForTimeout(REST_PLUS_TURN_MS);
    await expect(label(page)).toHaveText("See Madrid in 3D");
  });
});

test.describe("with no script", () => {
  test.use({ javaScriptEnabled: false });

  test("the button is a plain link saying what it always said", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(HERO)).toHaveAttribute("href", "/eye");
    await expect(page.locator(`${HERO} .lp-rotor`)).toHaveText("See London in 3D");
  });
});

test.describe("the opening intro", () => {
  test.use({ timezoneId: "Europe/Madrid", viewport: { width: 1440, height: 900 } });

  test("nothing turns behind the curtain", async ({ page }) => {
    await page.goto("/?intro=always");
    await page.waitForFunction(() => !!window.__pvCta || !document.querySelector(".lp-intro[data-on]"), null, { timeout: 30_000 });
    const up = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".lp-intro");
      return Boolean(el?.hasAttribute("data-on")) && el?.dataset.phase !== "out";
    });
    if (up) expect(await turns(page)).toBe(0);
    await page.waitForFunction(() => (window.__pvCta?.turns ?? 0) >= 1, null, { timeout: 45_000 });
    const after = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>(".lp-intro");
      return !el?.hasAttribute("data-on") || el?.dataset.phase === "out";
    });
    expect(after).toBe(true);
  });
});

test.describe("the other kinds of door", () => {
  test("a board door opens that board", async ({ page }) => {
    await page.goto("/app?preset=news");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("tn.console.activePreset.v1") ?? ""), { timeout: 30_000 })
      .toContain("news");
  });

  test("a topic door turns on its layers", async ({ page }) => {
    await page.goto("/app?lat=15&lon=150&z=1.9&sig=earthquakes");
    // The console writes the view back to the address, and a layer it did not turn on
    // falls out of `sig` there.
    await expect.poll(() => new URL(page.url()).searchParams.get("sig"), { timeout: 30_000 }).toContain("earthquakes");
  });

  test("a topic door does not write over a returning visitor's saved layers", async ({ page }) => {
    await page.goto("/app");
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("tn.variant.v1")), { timeout: 30_000 })
      .not.toBeNull();
    await page.waitForTimeout(1500);
    const saved = await page.evaluate(() => localStorage.getItem("tn.variant.v1"));

    await page.goto("/app?lat=15&lon=150&z=1.9&sig=earthquakes");
    await expect.poll(() => new URL(page.url()).searchParams.get("sig"), { timeout: 30_000 }).toContain("earthquakes");
    await page.waitForTimeout(1500);
    const overrides = (raw: string | null) => JSON.parse(raw ?? "{}")?.data?.overrides ?? JSON.parse(raw ?? "{}")?.overrides;
    expect(overrides(await page.evaluate(() => localStorage.getItem("tn.variant.v1")))).toEqual(overrides(saved));
  });

  test("a browser with a saved board is not offered a door that writes layers", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("tn.variant.v1", JSON.stringify({ v: 1 })));
    await page.goto("/#hero");
    await ready(page);
    const words = await page.evaluate(() => window.__pvCta!.deck.map((d) => d.words));
    expect(words).not.toContain("See flights worldwide");
    expect(words).toContain("See today's earthquakes");
  });
});
