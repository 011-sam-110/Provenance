// tests/unit/account-import-guard.test.ts
// /privacy says no page loads the Supabase client. That stays true only while the library is
// reached through ONE dynamic import() in lib/account/client.ts, which runs only when accounts
// are configured. A static import anywhere would put it in the first load of every page.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|js|jsx|mjs|mts)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}
const FILES = ["app", "lib", "components"].flatMap((d) => walk(d));
const CLIENT = "lib/account/client.ts";

describe("the Supabase client stays out of every first load", () => {
  it("has no static import or require of @supabase/ outside type-only imports", () => {
    const bad: string[] = [];
    for (const f of FILES) {
      const src = readFileSync(f, "utf8");
      if (/^\s*(import|export)\s+(?!type\b)[^;]*?from\s+["']@supabase\//m.test(src)) bad.push(`${f}: static import`);
      if (/^\s*import\s+["']@supabase\//m.test(src)) bad.push(`${f}: side-effect import`);
      if (/require\(\s*["']@supabase\//.test(src)) bad.push(`${f}: require`);
    }
    expect(bad).toEqual([]);
  });

  it("loads it with one dynamic import(), in lib/account/client.ts only", () => {
    const users = FILES.filter((f) => /import\(\s*(\/\*[\s\S]*?\*\/\s*)?["'`]@supabase\//.test(readFileSync(f, "utf8")));
    expect(users).toEqual([CLIENT]);
  });

  it("never asks the bundler to prefetch, preload or inline it", () => {
    // webpackPrefetch / webpackPreload would download the library on every console load even
    // with accounts off, and webpackMode: "eager" would put it in the first load.
    expect(readFileSync(CLIENT, "utf8")).not.toMatch(/webpack(Prefetch|Preload|Mode)/);
  });

  it("reads SUPABASE_SECRET_KEY nowhere under app/, lib/ or components/ (M4 adds lib/account/serverAuth.ts)", () => {
    // lib/sources/keyRequirements.ts lists the name as a string in an env: array and reads nothing.
    const LISTS_NAME_ONLY = "lib/sources/keyRequirements.ts";
    const readers = FILES.filter((f) => {
      if (f === LISTS_NAME_ONLY) return false;
      const src = readFileSync(f, "utf8");
      return /process\.env/.test(src) && /SUPABASE_SECRET_KEY/.test(src);
    });
    expect(readers).toEqual([]);
  });
});
