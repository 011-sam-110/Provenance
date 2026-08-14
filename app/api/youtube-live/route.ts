import { getLiveVideos } from "@/lib/youtube/registry";
import { NEWS_PROVIDERS, newsChannelRequests } from "@/lib/console/news/providers";
import { requestKey } from "@/lib/youtube/live";

export const dynamic = "force-dynamic";

/**
 * GET /api/youtube-live — which video each registered channel is broadcasting
 * right now, keyed by provider id.
 *
 * WHY THE CLIENT CANNOT DO THIS ITSELF. The obvious client-side answer,
 * `youtube.com/embed/live_stream?channel={id}`, is retired and renders
 * "Error 153". The working answer is the YouTube Data API, which needs a key
 * that must not reach the browser. So resolution happens here and the client
 * receives video ids only — never the key.
 *
 * Returns {resolved: {providerId: videoId}, dormant, note, quotaSpent}.
 *
 * `dormant: true` means no YOUTUBE_API_KEY is configured, which is a legitimate
 * switched-off state, not an error: the console falls back to each provider's
 * last-known `ref`, i.e. exactly today's behaviour, never worse. A provider
 * missing from `resolved` means that channel had nothing live — the caller
 * should say so rather than render a dead player.
 *
 * `quotaSpent` is published because the free tier is 10,000 units/day and this
 * design's whole claim is that it costs ~1,900. A number nobody can see is a
 * number nobody notices going wrong.
 */
export async function GET() {
  const requests = newsChannelRequests();
  const result = await getLiveVideos(requests);

  const byKey = new Map(result.resolutions.map((r) => [requestKey(r), r]));
  const resolved: Record<string, string> = {};
  for (const p of NEWS_PROVIDERS) {
    if (p.kind !== "youtube" || !p.channelId) continue;
    const hit = byKey.get(requestKey({ channelId: p.channelId, match: p.match }));
    if (hit?.videoId) resolved[p.id] = hit.videoId;
  }

  return Response.json({
    resolved,
    dormant: result.dormant,
    note: result.note,
    quotaSpent: result.quotaSpent,
  });
}
