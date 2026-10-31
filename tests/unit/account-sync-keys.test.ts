// tests/unit/account-sync-keys.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SYNC_KEYS, SYNC_KEY_NAMES, syncSpec } from "@/lib/account/syncKeys";

const MIGRATIONS = join("supabase", "migrations");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("SYNC_KEYS", () => {
  it("has no duplicate keys", () => {
    expect(new Set(SYNC_KEY_NAMES).size).toBe(SYNC_KEY_NAMES.length);
  });

  it("equals the database check constraint, so the client and the database agree", () => {
    // The newest migration that names the constraint holds the deployed list: a later migration
    // that drops and re-adds `user_state_key_allowed` replaces the first one.
    const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
    const newest = files.filter((f) => /user_state_key_allowed/i.test(readFileSync(join(MIGRATIONS, f), "utf8"))).pop();
    expect(newest, "no migration in supabase/migrations names the user_state_key_allowed constraint").toBeDefined();
    const sql = readFileSync(join(MIGRATIONS, newest!), "utf8");
    const matches = [...sql.matchAll(/user_state_key_allowed\s+check\s*\(\s*key\s+in\s*\(([\s\S]*?)\)/gi)];
    expect(matches.length, `no \`user_state_key_allowed check (key in (...))\` in ${newest}`).toBeGreaterThan(0);
    const inSql = [...matches[matches.length - 1][1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...SYNC_KEY_NAMES].sort());
  });

  it("names only keys some store really writes", () => {
    // lib/account/ is left out: syncKeys.ts names every key, so including it would make this test pass by itself.
    const files = [...walk("lib"), ...walk("components")].filter((f) => !f.split("\\").join("/").startsWith("lib/account/"));
    const src = files.map((f) => readFileSync(f, "utf8")).join("\n");
    for (const key of SYNC_KEY_NAMES) {
      expect(src.includes(`"${key}"`), `${key} is not a persisted key in lib/ or components/`).toBe(true);
    }
  });

  it("never syncs the Telegram bot token", () => {
    expect(SYNC_KEY_NAMES).not.toContain("tn.telegram.v1");
  });

  it("strips every webhook and per-device field", () => {
    expect(Object.keys(syncSpec("tn.events.alerting.v1")!.localOnly!).sort()).toEqual(["fired", "seeded", "webhookUrl"]);
    expect(Object.keys(syncSpec("tn.notifications.v1")!.localOnly!)).toEqual(["discordWebhook"]);
    expect(Object.keys(syncSpec("tn.map.pins.v1")!.localOnly!)).toEqual(["activeId"]);
  });

  it("leaves screen, cache, flag and analytics keys on the device", () => {
    for (const k of ["tn.sources.railw", "tn.viewmode.v1", "tn.terminal.mode.v1", "tn.ui.v1", "tn.timewindow.v1",
      "tn.analytics.optout.v1", "tn.visit.v1", "tn.presence.id.v1", "tn.profile.v1", "tn.news.snapshot.v1",
      "tn.terminal.skin.v2", "tn.planes.fullTrail.v1"]) {
      expect(SYNC_KEY_NAMES).not.toContain(k);
    }
  });

  it("gives every list rule a valid shape", () => {
    for (const s of SYNC_KEYS.filter((s) => s.list)) {
      expect(["root", "pins"]).toContain(s.list!.at);
      if (s.list!.cap !== undefined) expect(s.list!.cap).toBeGreaterThan(0);
    }
  });
});
