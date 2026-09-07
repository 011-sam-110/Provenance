// The rollup store, and an end-to-end run of the job against a synthetic log.
//
// THE ROTATION TESTS ARE THE POINT OF THIS FILE. Everything else here is bookkeeping
// that would fail loudly. Log rotation fails QUIETLY and in exactly one direction: the
// counts go up. Caddy renames the live file, keeping its inode, and may then gzip it,
// replacing the inode with identical content. A cursor keyed on the filename re-counts
// the whole file at every roll; a cursor keyed on the inode re-counts it the moment the
// file is compressed. Either way /admin/analytics reports a traffic spike that never
// happened, on a schedule, and nothing errors.
//
// So the job is driven here the way the box drives it — a real child process, a real
// file being appended to, renamed, and gzipped underneath it — and the assertion is
// always the same one: the totals after the disruption equal the rows actually written.

import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { gzipSync as gzip } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { emptyDay, type DayRollup } from "@/lib/analytics/rollup";
import {
  FINALISE_LAG_MS,
  finalisableDays,
  emptyState,
  makeVisitorKey,
  openDay,
  readDay,
  readState,
  statePath,
  writeDay,
  writeState,
  type RollupState,
} from "../../scripts/lib/rollup-store.mts";

const SCRIPT = join(process.cwd(), "scripts", "rollup-access-log.mts");

let out: string;
let logs: string;

beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), "rollup-out-"));
  logs = mkdtempSync(join(tmpdir(), "rollup-log-"));
});

afterEach(() => {
  rmSync(out, { recursive: true, force: true });
  rmSync(logs, { recursive: true, force: true });
});

const HUMAN = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36";

// Caddy stamps `ts` with microsecond precision, so no two rows are byte-identical. That
// matters here: a file is identified by its first line, and two fixtures sharing one
// would look like the same file to the job. Fixtures that are unique by default keep the
// tests testing the job rather than an artefact of the fixture.
let tick = 0;

/** One access-log line of the shape deploy/Caddyfile actually produces. */
function line(opts: { uri?: string; ts?: number; ua?: string; status?: number; ip?: string } = {}): string {
  const {
    uri = "/",
    ts = Date.parse("2026-09-07T12:00:00Z") / 1000 + (tick += 1) / 1e6,
    ua = HUMAN,
    status = 200,
    ip = "86.20.0.0",
  } = opts;
  return `${JSON.stringify({
    level: "info",
    ts,
    logger: "http.log.access.log0",
    msg: "handled request",
    request: {
      remote_ip: "172.70.0.0",
      client_ip: ip,
      proto: "HTTP/2.0",
      method: "GET",
      host: "provenance-online.com",
      uri,
      headers: { "User-Agent": [ua], "Cf-Ipcountry": ["GB"] },
    },
    duration: 0.05,
    size: 1024,
    status,
  })}\n`;
}

function run(args: string[] = []): string {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ANALYTICS_ROLLUP_DIR: out,
      CADDY_LOG_DIR: logs,
      CADDY_LOG_NAME: "provenance.log",
      ROLLUP_SELF_HOST: "provenance-online.com",
    },
  });
}

function state(): RollupState {
  return JSON.parse(readFileSync(statePath(out), "utf8")) as RollupState;
}

function day(date = "2026-09-07"): DayRollup {
  const s = state();
  return s.days[date] ?? (readDay(out, date) as DayRollup);
}

