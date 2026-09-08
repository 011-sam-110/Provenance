/**
 * Fetch the source article behind every audit candidate, to disk, so labelling is a
 * reading task over recorded bytes rather than a live one.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-fetch-articles.mts
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-fetch-articles.mts --limit=40
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-fetch-articles.mts --force
 *
 * WHY RECORD RATHER THAN READ LIVE. A label is a claim about what an article said. News
 * pages change, get pulled, and paywall differently by hour and by exit IP, so a label
 * that cannot be re-checked against the bytes it was made from is not evidence. Every
 * verdict in the audit set points at a file here.
 *
 * THE FAILURE THAT MATTERS MOST. A blocked fetch must never become a label. Mullvad is
 * up on this machine and publishers refuse it at different rates, so the outcome of
 * every fetch is NAMED -- ok, http-403, timeout, network, empty -- and anything that is
 * not `ok` is labelled `unreachable` downstream and leaves the denominator. Guessing an
 * article from its URL slug is exactly how an audit talks itself into the answer it
 * expected: the Coonabarabran row has a slug about a murder, and the whole question is
 * whether the article is a 30-year-old parole hearing rather than a killing.
 *
 * POLITENESS. Six at a time, one pass, no retries beyond a single redirect follow. This
 * reads a couple of hundred pages once. It is not a crawler and must not become one.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const CANDIDATES = join("data", "gdelt-locality", "candidates.json");
const ART_DIR = join(".gdelt-cache", "articles");
const CONCURRENCY = 6;
const TIMEOUT_MS = 15_000;

/** A recorded fetch. `outcome` is never inferred; `text` is empty unless outcome is ok. */
interface Article {
  url: string;
  outcome: string;
  httpStatus?: number;
  title: string;
  description: string;
  text: string;
  fetchedAt: string;
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const keyOf = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16);

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;|&#x2019;/g, "'").replace(/&#8220;|&#8221;/g, '"').replace(/&mdash;|&#8212;/g, " - ")
    .replace(/&[a-z]+;/gi, " ");
}

function meta(html: string, ...names: string[]): string {
  for (const n of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${n}["'][^>]*content=["']([^"']*)["']`, "i",
    );
    const alt = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${n}["']`, "i",
    );
    const hit = html.match(re)?.[1] ?? html.match(alt)?.[1];
    if (hit?.trim()) return decodeEntities(hit).trim();
  }
  return "";
}

/**
 * Body text, best effort. Paragraph tags first because they survive most templates;
 * a full strip is the fallback. Truncated hard -- labelling needs the lede and the
 * dateline, not the article, and a 200 KB page in a JSON file helps nobody.
 */
function bodyText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ");
  const paras = [...stripped.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 40);
  const text = paras.length
    ? paras.join("\n")
    : decodeEntities(stripped.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  return text.slice(0, 1600);
}

async function fetchOne(url: string): Promise<Article> {
  const base: Article = {
    url, outcome: "network", title: "", description: "", text: "",
    fetchedAt: new Date().toISOString(),
  };
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "follow",
      headers: {
        // A plain default UA is refused by a large share of news CDNs, which would
        // record as "no article" and silently bias the labelled set toward the
        // publishers that happen to be permissive. Identifying as a normal browser
        // is the honest choice here; nothing is bypassed and nothing is logged in.
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-GB,en;q=0.9",
      },
    });
    base.httpStatus = res.status;
    if (!res.ok) return { ...base, outcome: `http-${res.status}` };
    const html = await res.text();
    const title = meta(html, "og:title", "twitter:title") ||
      decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
    const description = meta(html, "og:description", "description", "twitter:description");
    const text = bodyText(html);
    if (!title && !description && !text) return { ...base, outcome: "empty" };
    return { ...base, outcome: "ok", title, description, text };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, outcome: /timeout|abort/i.test(msg) ? "timeout" : `network (${msg.slice(0, 60)})` };
  }
}

async function main() {
  if (!existsSync(CANDIDATES)) {
    throw new Error(`${CANDIDATES} is missing. Run: gdelt-audit.mts extract`);
  }
  mkdirSync(ART_DIR, { recursive: true });
  const force = process.argv.includes("--force");
  const limit = Number(arg("limit") ?? Infinity);

  const candidates: { sourceUrl: string }[] = JSON.parse(readFileSync(CANDIDATES, "utf8"));
  const urls = [...new Set(candidates.map((c) => c.sourceUrl).filter(Boolean))];
  const todo = urls.filter((u) => force || !existsSync(join(ART_DIR, `${keyOf(u)}.json`)))
    .slice(0, limit);

  console.log(`${urls.length} distinct source URLs, ${todo.length} to fetch`);
  if (!todo.length) return;

  let done = 0;
  const outcomes = new Map<string, number>();
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const url = todo[i];
      const art = await fetchOne(url);
      writeFileSync(join(ART_DIR, `${keyOf(url)}.json`), JSON.stringify(art, null, 1), "utf8");
      const kind = art.outcome.split(" ")[0];
      outcomes.set(kind, (outcomes.get(kind) ?? 0) + 1);
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${todo.length}`);
    }
  }));

  console.log(`\noutcomes:`);
  for (const [k, n] of [...outcomes].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${n}`);
  }
  const ok = outcomes.get("ok") ?? 0;
  console.log(`\nreadable: ${ok}/${todo.length} (${((100 * ok) / todo.length).toFixed(1)}%)`);
  console.log(`cached in ${ART_DIR}/ (${readdirSync(ART_DIR).length} files)`);
}

main();
