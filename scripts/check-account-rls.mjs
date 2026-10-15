#!/usr/bin/env node
// Proves the row-level security in supabase/migrations/20261015000000_accounts.sql against
// a REAL project. It makes two throwaway users, tries every forbidden thing, and deletes
// both users at the end. Run it against the DEV project only:
//
//   ACCOUNTS_RLS_TARGET=dev node --env-file=.env.local scripts/check-account-rls.mjs
//
// It refuses to run without ACCOUNTS_RLS_TARGET=dev, because it creates and deletes users.
import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const pub = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
if (process.env.ACCOUNTS_RLS_TARGET !== "dev") {
  console.error("Refusing: set ACCOUNTS_RLS_TARGET=dev. This script creates and deletes users.");
  process.exit(2);
}
if (!url || !pub || !secret) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or SUPABASE_SECRET_KEY.");
  process.exit(2);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const anon = createClient(url, pub, opts);
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  ${detail}`}`);
  if (!ok) failed++;
};

const tag = randomBytes(4).toString("hex");
const password = `rls-${randomBytes(12).toString("hex")}`;
const created = []; // every user id, recorded the moment createUser succeeds
async function makeUser(name) {
  const email = `rls-${name}-${tag}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { username: `rls_${name}_${tag}` },
  });
  if (error) throw new Error(`createUser ${name}: ${error.message}`);
  created.push(data.user.id);
  const client = createClient(url, pub, opts);
  const { error: e2 } = await client.auth.signInWithPassword({ email, password });
  if (e2) throw new Error(`signIn ${name}: ${e2.message}`);
  return { id: data.user.id, client, username: `rls_${name}_${tag}` };
}

const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const WL = "tn.watchlist.v1";
let A, B;
try {
  A = await makeUser("a");
  B = await makeUser("b");

  const { data: profA } = await A.client.from("profiles").select("username").eq("user_id", A.id).single();
  check("trigger made A's profile", profA?.username === A.username, JSON.stringify(profA));
  const peekProf = await B.client.from("profiles").select("*").eq("user_id", A.id);
  check("B reads none of A's profile row", peekProf.data?.length === 0, JSON.stringify(peekProf));

  // user_state: A's own rows, and what B may not do to them
  const ins = await A.client.from("user_state").upsert({ user_id: A.id, key: WL, version: 1, value: [{ id: "x" }] });
  check("A writes an allowlisted key", !ins.error, ins.error?.message);

  const peek = await B.client.from("user_state").select("key").eq("user_id", A.id);
  check("B reads none of A's rows", !peek.error && peek.data.length === 0, JSON.stringify(peek));

  await B.client.from("user_state").update({ value: [{ id: "evil" }] }).eq("user_id", A.id).eq("key", WL);
  const { data: wl1 } = await admin.from("user_state").select("value").eq("user_id", A.id).eq("key", WL).maybeSingle();
  check("B cannot overwrite A's row", JSON.stringify(wl1?.value) === JSON.stringify([{ id: "x" }]), JSON.stringify(wl1));

  await B.client.from("user_state").delete().eq("user_id", A.id);
  const { data: wl2 } = await admin.from("user_state").select("key").eq("user_id", A.id).eq("key", WL).maybeSingle();
  check("B cannot delete A's row", wl2?.key === WL, JSON.stringify(wl2));

  const lang = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.lang.v1", version: 1, value: "en" });
  check("A writes tn.lang.v1", !lang.error, lang.error?.message);
  const forge = await B.client.from("user_state").upsert({ user_id: A.id, key: "tn.lang.v1", version: 2, value: "fr" });
  check("B cannot write a row for A", !!forge.error);

  const evil = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.evil.v1", version: 1, value: {} });
  check("a key outside the allowlist is refused", !!evil.error);

  const hud = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.hud.v1", version: 1, value: { s: "x" } });
  check("A writes tn.hud.v1", !hud.error, hud.error?.message);
  const big = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.hud.v1", version: 1, value: { s: "x".repeat(70_000) } });
  check("a value over 64 KB is refused", !!big.error);

  const v2 = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.keymap.v1", version: 2, value: {} });
  check("A writes version 2", !v2.error, v2.error?.message);
  const down = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.keymap.v1", version: 1, value: {} });
  check("a version downgrade is refused", !!down.error);

  // activity_days
  const forgeDay = await B.client.from("activity_days").insert({ user_id: A.id, day: today });
  const { data: noDays } = await admin.from("activity_days").select("day").eq("user_id", A.id);
  check("B cannot record a day for A", !!forgeDay.error && noDays?.length === 0, JSON.stringify({ err: !!forgeDay.error, noDays }));
  const day = await A.client.from("activity_days").insert({ user_id: A.id, day: today });
  check("A records today", !day.error, day.error?.message);
  const peekDays = await B.client.from("activity_days").select("day").eq("user_id", A.id);
  check("B reads none of A's days", !peekDays.error && peekDays.data.length === 0, JSON.stringify(peekDays));
  const back = await A.client.from("activity_days").insert({ user_id: A.id, day: yesterday });
  check("A cannot back-date a day", !!back.error);
  const upd = await A.client.from("activity_days").update({ day: yesterday }).eq("user_id", A.id);
  const { data: d1 } = await admin.from("activity_days").select("day").eq("user_id", A.id);
  check("A cannot change a recorded day", !!upd.error && d1?.length === 1 && d1[0].day === today, JSON.stringify({ err: !!upd.error, d1 }));
  const del = await A.client.from("activity_days").delete().eq("user_id", A.id);
  const { data: d2 } = await admin.from("activity_days").select("day").eq("user_id", A.id);
  check("A cannot delete a recorded day", !!del.error && d2?.length === 1, JSON.stringify({ err: !!del.error, d2 }));
  const dflt = await B.client.from("activity_days").insert({ user_id: B.id });
  const { data: d3 } = await admin.from("activity_days").select("day").eq("user_id", B.id);
  check("the day defaults to today", !dflt.error && d3?.length === 1 && d3[0].day === today, JSON.stringify({ err: dflt.error?.message, d3 }));

  // service_role is read-only
  const sIns = await admin.from("user_state").insert({ user_id: B.id, key: "tn.lang.v1", version: 1, value: "en" });
  const { data: sRow } = await admin.from("user_state").select("key").eq("user_id", B.id).eq("key", "tn.lang.v1");
  check("service_role cannot insert", !!sIns.error && sRow?.length === 0, JSON.stringify({ err: !!sIns.error, sRow }));
  const sUpd = await admin.from("user_state").update({ value: [{ id: "svc" }] }).eq("user_id", A.id).eq("key", WL);
  check("service_role cannot update", !!sUpd.error);
  const sDel = await admin.from("user_state").delete().eq("user_id", A.id).eq("key", WL);
  const { data: wl3 } = await admin.from("user_state").select("value").eq("user_id", A.id).eq("key", WL).maybeSingle();
  check("service_role cannot delete", !!sDel.error && JSON.stringify(wl3?.value) === JSON.stringify([{ id: "x" }]), JSON.stringify({ err: !!sDel.error, wl3 }));

  for (const t of ["profiles", "user_state", "activity_days"]) {
    const r = await anon.from(t).select("*").limit(1);
    check(`anonymous reads nothing from ${t}`, !!r.error || r.data.length === 0, JSON.stringify(r.data));
  }

  const taken = await anon.rpc("username_available", { name: A.username.toUpperCase() });
  check("username_available sees a taken name, ignoring case", taken.data === false, JSON.stringify(taken));
  const free = await anon.rpc("username_available", { name: `free_${tag}` });
  check("username_available sees a free name", free.data === true, JSON.stringify(free));
  const malformed = await anon.rpc("username_available", { name: "Bad Name!" });
  check("username_available refuses a malformed name", malformed.data === false, JSON.stringify(malformed));
  const short = await anon.rpc("username_available", { name: "ab" });
  check("username_available refuses a short name", short.data === false, JSON.stringify(short));

  await B.client.from("profiles").update({ username: `hijack_${tag}` }).eq("user_id", A.id);
  const { data: still } = await admin.from("profiles").select("username").eq("user_id", A.id).single();
  check("B cannot rename A", still?.username === A.username, JSON.stringify(still));

  const bad = await A.client.from("profiles").update({ username: "Bad Name!" }).eq("user_id", A.id);
  check("an invalid username is refused", !!bad.error);
  const ok = await A.client.from("profiles").update({ username: `renamed_${tag}` }).eq("user_id", A.id);
  check("A renames self", !ok.error, ok.error?.message);

  // sign-up trigger: it never raises because of the username
  const mkOdd = async (label, username) => {
    const r = await admin.auth.admin.createUser({
      email: `rls-${label}-${tag}@example.com`, password, email_confirm: true, user_metadata: { username },
    });
    if (r.data?.user) created.push(r.data.user.id);
    const { data: p } = r.data?.user
      ? await admin.from("profiles").select("username").eq("user_id", r.data.user.id).maybeSingle()
      : { data: null };
    return { err: r.error?.message, username: p?.username };
  };
  const badName = await mkOdd("bad", "!");
  check("a bad username gets a placeholder", !badName.err && /^u_[0-9a-f]{22}$/.test(badName.username ?? ""), JSON.stringify(badName));
  const takenName = await mkOdd("taken", `renamed_${tag}`); // A renamed itself above, so this is its current name.
  const { data: stillA } = await admin.from("profiles").select("username").eq("user_id", A.id).single();
  check("a taken username gets a placeholder",
    !takenName.err && /^u_[0-9a-f]{22}$/.test(takenName.username ?? "") && stillA?.username === `renamed_${tag}`,
    JSON.stringify({ takenName, stillA }));

  // writes that must fail
  const anonWrite = await anon.from("user_state").insert({ user_id: A.id, key: "tn.scope.v1", version: 1, value: {} });
  const { data: scopeRows } = await admin.from("user_state").select("key").eq("user_id", A.id).eq("key", "tn.scope.v1");
  check("anonymous cannot write user_state", !!anonWrite.error && scopeRows?.length === 0, JSON.stringify({ err: !!anonWrite.error, scopeRows }));

  const dupProf = await A.client.from("profiles").insert({ user_id: A.id, username: `dup_${tag}` });
  check("A cannot insert a profile", !!dupProf.error);

  const moveProf = await A.client.from("profiles").update({ user_id: B.id }).eq("user_id", A.id);
  const { data: profStill } = await admin.from("profiles").select("user_id").eq("user_id", A.id).maybeSingle();
  check("A cannot change its profile user_id", !!moveProf.error && profStill?.user_id === A.id, JSON.stringify({ err: !!moveProf.error, profStill }));

  const moveRow = await A.client.from("user_state").update({ user_id: B.id }).eq("user_id", A.id).eq("key", WL);
  const { data: rowStill } = await admin.from("user_state").select("user_id").eq("user_id", A.id).eq("key", WL).maybeSingle();
  check("A cannot move a row to B", !!moveRow.error && rowStill?.user_id === A.id, JSON.stringify({ err: !!moveRow.error, rowStill }));

  const stamp = await A.client.from("user_state").upsert({ user_id: A.id, key: "tn.lang.v1", version: 1, value: "en", updated_at: "2000-01-01T00:00:00Z" });
  const { data: stamped } = await admin.from("user_state").select("updated_at").eq("user_id", A.id).eq("key", "tn.lang.v1").maybeSingle();
  check("the server sets updated_at", !stamp.error && new Date(stamped?.updated_at) > new Date("2020-01-01"), JSON.stringify({ err: stamp.error?.message, stamped }));

  // A is deleted last: the cascade must take every row with it
  const { error: delErr } = await admin.auth.admin.deleteUser(A.id);
  if (!delErr) created.splice(created.indexOf(A.id), 1);
  const left = await admin.from("user_state").select("key").eq("user_id", A.id);
  const leftDays = await admin.from("activity_days").select("day").eq("user_id", A.id);
  const leftProf = await admin.from("profiles").select("user_id").eq("user_id", A.id);
  check("deleting A cascades every row",
    !delErr && left.data?.length === 0 && leftDays.data?.length === 0 && leftProf.data?.length === 0,
    JSON.stringify({ delErr: delErr?.message, left: left.data?.length, leftDays: leftDays.data?.length, leftProf: leftProf.data?.length }));
} catch (e) {
  check("script ran to the end", false, String(e));
} finally {
  for (const id of created) {
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.warn(`WARNING  cleanup could not delete user ${id}: ${error.message}`);
    } catch (e) {
      console.warn(`WARNING  cleanup could not delete user ${id}: ${String(e)}`);
    }
  }
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
