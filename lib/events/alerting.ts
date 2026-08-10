"use client";
// Proactive, client-side alerting for the Disasters & Events feed. The operator
// arms a rule — "any hazard of type … at/above tier … within R km of one of my
// assets" — and when a NEW matching event appears we (optionally) raise a browser
// Notification and/or POST to a generic incoming-webhook URL (Slack / PagerDuty /
// Teams style). Everything is:
//   • keyless & client-only — no server secrets, no stored credentials beyond the
//     URL the operator pastes (kept in their own localStorage);
//   • DORMANT-SAFE — denied Notification permission, an empty URL, or a failed POST
//     all degrade to a silent no-op, never an error;
//   • de-duplicated — a persisted `fired` set + a one-time silent `seeded` baseline
//     means existing events don't stampede the operator on first arm / reload.
// The matcher + coercion are PURE and unit-tested; the store + browser bridges are
// the thin impure shell (lib/shell/watchlist idiom).

import { useSyncExternalStore } from "react";
import { loadPersisted, savePersisted } from "@/lib/shell/persist";
import { haversineKm } from "@/lib/geo/haversine";
import { severityRank, type NormalizedEvent, type EventType, type SeverityTier } from "@/lib/events/model";
import type { Asset } from "@/lib/events/assets";
import { BRAND } from "@/lib/brand";

export interface AlertRuleConfig {
  enabled: boolean;
  /** Only events at/above this tier match. */
  minTier: SeverityTier;
  /** null = any hazard type; otherwise the set to match. */
  types: EventType[] | null;
  /** Match when an event is within this many km of ANY asset. */
  radiusKm: number;
}

export const DEFAULT_ALERT_RULE: AlertRuleConfig = { enabled: false, minTier: "S3", types: null, radiusKm: 250 };

export interface AlertHit {
  eventId: string;
  title: string;
  tier: SeverityTier;
  type: EventType;
  assetId: string;
  assetName: string;
  distanceKm: number;
}

const TIER_SET = new Set<SeverityTier>(["S0", "S1", "S2", "S3", "S4"]);

/**
 * PURE: events matching the rule (type + tier) that sit within rule.radiusKm of at
 * least one asset and are NOT already in `fired`. Nearest asset wins per event.
 */
export function matchAlerts(
  events: NormalizedEvent[],
  assets: Asset[],
  rule: AlertRuleConfig,
  fired: Set<string>,
): AlertHit[] {
  if (!rule.enabled || assets.length === 0) return [];
  const floor = severityRank(rule.minTier);
  const out: AlertHit[] = [];
  for (const e of events) {
    if (fired.has(e.id)) continue;
    if (severityRank(e.severity.tier) < floor) continue;
    if (rule.types && !rule.types.includes(e.type)) continue;
    let best: { assetId: string; assetName: string; distanceKm: number } | null = null;
    for (const a of assets) {
      const d = haversineKm(e.geo.lat, e.geo.lon, a.lat, a.lon);
      if (d <= rule.radiusKm && (!best || d < best.distanceKm)) {
        best = { assetId: a.id, assetName: a.name, distanceKm: d };
      }
    }
    if (best) out.push({ eventId: e.id, title: e.title, tier: e.severity.tier, type: e.type, ...best });
  }
  return out;
}

/** PURE: coerce a persisted rule into a valid one (garbage → defaults). */
export function coerceAlertRule(saved: unknown): AlertRuleConfig {
  const s = (saved ?? {}) as Partial<AlertRuleConfig>;
  const minTier = TIER_SET.has(s.minTier as SeverityTier) ? (s.minTier as SeverityTier) : DEFAULT_ALERT_RULE.minTier;
  const radiusKm = Number.isFinite(s.radiusKm) && (s.radiusKm as number) > 0 ? (s.radiusKm as number) : DEFAULT_ALERT_RULE.radiusKm;
  const types = Array.isArray(s.types) ? (s.types.filter((t) => typeof t === "string") as EventType[]) : null;
  return { enabled: s.enabled === true, minTier, types, radiusKm };
}

