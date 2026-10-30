import { test, expect, type Page } from "@playwright/test";

/**
 * The Streets area controls (Leon, 2026-10-29): the filled "New area" button with its
 * restart mark, the undo note it leaves behind, and the area card in the map's
 * bottom-left with an amber edge that fades up once.
 *
 * Getting a wall needs real cameras: the test draws a circle on the map and waits for
 * tiles. The keyless San Diego feeds sometimes return nothing; then the tests that need a
 * wall SKIP, with that reason, rather than fail for a reason that is not ours.
 */

// Copied from camslot-shots.spec.ts, for the reason given there: the launch sequence is a
// `position:fixed; inset:0` layer, so without this a click lands on the plate.
test.beforeEach(async ({ page }) => {
  // A wall needs the map ready, the camera layer loaded and a drawn circle: a slow machine
  // can spend most of the default 30 s on that alone.
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  });
});

async function setSkin(page: Page, skin: "light" | "dark") {
  await page.evaluate((s) => {
    if (s === "dark") document.documentElement.setAttribute("data-tnx-skin", "dark");
    else document.documentElement.removeAttribute("data-tnx-skin");
  }, skin);
}

async function openStreets(page: Page, url = "/app") {
  await page.goto(url);
  const streets = page.getByRole("button", { name: /STREETS board/ });
  await streets.click();
  await expect(streets).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".tn-streets-prompt")).toBeVisible();
}

/** Press "Draw an area", drag a circle from the map's centre, and wait for tiles.
 *  Returns false when none landed. The camera layer fills a moment after the map loads,
 *  so a circle drawn too early finds nothing and says so ("No cameras in that area."):
 *  that is retried a few times before it is called a failure. */
async function drawWall(page: Page): Promise<boolean> {
  const draw = page.getByRole("button", { name: "Draw an area" });
  const hint = page.locator(".tn-streets-prompt-s", { hasText: "Press on the map" });
  for (let attempt = 0; attempt < 4; attempt++) {
    // The first press can land before the map instance is registered; press again.
    await expect(async () => {
      if ((await hint.count()) === 0) await draw.click({ timeout: 1000 });
      await expect(hint).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 20_000 });
    const stage = (await page.locator(".tn-cw-stage").boundingBox())!;
    const cx = stage.x + stage.width / 2;
    const cy = stage.y + stage.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 180, cy, { steps: 12 });
    await page.mouse.up();
    try {
      await page.locator(".tn-seg-slot").first().waitFor({ state: "attached", timeout: 5_000 });
      return true;
    } catch {
      await page.waitForTimeout(4_000);
    }
  }
  return false;
}

async function wallOrSkip(page: Page, url = "/app") {
  await openStreets(page, url);
  const ok = await drawWall(page);
  test.skip(!ok, "No camera tiles landed: the keyless San Diego feeds returned nothing.");
}

/** Distinct cameras in the saved board, which is the number the note must say. */
async function camerasOnBoard(page: Page): Promise<number> {
  return page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("tn.console.v1") || "{}").d || {};
    const keys = new Set<string>();
    for (const w of d.widgets || []) {
      for (const s of (w.config || {}).streams || []) keys.add(s.k === "yt" ? "yt:" + s.videoId : s.k + ":" + s.id);
    }
    return keys.size;
  });
}

/** The board as the user sees and saves it: tile order, each tile's grid area, the ring,
 *  and the dock state. */
async function boardState(page: Page) {
  return page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("tn.console.v1") || "{}").d || {};
    return {
      order: [...document.querySelectorAll<HTMLElement>(".tn-seg-slot[data-grid-id]")].map(
        (e) => e.getAttribute("data-grid-id") + "|" + e.style.gridArea,
      ),
      ids: (d.widgets || []).map((w: { id: string }) => w.id),
      rects: (d.widgets || []).map((w: { rect: unknown }) => w.rect),
      watch: d.watch ?? null,
      dock: d.segments?.right?.collapsed ?? null,
    };
  });
}

const newArea = (page: Page) => page.locator(".tn-wall-btn.is-new-area");
const note = (page: Page) => page.locator(".tn-streets-undo");

