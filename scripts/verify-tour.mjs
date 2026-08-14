// Walk the guided tour end to end in a real browser and prove every step lands on
// something.
//
// The failure this exists to catch is specific and silent: the tour resolves its
// targets against the live DOM and drops a step whose target is missing, so a
// renamed class shortens the walkthrough with no error, no console warning and no
// failing unit test. That is how the previous tour shrank from eight steps to seven
// while still claiming to explain the console.
//
// tests/unit/tour.test.ts checks the selectors still exist in the SOURCE. This
// checks they still resolve at RUNTIME — including the ones that only exist after
// a step's setup actions have opened the surface they live in, which is most of
// them and exactly the part static analysis cannot see.
//
//   node scripts/verify-tour.mjs [baseUrl] [--shots <dir>]
//
// Exits non-zero if any step failed to spotlight a target, so it can gate a merge.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const baseUrl = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:3210";
const shotsFlag = process.argv.indexOf("--shots");
const shotsDir = shotsFlag > -1 ? process.argv[shotsFlag + 1] : null;
const widthFlag = process.argv.indexOf("--width");
const width = widthFlag > -1 ? Number(process.argv[widthFlag + 1]) : 1512;
const height = width < 700 ? 844 : 945;

// Steps that are framing cards BY DESIGN — a centred title card with no target.
// Listed by title so a missing ring on one of these reads as expected rather than
// as the defect above.
const FRAMING_TITLES = new Set([
  "Start with the shape of it",
  "The map is a tool, not a backdrop",
  "Six boards, each a job",
  "Four buttons, and what is behind them",
  "One rail, every source",
  "The part most of these tools skip",
  "One caveat worth reading",
  "Once you know your way around",
  "That is the whole console",
]);

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });

  // A first-ever visit for the TOUR, but not for the boot animation: the launch
  // sequence holds the screen for five seconds and would be the subject of every
  // early screenshot. Seeding only the boot flag leaves the tour's own first-run
  // path exactly as a real visitor meets it.
  await page.addInitScript(() => {
    try {
      window.localStorage.clear();
      window.localStorage.setItem("tn.terminal.boot.v1", JSON.stringify({ v: 1, d: { seenVersion: 99 } }));
    } catch { /* private mode */ }
  });

  await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
  // The console seeds its default board and then invites the tour ~900ms later;
  // the widgets have to have painted or there is nothing to spotlight.
  await page.waitForSelector(".tn-tour-card.is-menu", { timeout: 60_000 });

  if (shotsDir) {
    await mkdir(shotsDir, { recursive: true });
    await page.screenshot({ path: `${shotsDir}/tour-00-menu.png` });
  }

  const chapters = await page.locator(".tn-tour-chapter-title").allTextContents();
  console.log(`menu: ${chapters.length} chapters`);
  for (const c of chapters) console.log(`  · ${c}`);

  await page.locator(".tn-tour-btn.is-primary").click();
  await page.waitForSelector(".tn-tour-card:not(.is-menu)", { timeout: 15_000 });

  const seen = [];
  const misses = [];

  for (let i = 0; i < 200; i++) {
    // The card is repositioned after setup + measure; settle before reading it.
    await page.waitForTimeout(420);
    const card = page.locator(".tn-tour-card");
    if ((await card.count()) === 0) break;

    const title = (await page.locator(".tn-tour-title").first().textContent())?.trim() ?? "";
    const meta = (await page.locator(".tn-tour-count").first().textContent())?.trim() ?? "";
    const ringed = (await page.locator(".tn-tour-ring").count()) > 0;
    const framing = FRAMING_TITLES.has(title);

    const mark = ringed ? "◉" : framing ? "·" : "✗";
    console.log(`${mark} ${String(i + 1).padStart(2)} ${meta.replace(/\s+/g, " ")} — ${title}`);
    seen.push(title);
    if (!ringed && !framing) misses.push(`${title} (${meta.replace(/\s+/g, " ")})`);

    if (shotsDir) {
      await page.screenshot({ path: `${shotsDir}/tour-${String(i + 1).padStart(2, "0")}.png` });
    }

    const next = page.locator(".tn-tour-btn.is-primary");
    const label = (await next.textContent())?.trim();
    await next.click();
    if (label === "Done") break;
  }

  // The tour must put the app back: nothing it opened may be left on screen.
  await page.waitForTimeout(600);
  const leftOpen = [];
  for (const sel of [".tn-rail", ".tn-palette-root", ".tn-settings", ".tn-cw-menu-pop", ".tn-cw-notify-pop", ".tn-cw-help-pop"]) {
    if ((await page.locator(sel).count()) > 0) leftOpen.push(sel);
  }
  const stillUp = (await page.locator(".tn-tour").count()) > 0;

  await browser.close();

  console.log(`\n${seen.length} steps walked · ${misses.length} without a target`);
  if (misses.length) for (const m of misses) console.log(`  MISS ${m}`);
  if (leftOpen.length) console.log(`  LEFT OPEN ${leftOpen.join(", ")}`);
  if (stillUp) console.log("  TOUR DID NOT CLOSE");

  const ok = misses.length === 0 && leftOpen.length === 0 && !stillUp && seen.length > 30;
  console.log(ok ? "\nPASS" : "\nFAIL");
  process.exit(ok ? 0 : 1);
};

run().catch((err) => { console.error(err); process.exit(1); });
