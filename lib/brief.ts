// Daily world brief — turns the day's live signals into a short, calm written
// situation summary.
//
// TWO PATHS, and the payload always says which one produced the text:
//   • 'heuristic' — the DEFAULT. Pure code, ZERO keys. It reads the live Country
//     Instability Index and states what the numbers say: how many countries are
//     above the reporting floor, which are heaviest, which driver recurs, and
//     which factors had no data today. Every clause is arithmetic over data we
//     already display.
//   • 'model'     — an optional upgrade. When FREELLMAPI_BASE_URL +
//     FREELLMAPI_KEY are set, the same snapshot is written up by a model through
//     freellmapi.co. If that call fails we fall back to the heuristic rather
//     than serving nothing.
//
// Honesty guards: the brief is built ONLY from real signal data we already show,
// the prompt forbids speculation, and `brief: null` is ALWAYS paired with
// `dormant: true` plus a human-readable `reason`. There is no state in which
// this endpoint claims to be live while delivering nothing.

/** Which path produced the text. The UI must label the two differently. */
export type BriefGenerator = "heuristic" | "model";

export interface BriefCountry {
  country: string;
  /** 0–100 composite instability score. */
  score: number;
  /** Factor labels driving this score, strongest first (e.g. ["food insecurity"]). */
  drivers?: string[];
}

export interface BriefSnapshot {
  /** Highest-scoring countries, already ranked densest-first. */
  topInstability: BriefCountry[];
  /** Total countries above the index's reporting floor (≥ topInstability.length). */
  totalRanked?: number;
  /** Factor labels the index expects but had NO data for today. */
  factorsMissing?: string[];
  /** ISO date (YYYY-MM-DD) the snapshot was taken. */
  dateIso?: string;
}

export interface BriefPayload {
  brief: string | null;
  dormant: boolean;
  generatedAt: number;
  /** Present whenever `brief` is non-null. */
  generatedBy?: BriefGenerator;
  /** Present whenever `brief` is null — why there is nothing to show. */
  reason?: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Pure: "2026-08-10" → "10 August 2026". Locale-free so it is deterministic. */
export function formatBriefDate(dateIso: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateIso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Pure: ["a","b","c"] → "a, b and c". */
export function listPhrase(items: string[]): string {
  const clean = items.filter(Boolean);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0];
  return `${clean.slice(0, -1).join(", ")} and ${clean[clean.length - 1]}`;
}

/**
 * Pure, KEYLESS: snapshot → a short written brief, or null when the snapshot
 * carries nothing to say. Every sentence is a statement about the numbers in the
 * snapshot; nothing here invents events, causes or forecasts.
 */
export function composeHeuristicBrief(snapshot: BriefSnapshot): string | null {
  const ranked = (snapshot.topInstability ?? []).filter(
    (c) => typeof c?.country === "string" && c.country.trim() !== "" && Number.isFinite(c?.score),
  );
  if (ranked.length === 0) return null;

  const sentences: string[] = [];
  const total = Math.max(snapshot.totalRanked ?? ranked.length, ranked.length);
  const dateline = formatBriefDate(snapshot.dateIso);

  sentences.push(
    `${dateline ? `${dateline}: ` : ""}${total} ${total === 1 ? "country is" : "countries are"} above the Country Instability Index reporting floor.`,
  );

  const top = ranked.slice(0, 3);
  sentences.push(
    `Pressure is heaviest in ${listPhrase(top.map((c) => `${c.country.trim()} (${Math.round(c.score)}/100)`))}.`,
  );

  // Which factor recurs across the ranked group — a fact about the data, not a cause.
  const counts = new Map<string, number>();
  for (const c of ranked) {
    for (const d of c.drivers ?? []) {
      const label = d.trim();
      if (label) counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  if (counts.size > 0) {
    const [label, n] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    sentences.push(
      `Across the ${ranked.length} highest-scoring ${ranked.length === 1 ? "country" : "countries"}, ${label} is the most common driver, present in ${n}.`,
    );
  }

  // Spread of the ranked group — says how concentrated the pressure is.
  if (ranked.length > 1) {
    const highest = Math.round(ranked[0].score);
    const lowest = Math.round(ranked[ranked.length - 1].score);
    if (highest !== lowest) {
      sentences.push(`Scores in that group run from ${highest} down to ${lowest} out of 100.`);
    }
  }

  const missing = (snapshot.factorsMissing ?? []).map((f) => f.trim()).filter(Boolean);
  if (missing.length > 0) {
    sentences.push(
      `Coverage note: no ${listPhrase(missing)} data reached the index today, so the index divides by the full factor set and these scores understate rather than overstate.`,
    );
  }

  return sentences.join(" ");
}

/** Pure: snapshot → the chat prompt sent to the gateway. */
export function buildBriefPrompt(s: BriefSnapshot): string {
  const list =
    s.topInstability.length > 0
      ? s.topInstability.map((c) => `${c.country} (${c.score}/100)`).join(", ")
      : "no countries currently above the instability threshold";
  const dateline = s.dateIso ? ` for ${s.dateIso}` : "";
  return [
    "You are a calm, factual intelligence analyst writing a short daily world brief" + dateline + ".",
    "Using ONLY the data below, write 3 short sentences summarising where global pressure is concentrated today.",
    "Do not invent specific events, casualty figures, or news the data does not contain. Do not speculate or give advice. Neutral, measured tone.",
    "",
    "Country Instability Index — highest-pressure countries right now: " + list + ".",
    "(The index composites armed conflict, food insecurity, forced displacement and internet outages; a higher score means more concurrent pressure.)",
  ].join("\n");
}

/** Pure: parse the gateway's chat-completion response → brief text, or null. */
export function parseBriefResponse(json: unknown): string | null {
  const choices = (json as { choices?: { message?: { content?: string } }[] })?.choices;
  const content = choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}
