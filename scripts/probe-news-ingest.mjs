// scripts/probe-news-ingest.mjs
// End-to-end proof that a signed push from the NewsScraper host reaches the rail.
//
//   NEWS_INGEST_SECRET=<secret> npx next dev -p 3117
//   SECRET=<same secret> node scripts/probe-news-ingest.mjs
//
// WHY THIS EXISTS AND WHY THE UNIT TESTS ARE NOT ENOUGH. The first run of this probe
// failed two checks with every one of the suite's unit tests passing: the ingest route
// reported `held: 3` while /api/news served nothing. Next bundles route handlers
// separately, so the two routes each held their OWN instance of the store module - the
// push landed in one map and the read looked at a different, empty one. Under vitest
// there is only ever one instance, so no unit test can see that class of fault. Only a
// real POST followed by a real GET can.
//
// It signs with node:crypto, a different implementation from the route's WebCrypto one,
// so a passing run also means the two libraries agree on the wire format.

import { createHash, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";

const BASE = process.env.BASE ?? "http://127.0.0.1:3117";
const SECRET = process.env.SECRET ?? "local-harness-secret-0123456789abcdef";
const PREFIX = "provenance-news-ingest-v1";

function sign(secret, ts, body) {
  const digest = createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex");
  const hmac = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(Buffer.from(`${PREFIX}:${ts}:${digest}`, "utf8"))
    .digest("hex");
  return { digest, signature: `sha256=${hmac}` };
}

async function post(body, { secret = SECRET, ts = Date.now(), gzip = false, mangle = null } = {}) {
  const { digest, signature } = sign(secret, ts, body);
  const headers = {
    "content-type": "application/json",
    "x-provenance-timestamp": String(ts),
    "x-provenance-signature": mangle === "signature" ? "sha256=" + "0".repeat(64) : signature,
    "x-provenance-content-sha256": digest,
  };
  let payload = Buffer.from(body, "utf8");
  if (gzip) {
    payload = gzipSync(payload);
    headers["content-encoding"] = "gzip";
  }
  const res = await fetch(`${BASE}/api/news/ingest`, { method: "POST", headers, body: payload });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json };
}

function item(over = {}) {
  return {
    id: "st_harness_0001",
    outlet: "reuters",
    title: "Harness story: Dangote refinery IPO",
    description: "A description the rail can render.",
    url: "https://www.reuters.com/business/energy/harness-story",
    published: "2026-09-16T08:00:00Z",
    firstSeenAt: "2026-09-16T08:30:00Z",
    lastSeenAt: "2026-09-16T09:00:00Z",
    sections: ["business", "energy"],
    formatFlags: [],
    authors: ["Should Not Appear"],
    wordCount: 412,
    thumbnail: null,
    hasText: true,
    textHash: "a".repeat(64),
    itemHash: "hash-v1",
    text: "SECRET-ARTICLE-BODY the rail must never serve.",
    keywords: ["Nigeria", "Refining"],
    placeHints: ["Nigeria"],
    ...over,
  };
}

const batch = (items, over = {}) =>
  JSON.stringify({ version: 1, generatedAt: "2026-09-16T09:06:00Z", cursor: "", items, ...over });

const checks = [];
const check = (name, pass, detail) => {
  checks.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. A forged signature is refused.
let r = await post(batch([item()]), { mangle: "signature" });
check("forged signature refused with 401", r.status === 401, `got ${r.status}`);

// 2. A signature from the wrong secret is refused.
r = await post(batch([item()]), { secret: "the-wrong-secret-entirely" });
check("wrong secret refused with 401", r.status === 401, `got ${r.status}`);

// 3. A replay outside the skew window is refused.
r = await post(batch([item()]), { ts: Date.now() - 10 * 60 * 1000 });
check("stale timestamp refused with 401", r.status === 401, `got ${r.status}`);

// 4. A genuine batch is accepted.
r = await post(batch([item()]));
check(
  "signed batch accepted",
  r.status === 200 && r.json?.accepted === 1 && r.json?.dropped === 0,
  JSON.stringify(r.json),
);

// 5. Re-posting the same batch is a free no-op, not a duplicate.
r = await post(batch([item()]));
check(
  "re-post is unchanged, not duplicated",
  r.status === 200 && r.json?.accepted === 0 && r.json?.unchanged === 1 && r.json?.held === 1,
  JSON.stringify(r.json),
);

// 6. A quiet batch must never look like a mass drop — the bug the scraper found.
check("quiet batch reports dropped 0", r.json?.dropped === 0 && r.json?.stored === 1, JSON.stringify(r.json));

// 7. Gzip, signed over the uncompressed JSON, works through the same door.
r = await post(batch([item({ id: "st_harness_gzip", itemHash: "hash-gz" })]), { gzip: true });
check("gzip body accepted", r.status === 200 && r.json?.accepted === 1, JSON.stringify(r.json));

// 8. A malformed row is dropped and named, and the good row beside it still lands.
r = await post(
  batch([
    item({ id: "st_harness_bad", url: "javascript:alert(1)" }),
    item({ id: "st_harness_good", itemHash: "hash-good" }),
  ]),
);
check(
  "malformed row dropped and named",
  r.status === 200 && r.json?.dropped === 1 && r.json?.droppedIds?.[0] === "st_harness_bad" && r.json?.accepted === 1,
  JSON.stringify(r.json),
);

// 9. The cursor probe: an empty batch returns what we hold.
r = await post(batch([]));
check("empty batch is a cursor probe", r.status === 200 && r.json?.cursor === "2026-09-16T09:00:00Z", JSON.stringify(r.json));

// 10. The pushed story reaches the rail, and its body does not.
const newsRes = await fetch(`${BASE}/api/news`);
const news = await newsRes.json();
const raw = JSON.stringify(news);
const mine = (news.items ?? []).find((i) => i.url?.includes("harness-story"));
check("pushed story appears in /api/news", Boolean(mine), mine ? `source=${mine.source}` : "not found");
check("attributed to the outlet, not the slug", mine?.source === "Reuters", mine?.source);
check("article body is NOT served", !raw.includes("SECRET-ARTICLE-BODY"));
check("author name is NOT served", !raw.includes("Should Not Appear"));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
process.exit(failed.length ? 1 : 0);
