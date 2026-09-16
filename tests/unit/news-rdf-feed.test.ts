import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { parseRss } from "@/lib/news";

/**
 * RSS 1.0 (RDF), which is what DW serves, and the one shape the entry regex got wrong.
 *
 * WHY THIS FIXTURE IS VERBATIM. An RDF channel opens with an `<items><rdf:Seq>` table
 * of contents, and `<(item|entry)` matches the `<item` in `<items>`. The lazy body then
 * ran to the first `</item`, which is inside `</items>`, so the first parsed "entry"
 * spanned the Seq, the closing `</channel>`, the feed's own `<image>` element and the
 * first real story.
 *
 * The visible symptom was a headline reading "DW" on the board, taken from the image
 * title. The symptom that mattered was invisible: the feed's FIRST STORY was eaten on
 * every refresh, and no test, count or log could have shown it — a feed that serves 12
 * of its 13 items is indistinguishable from a feed that has 12. That is the whole
 * reason this file holds the real element order rather than a tidied-up minimum.
 */
const RDF = readFileSync(join(process.cwd(), "tests/fixtures/dw-rdf-items-seq.xml"), "utf8");

describe("an RDF feed whose channel carries an <items> table of contents", () => {
  test("parses every story, including the first one", () => {
    const items = parseRss(RDF, "DW");
    expect(items.map((i) => i.title)).toEqual([
      "Kosovo ex-president Thaci sentenced to 25 years for war crimes",
      "Turkey's rights groups, EU call out LGBTQ+ crackdown",
    ]);
  });

  // The half of the bug anyone could see. The other half is pinned by the count above.
  test("never lifts the feed's own image or channel title into a headline", () => {
    const items = parseRss(RDF, "DW");
    expect(items.some((i) => i.title === "DW")).toBe(false);
    expect(items.some((i) => i.url.includes("/english/?maca="))).toBe(false);
    expect(items.some((i) => i.title.includes("Deutsche Welle"))).toBe(false);
  });

  test("reads dc:date, which is the only date an RDF item carries", () => {
    const [first] = parseRss(RDF, "DW");
    expect(first.ts).toBe(Date.parse("2026-09-16T09:52:00Z"));
  });

  // `<items>` is the case that bit; these are the neighbours that would bite next.
  test("a tag that merely starts with item or entry is not an entry", () => {
    expect(parseRss("<itemized><title>No</title><link>https://x.test/a</link></itemized>", "X")).toEqual([]);
    expect(parseRss("<entryway><title>No</title><link>https://x.test/b</link></entryway>", "X")).toEqual([]);
  });

  test("a self-closing entry reference does not open a block", () => {
    const xml =
      '<rdf:RDF><item rdf:resource="https://x.test/ref"/>' +
      "<item><title>Real</title><link>https://x.test/real</link></item></rdf:RDF>";
    expect(parseRss(xml, "X").map((i) => i.title)).toEqual(["Real"]);
  });
});