test.describe("with a drawn wall", () => {
  test("New area is the filled accent button with the restart mark, in both skins", async ({ page }) => {
    await wallOrSkip(page);
    const btn = newArea(page);
    await expect(btn.locator("svg")).toHaveCount(1);
    await expect(btn).toContainText("New area");
    await expect(btn).toHaveAccessibleName("New area");
    for (const skin of ["light", "dark"] as const) {
      await setSkin(page, skin);
      const [bg, accent, ink, onAccent] = await btn.evaluate((el) => {
        // Resolve a token (a hex in either skin) to the rgb() form the computed style reports.
        const probe = document.createElement("i");
        el.appendChild(probe);
        const rgb = (token: string) => {
          probe.style.color = getComputedStyle(el).getPropertyValue(token);
          return getComputedStyle(probe).color;
        };
        const out = [getComputedStyle(el).backgroundColor, rgb("--tnx-accent"), getComputedStyle(el).color, rgb("--tnx-on-accent")];
        probe.remove();
        return out;
      });
      expect(bg, `${skin} background`).toBe(accent);
      expect(ink, `${skin} ink`).toBe(onAccent);
    }
  });

  test("one click clears at once and the note says how many cameras", async ({ page }) => {
    await wallOrSkip(page);
    const n = await camerasOnBoard(page);
    expect(n).toBeGreaterThan(0);
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await expect(note(page).locator(".tn-undo-msg")).toHaveText(`${n} cameras cleared.`);
    await expect(note(page).locator(".tn-undo-act")).toHaveText("Click to undo.");
    // The live region holds the same sentence, a tick later.
    await expect(note(page).locator('[role="status"]')).toHaveText(`${n} cameras cleared.`);
    await expect(note(page).locator(".tn-undo-x")).toHaveAccessibleName("Close");
    await expect(page.locator(".tn-seg-slot")).toHaveCount(0);
    await expect(page.locator(".tn-toast")).not.toContainText("Board cleared — draw an area to fill it again.");
    // Mouse click: focus stays off the note, or it would wait for ever.
    await expect(note(page).locator(".tn-undo-act")).not.toBeFocused();
  });

  test("Click to undo puts back the tiles, their order, sizes, ring and dock", async ({ page }) => {
    await wallOrSkip(page);
    // A closed dock is the state clearing forces open, so it proves the dock comes back too.
    await page.getByRole("button", { name: "Map", exact: true }).click();
    const n = await camerasOnBoard(page);
    const before = await boardState(page);
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await note(page).locator(".tn-undo-act").click();
    await expect(note(page)).toHaveCount(0);
    await expect(page.locator(".tn-seg-slot")).toHaveCount(before.order.length);
    await expect.poll(() => boardState(page)).toEqual(before);
    await expect(page.locator(".tn-toast")).toHaveText(`${n} cameras restored.`);
    // And it is used up.
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
  });

  test("keyboard: Enter moves focus to the note, Enter again undoes and returns focus; Escape closes", async ({ page }) => {
    await wallOrSkip(page);
    const before = await boardState(page);
    await newArea(page).focus();
    await page.keyboard.press("Enter");
    await expect(note(page).locator(".tn-undo-act")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(note(page)).toHaveCount(0);
    await expect.poll(() => boardState(page)).toEqual(before);
    await expect(newArea(page)).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(note(page).locator(".tn-undo-act")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(note(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Draw an area" })).toBeFocused();
    // Escape closes the note and nothing else: the board stays cleared.
    await expect(page.locator(".tn-seg-slot")).toHaveCount(0);
  });

  test("the x closes the note and leaves the board cleared", async ({ page }) => {
    await wallOrSkip(page);
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await note(page).locator(".tn-undo-x").click();
    await expect(note(page)).toHaveCount(0);
    await expect(page.locator(".tn-seg-slot")).toHaveCount(0);
  });

  test("drawing a new area drops the undo, and New area then offers the NEW board", async ({ page }) => {
    await wallOrSkip(page);
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    const landed = await drawWall(page);
    test.skip(!landed, "The second area drew no tiles.");
    await expect(note(page)).toHaveCount(0);
    const second = await boardState(page);
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await note(page).locator(".tn-undo-act").click();
    await expect.poll(() => boardState(page)).toEqual(second);
  });

  test("switching board drops the undo", async ({ page }) => {
    await wallOrSkip(page);
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await page.getByRole("button", { name: /GLOBE board/ }).click();
    await expect(page.getByRole("button", { name: /GLOBE board/ })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: /STREETS board/ }).click();
    await expect(page.locator(".tn-streets-prompt")).toBeVisible();
    await expect(note(page)).toHaveCount(0);
  });
});

test.describe("the note's clock", () => {
  test("goes after ten seconds, waits while hovered, and a mouse click does not hold it", async ({ page }) => {
    await page.clock.install();
    await wallOrSkip(page);

    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await page.clock.fastForward(9_000);
    await expect(note(page)).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect(note(page)).toHaveCount(0);

    // Hovering holds it.
    await page.getByRole("button", { name: "Draw an area" }).waitFor();
    const before = await boardState(page);
    expect(before.order).toEqual([]);
    const landed = await drawWall(page);
    test.skip(!landed, "The second area drew no tiles.");
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await note(page).hover();
    await page.clock.fastForward(15_000);
    await expect(note(page)).toBeVisible();
    // Leaving lets the remaining time run out.
    await page.mouse.move(700, 300);
    await page.clock.fastForward(11_000);
    await expect(note(page)).toHaveCount(0);
  });
});

test.describe("the card", () => {
  test("glows amber, fades up once and holds; reduced motion is steady from the first frame", async ({ page }) => {
    await openStreets(page);
    const card = page.locator(".tn-streets-prompt");
    const read = () =>
      card.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { name: cs.animationName, count: cs.animationIterationCount, shadow: cs.boxShadow };
      });
    const live = await read();
    expect(live.name).toBe("tn-streets-glow-in");
    expect(live.count).toBe("1");
    // It is mid-fade when it first paints; it holds the amber once the 0.4 s has run.
    await expect
      .poll(async () => (await read()).shadow, { timeout: 3000 })
      .toMatch(/^rgba\(255, 176, 32, 0\.45\) 0px 0px 0px 1px, rgba\(255, 176, 32, 0\.42\) 0px 0px 16px 1px/);
    // ...and it is a one-shot: the name stays, the shadow does not move again.
    const settled = (await read()).shadow;
    await page.waitForTimeout(700);
    expect((await read()).shadow).toBe(settled);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStreets(page);
    const still = await read();
    expect(still.name).toBe("none");
    expect(still.shadow).toMatch(/rgba?\(255, 176, 32/);
  });
});

type Sweep = { w: number; h: number; sources: boolean };
const SWEEP: Sweep[] = [
  { w: 360, h: 780, sources: false },
  { w: 390, h: 780, sources: false },
  { w: 390, h: 780, sources: true },
  { w: 900, h: 900, sources: false },
  { w: 900, h: 900, sources: true },
  { w: 1240, h: 900, sources: false },
  { w: 1240, h: 900, sources: true },
  { w: 1440, h: 900, sources: false },
  { w: 1440, h: 900, sources: true },
];

type Rect = { left: number; top: number; right: number; bottom: number };

for (const s of SWEEP) {
  test(`the card sits bottom-left and clear of everything at ${s.w}${s.sources ? " with Sources open" : ""}`, async ({ page }) => {
    await page.setViewportSize({ width: s.w, height: s.h });
    await openStreets(page, s.sources ? "/app?sources=open" : "/app");
    await page.locator(".tn-streets-corner").waitFor();
    await page.waitForTimeout(600); // the glow's one-shot, and the stage settling

    for (const skin of ["light", "dark"] as const) {
      await setSkin(page, skin);
      const m = await page.evaluate(() => {
        const r = (el: Element | null): Rect | null => {
          if (!el) return null;
          const b = el.getBoundingClientRect();
          return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        };
        const pill = document.querySelector(".tnx-stage-foot .tn-worldclock");
        const pillShown = !!pill && getComputedStyle(pill).display !== "none" && (pill as HTMLElement).offsetWidth > 0;
        const corner = document.querySelector(".tn-streets-corner")!;
        const cr = corner.getBoundingClientRect();
        const hit = document.elementFromPoint((cr.left + cr.right) / 2, (cr.top + cr.bottom) / 2);
        return {
          vw: window.innerWidth,
          corner: r(corner)!,
          stage: r(document.querySelector(".tn-cw-stage"))!,
          pill: pillShown ? r(pill) : null,
          attribution: r(document.querySelector(".maplibregl-ctrl-bottom-right")),
          under: hit ? !!hit.closest(".tn-rail") : false,
        };
      });
      const tag = `${skin} ${s.w}`;
      const stageLeft = Math.max(m.stage.left, 0);
      expect(m.corner.left, `${tag} left`).toBeGreaterThanOrEqual(12);
      expect(m.corner.right, `${tag} right`).toBeLessThanOrEqual(m.vw - 12);
      expect(Math.abs(m.corner.left - stageLeft - 12), `${tag} 12px in`).toBeLessThanOrEqual(1);
      if (m.pill) {
        expect(m.corner.bottom, `${tag} above the clock`).toBeLessThanOrEqual(m.pill.top - 8);
      } else {
        expect(Math.abs(m.stage.bottom - m.corner.bottom - 12), `${tag} 12px up`).toBeLessThanOrEqual(1);
      }
      const clash = (a: Rect | null) =>
        !!a && !(m.corner.right <= a.left || a.right <= m.corner.left || m.corner.bottom <= a.top || a.bottom <= m.corner.top);
      expect(clash(m.pill), `${tag} clock`).toBe(false);
      expect(clash(m.attribution), `${tag} map credit`).toBe(false);
      // Q5: on a phone the open Sources sheet is drawn over the card.
      if (s.sources && s.w <= 900) expect(m.under, `${tag} under the Sources sheet`).toBe(true);
    }
  });
}

test("the card rises above the Discord note while it shows, and drops back after No thanks", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStreets(page, "/app?discord=1");
  const noteEl = page.locator(".tn-note");
  await noteEl.waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500); // its entrance slides; the card measures after it settles
  const rects = () =>
    page.evaluate(() => {
      const r = (s: string) => {
        const b = document.querySelector(s)!.getBoundingClientRect();
        return { top: b.top, bottom: b.bottom };
      };
      const clear = parseFloat(getComputedStyle(document.querySelector(".tn-cw-stage")!).getPropertyValue("--tnx-stage-foot-clear"));
      return { corner: r(".tn-streets-corner"), note: document.querySelector(".tn-note") ? r(".tn-note") : null, stage: r(".tn-cw-stage"), clear: Number.isFinite(clear) ? clear : 46 };
    });
  const up = await rects();
  expect(Math.abs(up.note!.top - up.corner.bottom - 12)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "No thanks" }).click();
  await expect(noteEl).toHaveCount(0);
  await expect
    .poll(async () => {
      const d = await rects();
      return Math.abs(d.stage.bottom - d.corner.bottom - d.clear);
    })
    .toBeLessThanOrEqual(1);
});

