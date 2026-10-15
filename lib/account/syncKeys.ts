// WHAT SYNCS. The one list of localStorage keys that may leave this device when someone is
// signed in, and the rules for each. The database holds the same list as a check
// constraint named `user_state_key_allowed` (first created in
// supabase/migrations/20261015000000_accounts.sql), and
// tests/unit/account-sync-keys.test.ts fails if the two disagree.
//
// THE RULE. A key syncs if it holds something the person made or chose. A key stays on the
// device if it holds a secret, a setting for this one screen, a cache, a "seen it" flag or
// analytics state. tn.telegram.v1 is a bot token, so it is not here at all. Three keys
// carry a secret or a per-device field inside an otherwise shareable object; `localOnly`
// names those fields with the value a fresh device gets, and the sync transforms (added with
// sync, milestone M3) strip them before upload and put the local value back after download.
//
// Adding a key here also needs: a NEW migration that drops and re-adds `user_state_key_allowed`
// with the full list (never an edit to an applied migration), and a line on /privacy. Removing one: a migration that deletes its rows.

export interface ListRule {
  /** Where the array of `{ id }` items lives: the stored value itself, or its `pins` field. */
  at: "root" | "pins";
  /** The store's own cap, applied after a merge. */
  cap?: number;
  /** Which end survives the cap. Newest-first stores keep "first". */
  keep?: "first" | "last";
}

export interface SyncKeySpec {
  key: string;
  /** Present for list stores: on first sign-in, merge by `id` instead of replacing. */
  list?: ListRule;
  /** Top-level fields that never leave this device, with the value a fresh device gets. */
  localOnly?: Readonly<Record<string, unknown>>;
}

export const SYNC_KEYS: readonly SyncKeySpec[] = [
  { key: "tn.watchlist.v1", list: { at: "root", cap: 40, keep: "first" } },
  { key: "tn.map.pins.v1", list: { at: "pins" }, localOnly: { activeId: null } },
  { key: "tn.events.assets.v1", list: { at: "root", cap: 50, keep: "first" } },
  { key: "tn.mkalerts.v1", list: { at: "root", cap: 60, keep: "last" } },
  { key: "tn.console.v1" },
  { key: "tn.console.boards.v1" },
  { key: "tn.console.presets.v1" },
  { key: "tn.console.activePreset.v1" },
  { key: "tn.console.sceneChrome.v1" },
  { key: "tn.inspector.v1" },
  { key: "tn.variant.v1" },
  { key: "tn.scope.v1" },
  { key: "tn.events.alerting.v1", localOnly: { webhookUrl: "", fired: [], seeded: false } },
  { key: "tn.notify.rules.v1" },
  { key: "tn.notifications.v1", localOnly: { discordWebhook: "" } },
  { key: "tn.keymap.v1" },
  { key: "tn.lang.v1" },
  { key: "tn.hud.v1" },
  { key: "tn.camslot.prefs.v1" },
];

export const SYNC_KEY_NAMES: readonly string[] = SYNC_KEYS.map((s) => s.key);

const BY_KEY = new Map(SYNC_KEYS.map((s) => [s.key, s]));

export function syncSpec(key: string): SyncKeySpec | undefined {
  return BY_KEY.get(key);
}
