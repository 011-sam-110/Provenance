// Fold Caddy's access log into durable daily rollups.
//
//   node scripts/rollup-access-log.mts             fold and write
//   node scripts/rollup-access-log.mts --print     fold, write, print a summary
//   node scripts/rollup-access-log.mts --dry-run   fold and print, write nothing
//
// Runs from a systemd timer every five minutes as root. Root because Caddy's log is
// mode 0600 owned by caddy:caddy, and widening the permissions on the one file holding
// visitor data is a bigger change than running a counter that opens no sockets.
//
// NO BUILD STEP, AND THAT IS WHY THE IMPORTS CARRY .ts EXTENSIONS. Node 24 strips
// TypeScript types natively. The box does not build this app: it has 1,907 MB of RAM
// and `next build` was measured peaking at 1,907 MB, so a build would run entirely out
// of the 2 GB swapfile deploy/provision.sh creates, while competing with the live
// server for the same memory. Anything needing compilation on the box therefore could
// not be deployed to it in practice. `.mts` rather than `.ts` because package.json is
// not `"type": "module"`, which would make a plain `.ts` file CommonJS and reject every
// import below.
//
//   sudo bash deploy/install-rollup.sh          from a checkout, or see that script for
//                                               the three install lines it runs
//   sudo systemctl daemon-reload && sudo systemctl enable --now provenance-rollup.timer
//
// WHY A CURSOR AND NOT A FULL RE-READ. The five files Caddy keeps come to 250 MB;
// re-parsing them every five minutes would spend two shared vCPUs recomputing an answer
// that has not changed. A full re-read is also not correct once a file rotates off the
// disk — the oldest day would silently lose its first hours and keep looking plausible.
//
// FILES ARE IDENTIFIED BY CONTENT, NOT BY NAME OR INODE, and that is load bearing. A
// rolled file is renamed, preserving its inode, and may then be gzipped, which replaces
// it. Keying the cursor on a name double-counts a whole file at every roll; keying it on
// an inode double-counts it the moment Caddy compresses it. A hash of the first
// DECOMPRESSED LINE survives both, because neither touches the bytes — see fingerprint(),
// which also explains why the window is a line and not a fixed number of bytes.

import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";
import { capDay, dayKey, foldRow, topN, type AccessRow } from "../lib/analytics/rollup.ts";
import {
  DEFAULT_ROLLUP_DIR,
  finalisableDays,
  makeVisitorKey,
  openDay,
  readState,
  statePath,
  writeDay,
  writeState,
  type Cursor,
  type RollupState,
} from "./lib/rollup-store.mts";

const LOG_DIR = process.env.CADDY_LOG_DIR || "/var/log/caddy";
const LOG_NAME = process.env.CADDY_LOG_NAME || "provenance.log";
const OUT_DIR = process.env.ANALYTICS_ROLLUP_DIR || DEFAULT_ROLLUP_DIR;
const SELF_HOST = process.env.ROLLUP_SELF_HOST || "provenance-online.com";
// Cap on how much of the first line is hashed, for the pathological case of a log line
// with no newline in it at all.
const FINGERPRINT_CAP = 8192;

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has("--dry-run");
const PRINT = argv.has("--print") || DRY_RUN;

interface LogFile {
  path: string;
  name: string;
  size: number;
  gz: boolean;
  /** The file Caddy is still appending to — the only one that can grow between runs. */
  live: boolean;
}

function listLogFiles(): LogFile[] {
  if (!existsSync(LOG_DIR)) return [];
  const stem = LOG_NAME.replace(/\.log$/, "");
  const out: LogFile[] = [];
  for (const name of readdirSync(LOG_DIR)) {
    if (!name.startsWith(stem) || !/\.log(\.gz)?$/.test(name)) continue;
    const path = join(LOG_DIR, name);
    try {
      out.push({ path, name, size: statSync(path).size, gz: name.endsWith(".gz"), live: name === LOG_NAME });
    } catch {
      // Rotated away between readdir and stat. It will be picked up next run if it
      // still exists, and if it does not there was nothing to read.
    }
  }
  // Oldest first, live last, so a day is built in order and the newest rows land last.
  return out.sort((a, b) => (a.live ? 1 : 0) - (b.live ? 1 : 0) || a.name.localeCompare(b.name));
}

function openStream(file: LogFile, start = 0): Readable {
  if (file.gz) return createReadStream(file.path).pipe(createGunzip());
  return createReadStream(file.path, { start });
}

/**
 * Yield complete lines with their exact byte length.
 *
 * A PARTIAL TRAILING LINE MUST NOT BE YIELDED. Caddy appends to the live file while
 * this reads it, so the tail of the buffer is regularly half a row. Node's readline
 * hands that over as though it were whole: the JSON parse fails, the row is dropped,
 * and the cursor advances past a request that was never counted. Counting bytes here is
 * also what lets the next run seek rather than re-read.
 */
