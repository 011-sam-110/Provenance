/**
 * Is a recorded article page actually the article, or an interstitial wearing HTTP 200?
 *
 * THE FAILURE THIS EXISTS TO STOP. wsbradio.com answered 200 with the body "This
 * website is unavailable in your location", because the fetch left a VPN exit outside
 * the US. My fetcher recorded outcome `ok`. Had I labelled from that page I would have
 * found no event in it and scored the row as junk -- which is the audit inventing
 * evidence for the conclusion it was hoping for. A geo-block is an UNREACHABLE row, not
 * a spurious one, and the difference decides whether a real Tucson police story counts
 * against the filter or leaves the denominator.
 *
 * This is the same trap the liveness work hit from the other side: BIHAMK and ACT serve
 * dead cameras as 200. HTTP 200 is a statement about a response, never about content.
 *
 * Pure and offline by design -- it re-judges bytes already on disk, so fixing the
 * detector costs no refetch and cannot change what was recorded.
 */

/** Phrases that mean "you are not being shown the article", lowercased substrings. */
const INTERSTITIAL = [
  "unavailable in your location",
  "not available in your",
  "access cannot be granted",
  "access denied",
  "403 forbidden",
  "attempting to access this website from a country",
  "for gdpr reasons",
  "gdpr",
  "not available to eu readers",
  "european economic area",
  "are you a robot",
  "verify you are human",
  "enable javascript",
  "javascript is disabled",
  "turn on javascript",
  "please enable cookies",
  "your privacy choices",
  "we use cookie policy",
  "cookies (including similar technologies",
  "security check",
  "before you continue",
  "checking your browser",
  "subscribe to continue reading",
  "subscribers only",
  "sign in to continue",
  "create a free account to",
  "page not found",
  "404 not found",
  "this content is not available",
  "your subscription",
];

/** Below this, there is no article text worth judging, whatever the page said. */
const MIN_TEXT = 220;

export type Readability =
  | { readable: true }
  | { readable: false; why: string };

export function judgeReadable(a: { outcome: string; title: string; description: string; text: string }): Readability {
  if (a.outcome !== "ok") return { readable: false, why: a.outcome };

  const hay = `${a.title} ${a.description} ${a.text}`.toLowerCase();
  for (const phrase of INTERSTITIAL) {
    if (hay.includes(phrase)) return { readable: false, why: `interstitial (${phrase})` };
  }
  // A page can be an interstitial without saying so. Too little text to judge is the
  // same outcome for the audit either way: it cannot be labelled, so it must not be.
  if (a.text.trim().length < MIN_TEXT) {
    return { readable: false, why: `too short (${a.text.trim().length} chars)` };
  }
  return { readable: true };
}