describe("the rollup job, end to end", () => {
  it("counts what is in the log", () => {
    writeFileSync(join(logs, "provenance.log"), [line({ uri: "/" }), line({ uri: "/cameras" }), line({ uri: "/api/planes" })].join(""));
    run();
    const d = day();
    expect(d.requests).toBe(3);
    expect(d.pageviews).toBe(2);
    expect(d.apiRequests).toBe(1);
  });

  it("does not re-count anything on a second run that changed nothing", () => {
    writeFileSync(join(logs, "provenance.log"), line() + line());
    run();
    expect(day().requests).toBe(2);
    run();
    run();
    expect(day().requests).toBe(2);
  });

  it("counts only the new rows when the log is appended to", () => {
    const p = join(logs, "provenance.log");
    writeFileSync(p, line() + line());
    run();
    appendFileSync(p, line({ uri: "/cameras" }));
    run();
    const d = day();
    expect(d.requests).toBe(3);
    expect(d.byPath["/cameras"]).toBe(1);
  });

  it("ignores a half-written final line and picks it up once complete", () => {
    // Caddy is appending while the job reads. A partial row must not be consumed, or
    // that request is lost permanently.
    const p = join(logs, "provenance.log");
    // The same first line both times. Rewriting it with a different one would change the
    // file's identity, which is a different scenario and not this one.
    const first = line();
    const whole = line({ uri: "/cameras" });
    writeFileSync(p, first + whole.slice(0, 40));
    run();
    expect(day().requests).toBe(1);
    writeFileSync(p, first + whole);
    run();
    expect(day().requests).toBe(2);
    expect(day().byPath["/cameras"]).toBe(1);
  });

  it("does not re-count a rolled file after the rename", () => {
    // The rename preserves the inode and changes the name. A name-keyed cursor doubles
    // everything here.
    const live = join(logs, "provenance.log");
    writeFileSync(live, line() + line());
    run();
    renameSync(live, join(logs, "provenance-2026-09-07T12-00-00.000.log"));
    writeFileSync(live, line({ uri: "/cameras" }));
    run();
    const d = day();
    expect(d.requests).toBe(3);
    expect(d.pageviews).toBe(3);
  });

  it("does not re-count a rolled file after it is gzipped", () => {
    // The gzip replaces the inode with identical content. An inode-keyed cursor doubles
    // everything here, and only ever after a roll, which is why it survives testing.
    const live = join(logs, "provenance.log");
    const rolled = join(logs, "provenance-2026-09-07T12-00-00.000.log");
    writeFileSync(live, line() + line());
    run();
    renameSync(live, rolled);
    writeFileSync(live, line({ uri: "/cameras" }));
    run();
    expect(day().requests).toBe(3);

    writeFileSync(`${rolled}.gz`, gzip(readFileSync(rolled)));
    unlinkSync(rolled);
    run();
    expect(day().requests).toBe(3);
  });

  it("counts a rolled file that was never read while the job was stopped", () => {
    // The job missed a whole rotation. Both files are on disk and neither has a cursor.
    writeFileSync(join(logs, "provenance-2026-09-07T12-00-00.000.log"), line() + line());
    writeFileSync(join(logs, "provenance.log"), line({ uri: "/cameras" }));
    run();
    expect(day().requests).toBe(3);
  });

  it("counts rows on both sides of midnight into their own days", () => {
    writeFileSync(
      join(logs, "provenance.log"),
      line({ ts: Date.parse("2026-09-07T23:59:59Z") / 1000 }) + line({ ts: Date.parse("2026-09-08T00:00:01Z") / 1000 }),
    );
    run();
    expect(day("2026-09-07").requests).toBe(1);
    expect(day("2026-09-08").requests).toBe(1);
  });

  it("writes a finished day out to days/ and stops carrying it in state", () => {
    const old = new Date(Date.now() - FINALISE_LAG_MS - 48 * 3600_000);
    const date = old.toISOString().slice(0, 10);
    writeFileSync(join(logs, "provenance.log"), line({ ts: old.getTime() / 1000 }));
    run();
    expect(existsSync(join(out, "days", `${date}.json`))).toBe(true);
    expect(state().days[date]).toBeUndefined();
    expect(readDay(out, date)?.requests).toBe(1);
  });

  it("counts a returning visitor once, across separate runs", () => {
    const p = join(logs, "provenance.log");
    writeFileSync(p, line({ ip: "86.20.0.0" }));
    run();
    expect(day().visitors).toBe(1);
    appendFileSync(p, line({ ip: "86.20.0.0", uri: "/cameras" }) + line({ ip: "1.2.0.0" }));
    run();
    expect(day().visitors).toBe(2);
    expect(day().pageviews).toBe(3);
  });

  it("keeps counting the live file correctly while it is still only a line or two long", () => {
    // REGRESSION. The file identity used to be a hash of the first 512 bytes, which
    // reads min(512, size) while the file is smaller than that — so a one-row live log
    // hashed differently the moment a second row landed, looked like a file the job had
    // never seen, and was re-read from the top. Every roll produces exactly that state.
    const p = join(logs, "provenance.log");
    writeFileSync(p, line({ uri: "/one" }));
    run();
    expect(day().requests).toBe(1);
    appendFileSync(p, line({ uri: "/two" }));
    run();
    expect(day().requests).toBe(2);
    expect(day().byPath["/one"]).toBe(1);
    expect(day().byPath["/two"]).toBe(1);
  });

  it("forgets the cursor for a file that has rotated off the disk", () => {
    const live = join(logs, "provenance.log");
    const rolled = join(logs, "provenance-2026-09-07T12-00-00.000.log");
    writeFileSync(rolled, line());
    writeFileSync(live, line());
    run();
    expect(Object.keys(state().cursors)).toHaveLength(2);
    unlinkSync(rolled);
    run();
    expect(Object.keys(state().cursors)).toHaveLength(1);
  });

  it("writes nothing at all under --dry-run", () => {
    writeFileSync(join(logs, "provenance.log"), line());
    const printed = run(["--dry-run"]);
    expect(printed).toContain("nothing written");
    expect(existsSync(statePath(out))).toBe(false);
  });

  it("exits non-zero when there is no log to read", () => {
    let code = 0;
    try {
      run();
    } catch (e) {
      code = (e as { status?: number }).status ?? 0;
    }
    expect(code).toBe(1);
  });
});