// --- Persisted state ---------------------------------------------------------

interface AlertingState {
  rule: AlertRuleConfig;
  /** Raise browser Notifications for hits. */
  notify: boolean;
  /** Optional generic incoming-webhook URL to POST hits to. */
  webhookUrl: string;
  /** Already-notified event ids (capped) — dedupe across renders + reloads. */
  fired: string[];
  /** One-time silent baseline taken so existing events don't stampede on first arm. */
  seeded: boolean;
}

const FIRED_CAP = 300;
const PERSIST_KEY = "tn.events.alerting.v1";
const PERSIST_VERSION = 1;

function defaultState(): AlertingState {
  return { rule: { ...DEFAULT_ALERT_RULE }, notify: false, webhookUrl: "", fired: [], seeded: false };
}

function coerceState(saved: unknown): AlertingState {
  const s = (saved ?? {}) as Partial<AlertingState>;
  return {
    rule: coerceAlertRule(s.rule),
    notify: s.notify === true,
    webhookUrl: typeof s.webhookUrl === "string" ? s.webhookUrl : "",
    fired: Array.isArray(s.fired) ? s.fired.filter((x) => typeof x === "string").slice(0, FIRED_CAP) : [],
    seeded: s.seeded === true,
  };
}

let state: AlertingState = defaultState();
const listeners = new Set<() => void>();
function emit() { for (const l of listeners) l(); savePersisted(PERSIST_KEY, PERSIST_VERSION, state); }

export const alertingStore = {
  get(): AlertingState { return state; },
  setRule(patch: Partial<AlertRuleConfig>) { state = { ...state, rule: { ...state.rule, ...patch } }; emit(); },
  setNotify(on: boolean) { state = { ...state, notify: on }; emit(); },
  setWebhook(url: string) { state = { ...state, webhookUrl: url }; emit(); },
  /** Record ids as fired (capped, newest-first) and mark the baseline taken. */
  markFired(ids: string[]) {
    if (ids.length === 0 && state.seeded) return;
    const merged = [...ids, ...state.fired.filter((x) => !ids.includes(x))].slice(0, FIRED_CAP);
    state = { ...state, fired: merged, seeded: true };
    emit();
  },
  /** Forget the fired history (re-baseline on the next tick). */
  resetFired() { state = { ...state, fired: [], seeded: false }; emit(); },
  hydrate() { state = coerceState(loadPersisted<AlertingState>(PERSIST_KEY, PERSIST_VERSION)); emit(); },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};

export function useAlerting(): AlertingState {
  return useSyncExternalStore(alertingStore.subscribe, alertingStore.get, alertingStore.get);
}

// --- Browser bridges (dormant-safe) -----------------------------------------

/** Ask for Notification permission. Resolves false when unsupported / denied. */
export async function requestNotifyPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  try {
    if (Notification.permission === "granted") return true;
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/** Raise a browser Notification for a hit. No-op unless permission is granted. */
export function fireBrowserNotification(hit: AlertHit): void {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  try {
    if (Notification.permission !== "granted") return;
    new Notification(`⚠ ${hit.tier} ${hit.type} · ${hit.title}`, {
      body: `${Math.round(hit.distanceKm)} km from ${hit.assetName}`,
      tag: `tn-ev-${hit.eventId}`,
    });
  } catch {
    /* some browsers throw on construct without a service worker — non-fatal */
  }
}

/** POST a hit to a generic incoming-webhook URL. Silent on any failure / empty URL. */
export async function postWebhook(url: string, hit: AlertHit): Promise<void> {
  const target = (url ?? "").trim();
  if (!target) return;
  try {
    await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` doubles as a Slack-compatible field; the structured fields ride alongside.
      body: JSON.stringify({
        text: `⚠ ${hit.tier} ${hit.type}: ${hit.title} — ${Math.round(hit.distanceKm)} km from ${hit.assetName}`,
        event: hit,
        source: `${BRAND.name} · Disasters & Events`,
      }),
    });
  } catch {
    /* CORS / offline / bad URL — dormant-safe, never throws into the render */
  }
}
