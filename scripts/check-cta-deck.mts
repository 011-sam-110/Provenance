// Are the landing button's topics still worth offering? Asks production for every signal
// layer a topic in lib/marketing/ctaDeck.ts opens, prints the count, and exits 1 when a
// topic would open an empty map. Not in the gate: it needs the network.
//
//   npx vite-node -c vitest.config.ts scripts/check-cta-deck.mts
import { CTA_TOPICS } from "@/lib/marketing/ctaDeck";

const BASE = process.env.CTA_BASE ?? "https://provenance-online.com";

async function count(id: string): Promise<number> {
  const res = await fetch(`${BASE}/api/signals/${id}`, { headers: { "user-agent": "provenance-check-cta-deck" } });
  if (!res.ok) return -res.status;
  const body = (await res.json()) as { count?: number };
  return body.count ?? 0;
}

async function main(): Promise<void> {
  let empty = 0;
  for (const door of CTA_TOPICS) {
    if (!door.needs) {
      console.log(`${door.words.padEnd(26)} ${door.href}`);
      continue;
    }
    const counts = await Promise.all(door.needs.map(async (id) => [id, await count(id)] as const));
    const total = counts.reduce((sum, [, n]) => sum + Math.max(0, n), 0);
    console.log(`${door.words.padEnd(26)} ${total ? "ok   " : "EMPTY"} ${counts.map(([id, n]) => `${id}=${n}`).join(" ")}`);
    if (!total) empty++;
  }
  if (empty) {
    console.error(`${empty} topic(s) would open an empty map`);
    process.exit(1);
  }
}

void main();
