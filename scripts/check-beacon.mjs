#!/usr/bin/env node
// scripts/check-beacon.mjs
//
// What does the analytics beacon really send? This drives a real browser and reads the
// requests the page makes to PostHog, so the answer does not depend on reading Beacon.tsx.
//
//   node scripts/check-beacon.mjs                          production
//   node scripts/check-beacon.mjs http://localhost:3111    a local server, started with
//                                                          NEXT_PUBLIC_POSTHOG_KEY set
//
// WHY IT EXISTS. PR #236 listed these checks as steps for a person to do in a browser after
// the deploy. Nobody did them, and for 19 days every full page load sent two page views
// without anyone seeing it. A check that is a command gets run.
//
// NOTHING REACHES POSTHOG. Every request to a posthog.com host is answered here, inside the
// browser, so a run adds no visitor to the real numbers, on production or anywhere else.
//
// IT OPENS A WINDOW, AND IT HAS TO. posthog-js drops every event from a browser that names
// itself HeadlessChrome. A headless run sees no events at all, so it would fail each check
// below for a reason that has nothing to do with the site.
//
// It reads only. It writes no file, and nothing the site serves imports it.

import { chromium } from "@playwright/test";
import { gunzipSync } from "node:zlib";

const BASE = (process.argv[2] || "https://provenance-online.com").replace(/\/$/, "");
const PATH = "/privacy";
const DAY_MS = 86_400_000;

/** posthog-js sends gzip, plain JSON or base64 in a form field, by version and config. */
function decode(buf) {
  if (!buf) return [];
  const attempts = [
    () => JSON.parse(gunzipSync(buf).toString("utf8")),
    () => JSON.parse(buf.toString("utf8")),
    () => {
      const m = /(?:^|&)data=([^&]+)/.exec(buf.toString("utf8"));
      return JSON.parse(Buffer.from(decodeURIComponent(m[1]), "base64").toString("utf8"));
    },
  ];
  for (const attempt of attempts) {
    try {
      const body = attempt();
      const list = Array.isArray(body) ? body : (body?.batch ?? [body]);
      return list.filter((e) => e && typeof e.event === "string");
    } catch {
      /* try the next shape */
    }
  }
  return [];
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (date) => Date.parse(`${date}T00:00:00Z`);
/** The Monday of the week a date is in. Written again here on purpose: a check that
 *  imported weekStart() from the site would agree with it even when it is wrong. */
function monday(date) {
  const n = Math.round(dayMs(date) / DAY_MS);
  return iso((n - ((((n + 3) % 7) + 7) % 7)) * DAY_MS);
}

const events = [];
let failed = 0;
function check(label, ok, detail = "") {
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  (${detail})` : ""}`);
}
const named = (from, name) => events.slice(from).filter((e) => e.event === name);
const kind = (e) => `${e?.properties?.visit_kind}/${e?.properties?.return_gap}`;

async function newContext(browser, { hidden = false } = {}) {
  const context = await browser.newContext({ timezoneId: "Europe/London", locale: "en-GB" });
  await context.addInitScript((startHidden) => {
    // A switch for the "page is hidden" check. A real browser sets this itself.
    window.__hidden = startHidden;
    Object.defineProperty(document, "visibilityState", { get: () => (window.__hidden ? "hidden" : "visible") });
  }, hidden);
  await context.route(/^https:\/\/[^/]*posthog\.com\//, async (route) => {
    const request = route.request();
    const headers = {
      "access-control-allow-origin": request.headers().origin ?? "*",
      "access-control-allow-credentials": "true",
      "access-control-allow-headers": "*",
    };
    if (request.method() === "POST") events.push(...decode(request.postDataBuffer()));
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const script = request.resourceType() === "script";
    return route.fulfill({
      status: 200,
      headers,
      contentType: script ? "application/javascript" : "application/json",
      body: script ? "" : "{}",
    });
  });
  return context;
}

/** posthog-js sends in batches a few seconds apart. Wait for the batch, then for a late double. */
async function settle(page, from, name) {
  for (let i = 0; i < 40 && named(from, name).length === 0; i++) await page.waitForTimeout(500);
  await page.waitForTimeout(4_000);
}

const browser = await chromium.launch({
  headless: false,
  args: ["--disable-blink-features=AutomationControlled", "--window-size=900,700"],
});
console.log(`check-beacon: ${BASE}${PATH}\n`);

