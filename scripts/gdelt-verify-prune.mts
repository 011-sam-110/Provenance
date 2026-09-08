/**
 * Check that the SHIPPED predicate reproduces the audit numbers.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-verify-prune.mts
 *
 * The audit that chose this rule was written in Python against candidates.json. The
 * thing that ships is TypeScript in lib/signals/gdeltSpurious.ts. Those are two
 * implementations of one rule, and nothing so far has made them agree — a transcription
 * slip in the place-rounding or the precision set would leave the module passing its
 * fixtures while quietly filtering something other than what was measured.
 *
 * So this replays the whole 1,109-row candidate set through the real exported function
 * and asserts the counts the audit reported. It exits non-zero if they have drifted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { explainSpuriousEvents, type SpuriousInput } from "@/lib/signals/gdeltSpurious";

interface Candidate extends SpuriousInput {
  id: string;
  stamp: string;
  place: string;
  actionCountry: string;
}

const EXPECTED_DROPPED = 68;
const FLASHPOINTS: Record<string, string> = { IS: "Israel", GZ: "Gaza", UP: "Ukraine", SU: "Sudan" };

const raw: (Omit<Candidate, "slotStamp"> & { stamp: string })[] = JSON.parse(
  readFileSync(join("data", "gdelt-locality", "candidates.json"), "utf8"),
);
// The audit grouped on the recorder manifest stamp; the shipped rule groups on the
// row's own slot identity. They are the same 15-minute export, which is the point.
const rows: Candidate[] = raw.map((r) => ({ ...r, slotStamp: r.stamp }));

const verdicts = explainSpuriousEvents(rows);
const dropped = verdicts.filter((v) => !v.keep);

const byReason = new Map<string, number>();
for (const v of verdicts) byReason.set(v.reason, (byReason.get(v.reason) ?? 0) + 1);

console.log(`rows in            ${rows.length}`);
console.log(`rows dropped       ${dropped.length}  (${((100 * dropped.length) / rows.length).toFixed(1)}%)`);
console.log(`distinct articles  ${new Set(dropped.map((v) => v.event.sourceUrl)).size}`);
console.log("verdicts:");
for (const [r, n] of [...byReason].sort((a, b) => b[1] - a[1])) console.log(`  ${r.padEnd(24)} ${n}`);

console.log("\nflashpoint rows destroyed:");
let flashLost = 0;
for (const [cc, name] of Object.entries(FLASHPOINTS)) {
  const total = rows.filter((r) => r.actionCountry === cc).length;
  const lost = dropped.filter((v) => v.event.actionCountry === cc).length;
  flashLost += lost;
  console.log(`  ${name.padEnd(8)} ${lost} of ${total}`);
}

let bad = false;
if (dropped.length !== EXPECTED_DROPPED) {
  console.error(`\nDRIFT: expected ${EXPECTED_DROPPED} dropped rows, got ${dropped.length}.`);
  console.error("The shipped rule no longer matches the audit it was chosen by. Re-measure");
  console.error("before changing this constant -- the number is evidence, not a fixture.");
  bad = true;
}
if (flashLost !== 0) {
  console.error(`\nDRIFT: ${flashLost} flashpoint rows destroyed. The audit measured zero.`);
  bad = true;
}
if (bad) process.exitCode = 1;
else console.log("\nOK: the shipped predicate reproduces the audit exactly.");
