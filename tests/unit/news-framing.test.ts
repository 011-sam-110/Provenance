import { expect, test } from "vitest";
import { compareFraming, framingTerms, markTerms } from "@/lib/news/framing";
import { clusterNews } from "@/lib/news/cluster";
import type { NewsItem } from "@/lib/news";

const T0 = 1_758_000_000_000;
const item = (title: string, source: string, description?: string, i = 0): NewsItem => ({
  title, source, description, url: `https://x/${source}/${i}`, ts: T0 - i * 60_000,
});

test("shared terms are the event, distinctive terms are the wording", () => {
  const items = [
    item("Israeli strike kills 12 militants in southern Lebanon", "The Jerusalem Post", undefined, 1),
    item("Israeli attack kills 12 fighters in southern Lebanon", "Al Jazeera", undefined, 2),
  ];
  const c = clusterNews(items)[0];
  expect(c.sourceCount).toBe(2);
  const f = compareFraming(c);
  expect(f.comparable).toBe(true);
  // Both outlets agree on the place and the actor.
  expect(f.shared).toContain("lebanon");
  expect(f.shared).toContain("southern");
  expect(f.shared).toContain("israeli");
  expect(f.shared).toContain("kills");
  // They do not agree on what happened or on who died.
  const jpost = f.bySource.find((s) => s.source === "The Jerusalem Post")!;
  const aj = f.bySource.find((s) => s.source === "Al Jazeera")!;
  expect(jpost.distinctive).toEqual(expect.arrayContaining(["strike", "militants"]));
  expect(aj.distinctive).toEqual(expect.arrayContaining(["attack", "fighters"]));
  // A term unique to one outlet is never also listed as shared.
  for (const t of f.shared) expect(jpost.distinctive).not.toContain(t);
});

test("one source filing three pieces is one column, not three", () => {
  const items = [
    item("Kashmir valley flood devastates villages after record rainfall", "Reuters", undefined, 1),
    item("Kashmir valley flood: rescue teams reach cut-off villages", "Reuters", undefined, 2),
    item("Kashmir valley flood leaves villages without power", "Reuters", undefined, 3),
    item("Kashmir valley flooding devastates villages following record rainfall", "BBC", undefined, 4),
  ];
  const c = clusterNews(items)[0];
  const f = compareFraming(c);
  expect(f.bySource).toHaveLength(2);
  expect(f.bySource.find((s) => s.source === "Reuters")!.items).toHaveLength(3);
  // "rescue" appears in one Reuters item only, but Reuters is still one source,
  // so it is distinctive to Reuters rather than shared by repetition.
  expect(f.bySource.find((s) => s.source === "Reuters")!.distinctive).toContain("rescue");
});

test("a single-source story has nothing to compare", () => {
  const c = clusterNews([item("A lone report from a single outlet today", "BBC")])[0];
  const f = compareFraming(c);
  expect(f.comparable).toBe(false);
  expect(f.shared).toEqual([]);
});

test("framingTerms drops structural filler and bare numbers", () => {
  const t = framingTerms(item("According to officials, 12 people died during the protest", "BBC"));
  expect(t.has("according")).toBe(false); // filler
  expect(t.has("during")).toBe(false); // filler
  expect(t.has("12")).toBe(false); // bare number
  expect(t.has("protest")).toBe(true);
  expect(t.has("officials")).toBe(true);
});

test("markTerms highlights in place, preserving the original text exactly", () => {
  const runs = markTerms("Israeli strike kills 12 militants.", ["strike", "militants"]);
  expect(runs.map((r) => r.text).join("")).toBe("Israeli strike kills 12 militants.");
  const marked = runs.filter((r) => r.mark).map((r) => r.text.trim());
  expect(marked).toEqual(["strike", "militants."]);
});

test("markTerms matches across case and punctuation", () => {
  const runs = markTerms("Strikes, again — strikes!", ["strikes"]);
  expect(runs.filter((r) => r.mark)).toHaveLength(2);
});
