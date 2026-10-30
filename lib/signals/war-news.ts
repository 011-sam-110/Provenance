// lib/signals/war-news.ts
// STUB from the war-sources foundation commit (M1). The M5 agent replaces this file:
// relay feed `war-news` -> one feature per post that names a place (opinion never
// drawn), and a summary with every post for the widget's list.
import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { degraded } from "@/lib/signals/outcome";

export const WAR_NEWS_SOURCE: SignalSource = {
  id: "war-news",
  kind: "event",
  label: "War news",
  group: "Conflict",
  color: "#0e7490",
  precision: "area",
  refreshMs: 30 * 60_000,
  attribution: "War news: the outlets and Telegram channels each post names",
  async fetch() {
    return degraded<SignalFeature>("not built yet");
  },
};