async function* completeLines(stream: Readable): AsyncGenerator<{ line: string; bytes: number }> {
  let rest = Buffer.alloc(0);
  for await (const chunk of stream) {
    let buf = Buffer.concat([rest, chunk as Buffer]);
    let nl = buf.indexOf(0x0a);
    while (nl !== -1) {
      const slice = buf.subarray(0, nl);
      yield { line: slice.toString("utf8"), bytes: slice.length + 1 };
      buf = buf.subarray(nl + 1);
      nl = buf.indexOf(0x0a);
    }
    rest = buf;
  }
}

/**
 * Identity of a log file: a hash of its FIRST COMPLETE LINE.
 *
 * Stable across the rename and across the gzip, because neither touches the bytes, and
 * stable as the file GROWS, which is the part that is easy to get wrong. Hashing a
 * fixed-size window instead — the first 512 bytes, say — reads `min(512, size)` bytes
 * while the file is still small, so a live log shorter than the window produces a
 * DIFFERENT hash every time it is appended to. The job then sees a file it has never
 * met, re-reads it from the start, and adds those rows a second time. That window is
 * not hypothetical: it is every run in the minutes after a roll, when the new live file
 * holds one or two requests.
 *
 * The first line of a log file never changes once written, so it is the natural
 * identity. Caddy's `ts` carries microsecond precision, so two files sharing one is not
 * a real possibility. A file with no complete first line yet has nothing to count, and
 * returning null here leaves it for the next run.
 */
async function fingerprint(file: LogFile): Promise<string | null> {
  const stream = openStream(file);
  const parts: Buffer[] = [];
  let total = 0;
  let line: Buffer | null = null;
  try {
    for await (const chunk of stream) {
      const buf = chunk as Buffer;
      parts.push(buf);
      total += buf.length;
      const joined = Buffer.concat(parts);
      const nl = joined.indexOf(0x0a);
      if (nl !== -1) {
        line = joined.subarray(0, nl);
        break;
      }
      if (total >= FINGERPRINT_CAP) {
        line = joined.subarray(0, FINGERPRINT_CAP);
        break;
      }
    }
  } catch {
    return null;
  } finally {
    stream.destroy();
  }
  if (!line || line.length === 0) return null;
  return createHash("sha1").update(line).digest("hex").slice(0, 16);
}

interface Progress {
  folded: number;
  skipped: number;
  unparsed: number;
}

async function foldFile(file: LogFile, cursor: Cursor, state: RollupState, progress: Progress): Promise<void> {
  const visitorKey = makeVisitorKey(state.salt);
  // A plain file can be seeked. A gzip stream cannot, so its already-counted rows are
  // counted off instead. Either way the unit of progress is one line of the file.
  const seek = !file.gz && cursor.offset !== null && file.size >= cursor.offset ? cursor.offset : 0;
  let toSkip = seek > 0 ? 0 : cursor.lines;
  let offset = seek;

  // Membership of a few thousand hashes, checked once per pageview. An array scan here
  // is the difference between a run that finishes in milliseconds and one that does not.
  const seen = new Map<string, Set<string>>();
  const setFor = (date: string): Set<string> => {
    let s = seen.get(date);
    if (!s) {
      s = new Set(state.visitorKeys[date] ?? []);
      seen.set(date, s);
    }
    return s;
  };
  // A closure target rather than a local, because assigning to a captured `let` from
  // inside the callback does not narrow at the call site.
  const noted: { key: string | null } = { key: null };

  const stream = openStream(file, seek);
  for await (const { line, bytes } of completeLines(stream)) {
    offset += bytes;
    if (toSkip > 0) {
      toSkip -= 1;
      progress.skipped += 1;
      continue;
    }
    // cursor.lines counts LINES CONSUMED, not rows counted. A line that fails to parse
    // is still consumed, and rewinding for it would re-read it forever.
    cursor.lines += 1;
    if (!line.startsWith("{")) {
      progress.unparsed += 1;
      continue;
    }
    let row: AccessRow;
    try {
      row = JSON.parse(line) as AccessRow;
    } catch {
      progress.unparsed += 1;
      continue;
    }
    if (typeof row.ts !== "number") {
      progress.unparsed += 1;
      continue;
    }
    const date = dayKey(row.ts);
    const day = openDay(OUT_DIR, state, date);
    noted.key = null;
    const counted = foldRow(day, row, {
      selfHost: SELF_HOST,
      visitorKey,
      noteVisitor: (k) => {
        noted.key = k;
      },
    });
    if (!counted) {
      progress.unparsed += 1;
      continue;
    }
    if (noted.key !== null) {
      const set = setFor(date);
      set.add(noted.key);
      day.visitors = set.size;
    }
    progress.folded += 1;
  }

  for (const [date, set] of seen) state.visitorKeys[date] = [...set];

  cursor.name = file.name;
  cursor.offset = file.gz ? null : offset;
  cursor.seen = Math.floor(Date.now() / 1000);
  // A rolled file is finished with. Never opening it again is what keeps the cost of a
  // run proportional to new traffic rather than to retained history.
  if (!file.live) cursor.done = true;
}

