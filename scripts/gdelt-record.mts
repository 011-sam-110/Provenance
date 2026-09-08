/**
 * Record raw GDELT 15-minute Event windows to disk, so the locality audit is replayable.
 *
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-record.mts --latest=2
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-record.mts --date=20260907 --hours=03,09,15,21
 *   node --import ./scripts/ts-alias-hook.mjs scripts/gdelt-record.mts --stamps=20260908020000
 *
 * WHY THIS EXISTS. The publisher-locality question is settled by reading rows against
 * their source articles. That judgement takes hours, and the live feed rolls every 15
 * minutes, so an audit that re-fetches cannot be checked by anyone -- including by me,
 * an hour later. Every number this branch reports is computed from a file in
 * `.gdelt-cache/`, never from the network. The audit RAISES on a missing recording.
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not filter, sort, dedupe or parse the rows
 * into `GdeltEvent`. It writes the decompressed TSV exactly as GDELT served it. Parsing
 * is a decision, and decisions belong downstream of the recording, not inside it.
 *
 * DIURNAL MIX. GDELT's population at 03:00 UTC is not the population at 15:00 UTC --
 * the wire is regional and the publishing day moves round the planet. `--hours` records
 * one slot per named UTC hour so a labelled set is not accidentally a sample of one
 * newsroom shift.
 *
 * VPN. Mullvad is up on this machine. storage.googleapis.com is not blocked, but the
 * exit IP is recorded next to every window anyway, because the SOURCE ARTICLES read
 * during labelling are fetched from the same host and some publishers will refuse it.
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipMemberExtent } from "@/lib/signals/gdelt";

const BASE = "https://storage.googleapis.com/data.gdeltproject.org/gdeltv2";
const CACHE = ".gdelt-cache";
const MANIFEST = join(CACHE, "manifest.json");

/** One recorded window. `rows` is the raw line count, before any parsing rule. */
interface Recorded {
  stamp: string;
  file: string;
  bytes: number;
  rows: number;
  sha256: string;
  fetchedAt: string;
  exitIp: string;
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

const p2 = (n: number) => String(n).padStart(2, "0");

/** Newest published slot: floor to 15 min, then lag one slot (the current one is not up). */
function latestStamp(now = Date.now()): string {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(Math.floor(d.getUTCMinutes() / 15) * 15 - 15);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00`;
}

function stepBack(stamp: string, slots: number): string {
  const d = new Date(Date.UTC(
    +stamp.slice(0, 4), +stamp.slice(4, 6) - 1, +stamp.slice(6, 8),
    +stamp.slice(8, 10), +stamp.slice(10, 12), 0,
  ));
  d.setUTCMinutes(d.getUTCMinutes() - 15 * slots);
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}00`;
}

/** Which stamps this invocation wants. Explicit --stamps wins; --date+--hours next. */
function plannedStamps(): string[] {
  const explicit = arg("stamps");
  if (explicit) return explicit.split(",").map((s) => s.trim()).filter(Boolean);

  const hours = arg("hours");
  if (hours) {
    const date = arg("date");
    if (!date || !/^\d{8}$/.test(date)) {
      throw new Error("--hours needs --date=YYYYMMDD (a UTC day GDELT has published)");
    }
    return hours.split(",").map((h) => `${date}${p2(Number(h.trim()))}0000`);
  }

  const n = Number(arg("latest") ?? 1);
  if (!Number.isInteger(n) || n < 1) throw new Error("--latest must be a positive integer");
  const newest = latestStamp();
  return Array.from({ length: n }, (_, i) => stepBack(newest, i));
}

/**
 * The exit IP, recorded not asserted. A failure here is NOT fatal -- the recording is
 * still valid -- but an unknown IP must read as unknown, never as "no VPN".
 */
async function exitIp(): Promise<string> {
  try {
    const res = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(8000) });
    return res.ok ? (await res.text()).trim() : `unknown (HTTP ${res.status})`;
  } catch (e) {
    return `unknown (${e instanceof Error ? e.message : "failed"})`;
  }
}

async function record(stamp: string, ip: string): Promise<Recorded> {
  const url = `${BASE}/${stamp}.export.CSV.zip`;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${stamp}: HTTP ${res.status} from ${url}`);
  const buf = await res.arrayBuffer();

  // Same extent logic the production adapter uses. Slicing to end-of-file instead
  // hands the decoder the central directory too, which Node tolerates and Vercel
  // does not -- see the comment on zipMemberExtent.
  const { start, end } = zipMemberExtent(buf);
  const tsv = inflateRawSync(Buffer.from(buf, start, end - start)).toString("utf8");

  const file = join(CACHE, `${stamp}.export.tsv`);
  writeFileSync(file, tsv, "utf8");
  return {
    stamp,
    file,
    bytes: tsv.length,
    rows: tsv.split("\n").filter((l) => l.trim()).length,
    sha256: createHash("sha256").update(tsv).digest("hex"),
    fetchedAt: new Date().toISOString(),
    exitIp: ip,
  };
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const force = process.argv.includes("--force");
  const manifest: Record<string, Recorded> = existsSync(MANIFEST)
    ? JSON.parse(readFileSync(MANIFEST, "utf8"))
    : {};

  const stamps = plannedStamps();
  const ip = await exitIp();
  console.log(`exit IP: ${ip}`);
  console.log(`planned: ${stamps.length} window(s)\n`);

  let failed = 0;
  for (const stamp of stamps) {
    if (!force && manifest[stamp] && existsSync(manifest[stamp].file)) {
      console.log(`  ${stamp}  already recorded (${manifest[stamp].rows} rows) -- skipping`);
      continue;
    }
    try {
      const rec = await record(stamp, ip);
      manifest[stamp] = rec;
      console.log(`  ${stamp}  ${rec.rows} rows  ${(rec.bytes / 1e6).toFixed(1)} MB  ${rec.sha256.slice(0, 12)}`);
    } catch (e) {
      failed++;
      console.error(`  ${stamp}  FAILED: ${e instanceof Error ? e.message : e}`);
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2), "utf8");
  }

  console.log(`\nrecorded ${Object.keys(manifest).length} window(s) total in ${CACHE}/`);
  // A partial run must not look like a clean one to a script that only reads the code.
  if (failed) process.exitCode = 1;
}

main();