// ── A clean browser ──────────────────────────────────────────────────────────────────
const context = await newContext(browser);
const page = await context.newPage();
let from = events.length;
await page.goto(BASE + PATH, { waitUntil: "domcontentloaded", timeout: 90_000 });
await settle(page, from, "$pageview");
const today = await page.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
});
let views = named(from, "$pageview");
let visits = named(from, "visit");
check("first load sends one page view", views.length === 1, `${views.length} sent`);
check("it carries visit_kind new", kind(views[0]) === "new/none", kind(views[0]));
check("first load sends one visit event", visits.length === 1, `${visits.length} sent`);
check("the visit is new, with this week as its cohort", kind(visits[0]) === "new/none" && visits[0]?.properties?.cohort_week === monday(today), `${kind(visits[0])} cohort_week=${visits[0]?.properties?.cohort_week}, want ${monday(today)}`);
const record = await page.evaluate(() => localStorage.getItem("tn.visit.v1"));
check("the two dates are kept in the browser", record === JSON.stringify({ v: 1, d: { first: today, last: today } }), record ?? "nothing stored");
const cookies = await context.cookies(BASE);
check("no cookie is set", cookies.length === 0, cookies.map((c) => c.name).join(", "));

from = events.length;
await page.reload({ waitUntil: "domcontentloaded" });
await settle(page, from, "$pageview");
views = named(from, "$pageview");
check("a reload sends one page view, still new", views.length === 1 && kind(views[0]) === "new/none", `${views.length} sent, ${kind(views[0])}`);
check("a reload sends no visit event", named(from, "visit").length === 0);

from = events.length;
await page.evaluate(() => history.pushState(null, "", "?check=1"));
await settle(page, from, "$pageview");
check("a route change sends one page view", named(from, "$pageview").length === 1, `${named(from, "$pageview").length} sent`);

// ── The day changes while the tab stays open ─────────────────────────────────────────
// The stored dates are moved back, which is what a later day looks like to the page. Eight
// days is always an earlier week, so the cohort week must be sent whatever today is.
const first = iso(dayMs(today) - 10 * DAY_MS);
const last = iso(dayMs(today) - 8 * DAY_MS);
from = events.length;
await page.evaluate((d) => {
  localStorage.setItem("tn.visit.v1", JSON.stringify({ v: 1, d }));
  document.dispatchEvent(new Event("visibilitychange"));
  document.dispatchEvent(new Event("visibilitychange"));
}, { first, last });
await settle(page, from, "visit");
visits = named(from, "visit");
check("an open tab is counted again on a later day, once", visits.length === 1 && kind(visits[0]) === "returning/8_30d", `${visits.length} sent, ${kind(visits[0])}`);
check("in a new week it sends the week of the FIRST visit", visits[0]?.properties?.cohort_week === monday(first), `cohort_week=${visits[0]?.properties?.cohort_week}, want ${monday(first)}`);

// ── A second tab on the same day ─────────────────────────────────────────────────────
from = events.length;
const second = await context.newPage();
await second.goto(BASE + PATH, { waitUntil: "domcontentloaded" });
await settle(second, from, "$pageview");
views = named(from, "$pageview");
check("a second tab is returning/same_day", views.length === 1 && kind(views[0]) === "returning/same_day", `${views.length} sent, ${kind(views[0])}`);
check("a second tab sends no visit event", named(from, "visit").length === 0);
await context.setOffline(true);
await context.close();

// ── A page that is loaded but not shown ──────────────────────────────────────────────
const background = await newContext(browser, { hidden: true });
const hiddenPage = await background.newPage();
from = events.length;
await hiddenPage.goto(BASE + PATH, { waitUntil: "domcontentloaded" });
await settle(hiddenPage, from, "$pageview");
const stored = await hiddenPage.evaluate(() => localStorage.getItem("tn.visit.v1"));
check("a hidden page sends no visit and stores no dates", named(from, "visit").length === 0 && stored === null, `${named(from, "visit").length} sent, stored=${stored}`);
await hiddenPage.evaluate(() => {
  window.__hidden = false;
  document.dispatchEvent(new Event("visibilitychange"));
});
await settle(hiddenPage, from, "visit");
visits = named(from, "visit");
check("it is counted when it is shown", visits.length === 1 && kind(visits[0]) === "new/none", `${visits.length} sent, ${kind(visits[0])}`);
await background.setOffline(true);
await background.close();
await browser.close();

console.log(failed === 0 ? "\ncheck-beacon: all checks passed" : `\ncheck-beacon: ${failed} check(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
