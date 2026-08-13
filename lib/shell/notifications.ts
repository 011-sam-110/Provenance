"use client";
// Per-widget notifications. Any console widget can arm a rule — an enable flag, a
// set of channels (Browser / Telegram / Discord) and a numeric threshold — and when
// that widget reports a NEW "needs attention" alert the rule fans the text out to the
// armed + configured channels. Rules are keyed by widget TYPE (e.g. "signal:earthquakes",
// "markets") so they survive layout edits, duplication and board swaps.
//
// Everything is keyless + DORMANT-SAFE: the master gate off, a rule disabled, a channel
// unchecked, missing creds, or a failed relay all degrade to a silent no-op — never an
// error, never a fabricated send. The user's Discord webhook URL lives only in their own
// localStorage (mirrors the Telegram creds); the relay itself is the keyless /api/discord
// route. The pure bits — rule coercion, channel resolution, the Discord-webhook shape
// check — are exported + unit-tested; the store + browser/relay bridges are the thin
// impure shell (the lib/events/alerting + lib/shell/telegram idiom).

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { requestNotifyPermission } from "@/lib/events/alerting";
import { sendTelegram, isTelegramConfigured } from "@/lib/shell/telegram";
import { BRAND } from "@/lib/brand";

export type NotifyChannel = "browser" | "telegram" | "discord";
export interface NotifyChannels { browser: boolean; telegram: boolean; discord: boolean }
export interface NotifyRule {
  enabled: boolean;
  channels: NotifyChannels;
  /** Threshold, mirrored into the widget's own config.alertMin so its alert maths honours it. */
  minValue?: number;
}

/** The rule returned for a widget type that has none set yet (browser armed by default). */
export const DEFAULT_RULE: NotifyRule = {
  enabled: false,
  channels: { browser: true, telegram: false, discord: false },
};

// A Discord incoming-webhook URL. Mirrors the SSRF guard in app/api/discord/route.ts.
const DISCORD_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

/** PURE: does this string look like a canonical Discord incoming-webhook URL? */
export function isDiscordConfigured(url: string | undefined | null): boolean {
  return typeof url === "string" && DISCORD_RE.test(url.trim());
}

/** PURE: coerce a persisted rule into a valid one (junk → a disabled, no-channel rule). */
export function coerceRule(saved: unknown): NotifyRule {
  const s = (saved ?? {}) as Partial<NotifyRule> & { channels?: Partial<NotifyChannels> };
  const c = (s.channels ?? {}) as Partial<NotifyChannels>;
  const rule: NotifyRule = {
    enabled: s.enabled === true,
    channels: { browser: c.browser === true, telegram: c.telegram === true, discord: c.discord === true },
  };
  if (typeof s.minValue === "number" && Number.isFinite(s.minValue)) rule.minValue = s.minValue;
  return rule;
}

/** A patch for setRule — channels may be supplied partially (only the toggled ones). */
export type NotifyRulePatch = Partial<Omit<NotifyRule, "channels">> & { channels?: Partial<NotifyChannels> };

export interface ChannelCreds { telegram: boolean; discord: boolean }

/**
 * PURE: the channels a text should actually fire on, given the global master gate, the
 * rule, and which channels have creds. Browser has no cred gate here — the Notification
 * permission is checked when it actually fires.
 */
export function resolveChannels(master: boolean, rule: NotifyRule, creds: ChannelCreds): NotifyChannel[] {
  if (!master || !rule.enabled) return [];
  const out: NotifyChannel[] = [];
  if (rule.channels.browser) out.push("browser");
  if (rule.channels.telegram && creds.telegram) out.push("telegram");
  if (rule.channels.discord && creds.discord) out.push("discord");
  return out;
}

// --- Persisted state ---------------------------------------------------------

interface NotificationsState {
  /** Global gate — dispatch is inert unless this is on. */
  master: boolean;
  /** The user's own Discord incoming-webhook URL (their localStorage only). */
  discordWebhook: string;
  /** One rule per widget TYPE. */
  rules: Record<string, NotifyRule>;
}

