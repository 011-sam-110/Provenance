"use client";
// World Headlines widget — the RSS news data piece as a monitor card. Reads the
// keyless /api/news payload (fourteen world RSS feeds — see app/api/news/route.ts) and
// lists the latest headlines with source + relative time, each linking out.

import { useEffect, useMemo } from "react";
import { registerWidget } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import type { NewsItem } from "@/lib/news";
import { useJsonPoll } from "@/lib/console/widgets/useJsonPoll";
import { clusterNews } from "@/lib/news/cluster";
import HeadlinesDetail from "@/lib/console/widgets/headlines.detail";

interface NewsPayload {
  generatedAt: number;
  items: NewsItem[];
}
const EMPTY: NewsPayload = { generatedAt: 0, items: [] };

function rel(ts: number, now: number): string {
  if (!ts) return "";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const POLL_MS = 120_000;

/**
 * Rows the docked card renders. It is a scrolling list, so this is a DOM budget and
 * not an editorial one: the route now serves up to 300 headlines and clustering
 * collapses them to rather fewer stories, and a card that stopped at 60 would hide
 * the rest of a feed the reader has already paid to fetch. The focus view shows the
 * same clusters with their corroborating sources.
 */
const MAX_ROWS = 300;

function HeadlinesBody() {
  const { data, status, lastOk, ok } = useJsonPoll<NewsPayload>("/api/news", POLL_MS, EMPTY);
  const items = data.items ?? [];
  // Collapse same-event headlines into stories so the compact list shows one row
  // per event with a source-count when several outlets corroborate it.
  const stories = useMemo(() => clusterNews(items), [items]);

  // Two clocks: `lastOk` is when WE last fetched successfully, `sourceAt` is when the
  // server built that payload. A 5s-old fetch of an hour-old cache is a real situation
  // and the tooltip now says so instead of both collapsing into the word "live".
  const report = useWidgetReport();
  useEffect(() => {
    report({
      alerts: [],
      count: stories.length,
      fresh: { lastOk, ok, count: stories.length, refreshMs: POLL_MS, sourceAt: data.generatedAt || null },
    });
  }, [stories.length, report, lastOk, ok, data.generatedAt]);

  if (status === "loading" && items.length === 0) return <p className="tn-w-empty">Loading headlines…</p>;
  if (items.length === 0) return <p className="tn-w-empty">No headlines.</p>;

  const now = Date.now();
  return (
    <ul className="tn-w-list">
      {stories.slice(0, MAX_ROWS).map((c, i) => {
        const r = rel(c.lead.ts, now);
        return (
          <li key={c.id || i}>
            <a
              href={c.lead.url}
              target="_blank"
              rel="noreferrer"
              className="tn-w-place"
              style={{ color: "inherit", textDecoration: "none" }}
            >
              {c.title}
            </a>
            <span className="tn-w-muted">
              {" "}· {c.lead.source}
              {c.sourceCount > 1 ? ` +${c.sourceCount - 1}` : ""}
              {r ? ` · ${r}` : ""}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export const HEADLINES_WIDGET = {
  id: "headlines",
  title: "World Headlines",
  icon: "📰",
  category: "News",
  defaultHeight: 300,
  defaultConfig: {},
  component: HeadlinesBody,
  detail: HeadlinesDetail,
  help: {
    what: "The latest world headlines, clustered so the same story from several outlets reads as one line. Each links out to the original.",
    source:
      "14 world RSS feeds (BBC, Al Jazeera, NPR, Guardian, DW, France 24, Sky News, CBS, ABC, The Independent, Euronews, SCMP, Times of India, The Jerusalem Post) + the Liveuamap Telegram channel — all keyless",
  },
};
registerWidget(HEADLINES_WIDGET);