describe("state file handling", () => {
  it("round-trips", () => {
    const s = emptyState();
    s.days["2026-09-07"] = emptyDay("2026-09-07");
    writeState(out, s);
    expect(readState(out).salt).toBe(s.salt);
    expect(readState(out).days["2026-09-07"]?.date).toBe("2026-09-07");
  });

  it("starts fresh on a corrupt or wrong-version file rather than refusing to run", () => {
    // A job that throws here would stop counting while the log kept rotating, which
    // loses whole days. Starting over re-reads what is still on disk; the day files
    // already written are untouched.
    mkdirSync(join(out, "days"), { recursive: true });
    writeFileSync(statePath(out), "{ not json");
    expect(readState(out).cursors).toEqual({});
    writeFileSync(statePath(out), JSON.stringify({ version: 99, salt: "x" }));
    expect(readState(out).version).toBe(1);
  });

  it("leaves no temp file behind", () => {
    writeState(out, emptyState());
    expect(existsSync(`${statePath(out)}.tmp`)).toBe(false);
  });

  it("gives every deployment a different salt", () => {
    expect(emptyState().salt).not.toBe(emptyState().salt);
  });
});

describe("makeVisitorKey", () => {
  it("is stable for the same visitor and different for a different salt", () => {
    const a = makeVisitorKey("salt-a");
    const b = makeVisitorKey("salt-b");
    expect(a("86.20.0.0", HUMAN)).toBe(a("86.20.0.0", HUMAN));
    expect(a("86.20.0.0", HUMAN)).not.toBe(a("1.2.0.0", HUMAN));
    // Without the salt this would be a dictionary lookup: masked network plus a
    // user-agent string is a small, guessable input space.
    expect(a("86.20.0.0", HUMAN)).not.toBe(b("86.20.0.0", HUMAN));
    expect(a("86.20.0.0", HUMAN)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("finalisableDays", () => {
  it("holds a day open until nothing can still arrive for it", () => {
    const s = emptyState();
    const now = Date.parse("2026-09-09T12:00:00Z");
    s.days["2026-09-09"] = emptyDay("2026-09-09"); // today
    s.days["2026-09-08"] = emptyDay("2026-09-08"); // yesterday, 12h past its end
    s.days["2026-09-06"] = emptyDay("2026-09-06"); // 60h past its end
    expect(finalisableDays(s, now)).toEqual(["2026-09-06"]);
  });
});

describe("openDay", () => {
  it("pulls a finished day back off disk so late rows are merged, not lost", () => {
    const s = emptyState();
    const d = emptyDay("2026-09-01");
    d.requests = 5;
    writeDay(out, d);
    expect(openDay(out, s, "2026-09-01").requests).toBe(5);
  });

  it("starts an empty day when there is nothing on disk", () => {
    expect(openDay(out, emptyState(), "2026-09-02").requests).toBe(0);
  });
});
