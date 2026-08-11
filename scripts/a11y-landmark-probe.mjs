// Landmark / heading / live-region probe.
//
//   node scripts/a11y-landmark-probe.mjs http://127.0.0.1:3981
//
// Measures exactly the properties the accessibility judge measured (1440x900),
// with the first-run tour pre-dismissed so its modal veil does not sit over the
// page and swallow the skip-link hit test. Also drives the skip link with a real
// keyboard (Tab, Enter) and reports document.activeElement afterwards.
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://127.0.0.1:3981";
const settle = Number(process.argv[3] || 9000);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try {
    localStorage.setItem("tn.tour.v1", JSON.stringify({ v: 1, d: { seenVersion: 1 } }));
  } catch {}
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(settle);

// Confirm the stylesheet we are measuring against is real, not a stale chunk ref.
const css = await page.evaluate(async () => {
  const link = [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.href);
  const out = [];
  for (const href of link) {
    const r = await fetch(href);
    out.push({ href: href.split("/").pop(), status: r.status, bytes: (await r.text()).length });
  }
  return out;
});

const dom = await page.evaluate(() => {
  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label) return label.trim();
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent?.trim() || "").join(" ");
      if (t) return t;
    }
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70);
  };
  const live = [...document.querySelectorAll("[aria-live]")].map((el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className && typeof el.className === "string" ? el.className : "",
    value: el.getAttribute("aria-live"),
    role: el.getAttribute("role"),
    atomic: el.getAttribute("aria-atomic"),
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60),
  }));
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((el) => ({
    level: Number(el.tagName[1]),
    text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
    hidden: getComputedStyle(el).clipPath === "inset(50%)" || el.classList.contains("tn-sr-only"),
  }));
  const navs = [...document.querySelectorAll('nav, [role="navigation"]')].map((el) => ({
    tag: el.tagName.toLowerCase(),
    name: nameOf(el),
  }));
  const banners = document.querySelectorAll('header, [role="banner"]').length;
  const mains = document.querySelectorAll('main, [role="main"]').length;
  const skip = [...document.querySelectorAll("a[href^='#']")]
    .filter((a) => /skip/i.test(a.textContent || "") || /skip/i.test(a.className || ""))
    .map((a) => ({ text: (a.textContent || "").trim(), href: a.getAttribute("href"), cls: a.className }));
  // Guard the properties OpenData already wins on, so an accessibility fix cannot
  // quietly cost focusability or accessible names somewhere else.
  const FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const focusables = [...document.querySelectorAll(FOCUSABLE)].filter((el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden";
  });
  const unnamed = focusables
    .filter((el) => !nameOf(el) && !el.getAttribute("title"))
    .map((el) => `${el.tagName.toLowerCase()}.${(el.className || "").toString().split(" ")[0]}`);

  return {
    focusableCount: focusables.length,
    unnamedFocusables: unnamed,
    liveCount: live.length,
    live,
    h1Count: headings.filter((h) => h.level === 1).length,
    headingCount: headings.length,
    headings,
    navCount: navs.length,
    navs,
    banners,
    mains,
    skipLinks: skip,
  };
});

// --- skip-link behaviour: real keyboard drive -------------------------------
let skipResult = { attempted: false };
if (dom.skipLinks.length > 0) {
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a?.tagName.toLowerCase(),
      text: (a?.textContent || "").trim().slice(0, 40),
      visible: a ? a.getBoundingClientRect().top > -100 : false,
      rect: a ? JSON.parse(JSON.stringify(a.getBoundingClientRect())) : null,
    };
  });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a?.tagName.toLowerCase(),
      id: a?.id || null,
      cls: typeof a?.className === "string" ? a.className : "",
      label: a?.getAttribute("aria-label") || a?.getAttribute("aria-labelledby") || null,
    };
  });
  skipResult = { attempted: true, firstTabStop: first, activeElementAfterEnter: after };
}

console.log(JSON.stringify({ url, css, ...dom, skipResult }, null, 2));
await browser.close();