const KEY = "tn.notifications.v1";
const VERSION = 1;

function defaultState(): NotificationsState {
  return { master: true, discordWebhook: "", rules: {} };
}

function coerceState(saved: unknown): NotificationsState {
  const s = (saved ?? {}) as Partial<NotificationsState>;
  const rules: Record<string, NotifyRule> = {};
  if (s.rules && typeof s.rules === "object") {
    for (const [type, r] of Object.entries(s.rules)) rules[type] = coerceRule(r);
  }
  return {
    master: s.master !== false, // default on
    discordWebhook: typeof s.discordWebhook === "string" ? s.discordWebhook : "",
    rules,
  };
}

let state: NotificationsState = defaultState();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); savePersisted(KEY, VERSION, state); }

export const notificationsStore = {
  getState(): NotificationsState { return state; },
  /** The rule for a widget type — a stable default constant when none is set. */
  get(type: string): NotifyRule { return state.rules[type] ?? DEFAULT_RULE; },
  setRule(type: string, patch: NotifyRulePatch) {
    const prev = state.rules[type] ?? DEFAULT_RULE;
    const next: NotifyRule = {
      ...prev,
      ...patch,
      channels: { ...prev.channels, ...(patch.channels ?? {}) },
    };
    state = { ...state, rules: { ...state.rules, [type]: next } };
    emit();
  },
  removeRule(type: string) {
    if (!(type in state.rules)) return;
    const rules = { ...state.rules }; delete rules[type];
    state = { ...state, rules }; emit();
  },
  setMaster(on: boolean) { state = { ...state, master: on }; emit(); },
  setDiscordWebhook(url: string) { state = { ...state, discordWebhook: url.trim() }; emit(); },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  hydrate() { state = coerceState(loadPersisted<NotificationsState>(KEY, VERSION)); emit(); },
};

export function useNotifications(): NotificationsState {
  return useSyncExternalStore(notificationsStore.subscribe, notificationsStore.getState, notificationsStore.getState);
}
export function useRule(type: string): NotifyRule {
  return useSyncExternalStore(
    notificationsStore.subscribe,
    () => notificationsStore.get(type),
    () => notificationsStore.get(type),
  );
}

// --- Channel bridges (dormant-safe) -----------------------------------------

/** Raise a browser Notification. No-op unless permission was granted / supported. */
function fireBrowserNote(text: string): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission !== "granted") return;
    new Notification(BRAND.name, { body: text.slice(0, 240) });
  } catch {
    /* some browsers throw on construct without a service worker — non-fatal */
  }
}

/** Relay one message to the stored Discord webhook through /api/discord. Never throws. */
export async function sendDiscord(text: string): Promise<{ ok: boolean; error?: string }> {
  const url = state.discordWebhook;
  if (!isDiscordConfigured(url)) return { ok: false, error: "Add your Discord webhook URL first." };
  try {
    const r = await fetch("/api/discord", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ webhookUrl: url, content: text }),
    });
    const j = (await r.json().catch(() => ({ ok: false }))) as { ok?: boolean; error?: string };
    return { ok: j?.ok === true, error: j?.error };
  } catch {
    return { ok: false, error: "Network error." };
  }
}

/**
 * Fan one alert text out to the rule's armed + configured channels. Dormant-safe:
 * master off / rule disabled / channel unchecked / missing creds / a failed relay all
 * degrade to a silent no-op.
 */
export function dispatch(text: string, rule: NotifyRule): void {
  const creds: ChannelCreds = { telegram: isTelegramConfigured(), discord: isDiscordConfigured(state.discordWebhook) };
  for (const ch of resolveChannels(state.master, rule, creds)) {
    if (ch === "browser") fireBrowserNote(text);
    else if (ch === "telegram") void sendTelegram(text);
    else if (ch === "discord") void sendDiscord(text);
  }
}

/** Re-exported so callers can request Notification permission when arming Browser. */
export { requestNotifyPermission };
