// tests/unit/news-description.test.ts
import { describe, it, expect } from "vitest";
import { parseRss } from "@/lib/news";

const XML = `<rss><channel>
  <item>
    <title>Big story &amp; more</title>
    <link>https://www.bbc.com/news/world-123</link>
    <pubDate>Wed, 08 Jul 2026 08:00:00 GMT</pubDate>
    <description><![CDATA[<p>A short <b>summary</b> of the story.</p>]]></description>
  </item>
  <item>
    <title>No description here</title>
    <link>https://www.bbc.com/news/world-124</link>
  </item>
  <item>
    <title>Entity-encoded HTML body</title>
    <link>https://www.theguardian.com/politics/live/2026/jul/08/story</link>
    <description>&lt;p&gt;Lib Dems tell Reform UK leader &lt;a href="https://x.test"&gt;the game is up&lt;/a&gt;&lt;/p&gt;&lt;ul&gt;&lt;li&gt;More&lt;/li&gt;&lt;/ul&gt;</description>
  </item>
</channel></rss>`;

describe("parseRss description", () => {
  it("captures a cleaned <description> snippet", () => {
    const items = parseRss(XML, "BBC");
    expect(items[0].description).toBe("A short summary of the story.");
  });
  it("leaves description undefined when the item has none", () => {
    const items = parseRss(XML, "BBC");
    expect(items[1].description).toBeUndefined();
  });
  it("strips entity-encoded HTML tags (Guardian-style descriptions)", () => {
    const items = parseRss(XML, "The Guardian");
    // &lt;p&gt;… decodes to real <p>…</p> markup, which must not survive into the snippet.
    expect(items[2].description).toBe("Lib Dems tell Reform UK leader the game is up More");
    expect(items[2].description).not.toContain("<");
    expect(items[2].description).not.toContain("href");
  });
});

it("drops a feed's call-to-action tail from the snippet", () => {
  const xml = `<rss><channel>
    <item><title>Flood hits the valley</title><link>https://g/1</link>
      <description>Rescue teams reached the village at dawn. Continue reading...</description></item>
    <item><title>Second story</title><link>https://g/2</link>
      <description>The court gave its ruling on Friday. Read more</description></item>
    <item><title>Third story</title><link>https://g/3</link>
      <description>Nothing to strip here.</description></item>
  </channel></rss>`;
  const items = parseRss(xml, "The Guardian");
  expect(items[0].description).toBe("Rescue teams reached the village at dawn.");
  expect(items[1].description).toBe("The court gave its ruling on Friday.");
  // Only a TRAILING call-to-action goes; the body is never touched.
  expect(items[2].description).toBe("Nothing to strip here.");
});