test("the lift follows the Sources pane opening and closing under a note that is already up", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openStreets(page, "/app?discord=1&sources=open");
  await page.locator(".tn-note").waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  const gap = () =>
    page.evaluate(() => {
      const stage = document.querySelector(".tn-cw-stage")!.getBoundingClientRect();
      const corner = document.querySelector(".tn-streets-corner")!.getBoundingClientRect();
      const note = document.querySelector(".tn-note")!.getBoundingClientRect();
      return { fromStage: Math.round(stage.bottom - corner.bottom), overlaps: corner.left < note.right && corner.bottom > note.top };
    });
  // Sources open: the stage starts right of the note, so the card stays on its normal floor.
  await expect.poll(async () => (await gap()).overlaps).toBe(false);
  const open = await gap();
  await page.getByRole("button", { name: "Close sources" }).click();
  // Closed: the stage now lies under the note, and the card rises clear of it.
  await expect.poll(async () => (await gap()).fromStage).toBeGreaterThan(open.fromStage + 100);
  expect((await gap()).overlaps).toBe(false);
});

test("shots", async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await wallOrSkip(page);
  const shoot = async (name: string) => page.screenshot({ path: `persona-shots/streets-area-${name}.png` });

  for (const w of [1440, 390] as const) {
    await page.setViewportSize({ width: w, height: w === 1440 ? 900 : 780 });
    await page.waitForTimeout(800);
    for (const skin of ["light", "dark"] as const) {
      await setSkin(page, skin);
      await page.waitForTimeout(300);
      await shoot(`wall-${w}-${skin}`);
    }
    await setSkin(page, "light");
    await newArea(page).click();
    await expect(note(page)).toBeVisible();
    await page.waitForTimeout(700);
    for (const skin of ["light", "dark"] as const) {
      await setSkin(page, skin);
      await page.waitForTimeout(300);
      await shoot(`${w}-${skin}`);
    }
    await setSkin(page, "light");
    await note(page).locator(".tn-undo-act").click();
    await expect(note(page)).toHaveCount(0);
  }
});