async function main(): Promise<void> {
  const state = readState(OUT_DIR);
  const fresh = !existsSync(statePath(OUT_DIR));
  const files = listLogFiles();
  if (files.length === 0) {
    console.error(`rollup: no log files matching ${LOG_NAME} in ${LOG_DIR}`);
    process.exitCode = 1;
    return;
  }

  const progress: Progress = { folded: 0, skipped: 0, unparsed: 0 };
  const present = new Set<string>();

  for (const file of files) {
    if (file.size === 0) continue;
    const fp = await fingerprint(file);
    if (!fp) continue;
    present.add(fp);
    const cursor: Cursor = state.cursors[fp] ?? { name: file.name, lines: 0, offset: null, done: false, seen: 0 };
    state.cursors[fp] = cursor;
    // Rolled and fully read. The only effect of opening it again would be to re-count it.
    if (cursor.done) continue;
    // The live file has not grown, so there is nothing new in it.
    if (file.live && cursor.offset !== null && file.size === cursor.offset) continue;
    await foldFile(file, cursor, state, progress);
  }

  // Forget files that have rotated off the disk, or the cursor map grows for the life of
  // the box — one entry per 50 MiB of traffic, kept forever.
  for (const fp of Object.keys(state.cursors)) {
    if (!present.has(fp)) delete state.cursors[fp];
  }

  const now = Date.now();
  const finalise = finalisableDays(state, now);
  for (const day of Object.values(state.days)) capDay(day);
  state.lastRun = Math.floor(now / 1000);

  if (!DRY_RUN) {
    for (const date of finalise) {
      const day = state.days[date];
      if (!day) continue;
      // A day already on disk means the job was stopped for longer than the finalise
      // lag and late rows arrived for it. `openDay` ALREADY pulled that file back into
      // state.days before those rows were folded in (rollup-store.mts, and its own
      // test pins that), so `day` is the old counters PLUS the late ones — a whole
      // value, and the write below is a whole-value write.
      //
      // MERGING IT AGAIN HERE ADDED THE DAY FILE TO A COPY OF ITSELF. Measured before
      // this line changed: 2 real rows reported 2, then 3 reported 5, 4 reported 11,
      // 5 reported 23 — `n → 2n+1` per run, compounding for as long as late rows keep
      // arriving, and silent, because nothing errors and the shape stays plausible.
      // Two defences against the same loss — hydrate on open, merge on write — are
      // each correct alone and fabricate traffic together. Exactly one may own the
      // day file; `openDay` reads it, this writes it.
      writeDay(OUT_DIR, day);
    }
    // Day files first, then state. Both orders can be interrupted, and this one merely
    // rewrites an identical day file on the next run. The reverse drops a finalised day.
    for (const date of finalise) {
      delete state.days[date];
      delete state.visitorKeys[date];
    }
    writeState(OUT_DIR, state);
  }

  if (PRINT) report(state, progress, finalise);
  else {
    console.log(
      `rollup: +${progress.folded} rows${fresh ? " (first run)" : ""}, ${progress.unparsed} unparsed, ` +
        `${Object.keys(state.days).length} open day(s)` +
        (finalise.length ? `, finalised ${finalise.join(", ")}` : "") +
        (DRY_RUN ? " [dry run, nothing written]" : ""),
    );
  }
}

function report(state: RollupState, progress: Progress, finalised: string[]): void {
  console.log(`rollup: folded ${progress.folded}, skipped ${progress.skipped}, unparsed ${progress.unparsed}`);
  console.log(`rollup: out ${OUT_DIR}${DRY_RUN ? " [dry run, nothing written]" : ""}`);
  if (finalised.length) console.log(`rollup: finalised ${finalised.join(", ")}`);
  const days = Object.values(state.days).sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) {
    const mean = day.durationCount ? Math.round(day.durationMsSum / day.durationCount) : 0;
    console.log(
      `\n${day.date}  ${day.pageviews} pageviews, ~${day.visitors} visitors, ${day.requests} requests, ` +
        `${(day.bytes / 1e6).toFixed(1)} MB, mean ${mean} ms`,
    );
    console.log(
      `  api ${day.apiRequests} (${(day.apiBytes / 1e6).toFixed(1)} MB)  assets ${day.assetRequests}  ` +
        `bots ${day.botRequests}  scanners ${day.scannerRequests}  viaCF ${day.viaCloudflare} / direct ${day.direct}`,
    );
    for (const [label, map, n] of [
      ["pages    ", day.byPath, 8],
      ["referrers", day.byReferrer, 6],
      ["countries", day.byCountry, 8],
      ["devices  ", day.byDevice, 4],
      ["api      ", day.byApiPath, 6],
      ["errors   ", day.errors, 5],
    ] as const) {
      const rows = topN(map, n);
      if (rows.length) console.log(`  ${label} ${rows.map((r) => `${r.key}=${r.count}`).join("  ")}`);
    }
  }
}

await main();
