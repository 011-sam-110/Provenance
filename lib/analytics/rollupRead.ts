// lib/analytics/rollupRead.ts
//
// Reading the daily rollups that scripts/rollup-access-log.mts writes. READ ONLY, and
// that is a contract rather than a description: app/(site)/privacy tells readers that
// nothing this site serves writes a file, and tests/unit/discovery-admin-gate.test.ts
// fails the build if any file under app/, lib/ or components/ so much as mentions a way
// to write one. This module is on that test's node:fs allowlist and on none of its
// writer lists. Adding a write here is not a small change; it makes a published
// sentence false.
//
// EVERYTHING HERE FAILS SOFT. The rollup directory does not exist in local development,
// did not exist on Vercel, and will not exist on a box where the timer was never
// installed. None of those is an error worth a 500 on an internal page — they are just
// "no data yet", and they are reported as that, with the path that was looked at, so
// the answer to "why is this empty" is on the screen rather than in a log.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type DayRollup } from "@/lib/analytics/rollup";

/** Matches deploy/provenance-rollup.service. Overridable for local inspection. */
export const ROLLUP_DIR = "/srv/provenance/shared/analytics";

export interface RollupSource {
  dir: string;
  /** Days present, oldest first. */
  days: DayRollup[];
  /** Unix seconds of the job's last successful run, or null if it has never run. */
  lastRun: number | null;
  /** Why there is nothing to show, when there is nothing to show. */
  reason: string | null;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function isDay(value: unknown): value is DayRollup {
  const d = value as DayRollup | null;
  return !!d && typeof d.date === "string" && typeof d.requests === "number" && Array.isArray(d.byHour);
}

/**
 * Load the rollups, newest `limitDays` of them.
 *
 * Open days live inside state.json and finished ones in days/, which is an
 * implementation detail of how the job stays crash-safe. Nothing above this line should
 * have to know about it, so both are read and merged into one list here.
 */
export function readRollups(
  env: Record<string, string | undefined> = process.env,
  limitDays = 60,
): RollupSource {
  const dir = env.ANALYTICS_ROLLUP_DIR?.trim() || ROLLUP_DIR;
  const empty = (reason: string): RollupSource => ({ dir, days: [], lastRun: null, reason });

  if (!existsSync(dir)) {
    return empty(
      "The rollup directory does not exist here. It is created on the production box by " +
        "deploy/install-rollup.sh; in local development there is no Caddy access log to fold.",
    );
  }

  const byDate = new Map<string, DayRollup>();

  const daysDir = join(dir, "days");
  if (existsSync(daysDir)) {
    for (const name of readdirSync(daysDir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(name)) continue;
      const day = readJson<DayRollup>(join(daysDir, name));
      if (isDay(day)) byDate.set(day.date, day);
    }
  }

  // The state file's open days are the newest data there is, so they win over anything
  // of the same date already read from days/ — that combination only occurs mid-write.
  const state = readJson<{ days?: Record<string, DayRollup>; lastRun?: number }>(join(dir, "state.json"));
  for (const day of Object.values(state?.days ?? {})) {
    if (isDay(day)) byDate.set(day.date, day);
  }

  const days = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-limitDays);
  const lastRun = typeof state?.lastRun === "number" ? state.lastRun : null;

  if (days.length === 0) {
    return {
      dir,
      days: [],
      lastRun,
      reason:
        "The rollup directory exists but holds no days yet. The job runs every five " +
        "minutes; if this persists, check `systemctl status provenance-rollup.service`.",
    };
  }

  return { dir, days, lastRun, reason: null };
}

/**
 * How stale the newest data is, in seconds, or null if the job has never run.
 *
 * Worth showing rather than assuming. A timer that has silently stopped leaves a
 * dashboard that looks fine and is quietly frozen, and the only visible symptom is that
 * the last day stops growing — which is indistinguishable from a quiet night.
 */
export function stalenessSeconds(source: RollupSource, now = Date.now()): number | null {
  if (source.lastRun == null) return null;
  return Math.max(0, Math.floor(now / 1000) - source.lastRun);
}

/** Age of the rollup files on disk, as a cheap cross-check on lastRun. */
export function directoryMtime(dir: string): number | null {
  try {
    return Math.floor(statSync(join(dir, "state.json")).mtimeMs / 1000);
  } catch {
    return null;
  }
}
