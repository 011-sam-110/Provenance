import type { SignalFeature, SignalSource } from "@/lib/signals/types";
import { stateAnchor } from "@/lib/signals/us-state-anchors.data";
import { degraded, degradedWith, observed } from "@/lib/signals/outcome";

// Cyber incidents CONFIRMED by the organisations themselves, in official US filings.
//
// WHY A SEPARATE LAYER (audited 2026-10-16). The ransomware layer shows what criminal
// gangs CLAIM on their leak sites, through an aggregator. No lawful primary exists for
// those claims. The primaries for an INCIDENT are disclosure regimes, and the free, live
// ones are all American:
//
//   - SEC Form 8-K Item 1.05, "material cybersecurity incident": a listed company must
//     file within four business days of deciding an incident is material. Read through
//     EDGAR full-text search; placed at the company's head-office state.
//   - Washington State Attorney General, data-breach notices (data.wa.gov sb4j-ca4h):
//     the one state register that tags an attack as "Ransomware". Placed at the
//     organisation's own state; the notice is about Washington residents affected.
//
// So this layer says "a victim confirmed an incident", the ransomware layer says "a gang
// claimed one", and the two are never added together. Filings arrive days to months
// after the attack, so the window is DISCLOSURE_DAYS and the refresh is slow.
//
// Two more passing sources (HHS OCR's breach portal, the Texas AG's breach reports) are
// browser-only pages; they are fetched by the relay host, not here.

const UA = "Provenance/2.0 (+https://provenance-online.com)";
export const DISCLOSURE_DAYS = 90;
const SEC_SEARCH = "https://efts.sec.gov/LATEST/search-index";
const WA_ENDPOINT = "https://data.wa.gov/resource/sb4j-ca4h.json";

export const CYBER_DISCLOSURES_ATTRIBUTION =
  "Disclosures: U.S. SEC EDGAR (public) · Washington State Office of the Attorney General (data.wa.gov) · State anchors: GeoNames (CC BY 4.0)";

/** One EDGAR full-text search hit, the fields used. */
interface SecHit {
  _id?: string;
  _source?: {
    adsh?: string;
    ciks?: string[];
    display_names?: string[];
    file_date?: string;
    form?: string;
    items?: string[];
    biz_locations?: string[];
    biz_states?: string[];
  };
}

/** Pure: "AMGEN INC  (AMGN)  (CIK 0000318154)" → "Amgen Inc". */
export function companyName(display: string): string {
  const name = display.replace(/\s*\(.*$/, "").trim();
  return name === name.toUpperCase() ? name.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : name;
}

/**
 * Pure: EDGAR full-text hits → one feature per 8-K that lists Item 1.05.
 * A filing has several documents and so several hits; it becomes one feature. A hit that
 * only MENTIONS "Item 1.05" (an 8.01 voluntary update, an exhibit) is not a 1.05 filing.
 */
export function normalizeSec(hits: SecHit[], now: number = Date.now()): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    const s = h._source;
    if (!s?.adsh || seen.has(s.adsh)) continue;
    if (!(s.items ?? []).includes("1.05")) continue;
    if (s.form && !/^8-K/.test(s.form)) continue;
    const filed = Date.parse(`${s.file_date ?? ""}T00:00:00Z`);
    if (!Number.isFinite(filed) || now - filed > DISCLOSURE_DAYS * 86_400_000) continue;
    const state = stateAnchor(s.biz_states?.[0] ?? "");
    if (!state) continue; // a foreign filer has no US state to place it in
    seen.add(s.adsh);
    const company = companyName(s.display_names?.[0] ?? "A listed company");
    const cik = String(s.ciks?.[0] ?? "").replace(/^0+/, "");
    const file = String(h._id ?? "").split(":")[1];
    const link =
      cik && file
        ? `https://www.sec.gov/Archives/edgar/data/${cik}/${s.adsh.replace(/-/g, "")}/${file}`
        : `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=8-K`;
    out.push({
      id: `cyber-disclosures:sec:${s.adsh}`,
      lat: state.lat,
      lon: state.lon,
      title: `Material cyber incident disclosed — ${company}`,
      signalId: "cyber-disclosures",
      color: "#0f766e",
      ts: new Date(filed).toISOString(),
      link,
      props: {
        source: "SEC Form 8-K, Item 1.05",
        organisation: company,
        filed: s.file_date,
        headOffice: s.biz_locations?.[0],
        state: state.name,
        placed: `On ${state.name} (at ${state.capital}), the head-office state. Not where the attack happened.`,
        meaning: "The company itself told investors it had a material cybersecurity incident. Not necessarily ransomware.",
      },
    });
  }
  return out;
}

/** One Washington AG breach notice, the fields used. */
interface WaRow {
  id?: string;
  name?: string;
  entitystate?: string;
  datesubmitted?: string;
  datestart?: string;
  dateend?: string;
  washingtoniansaffected?: string;
  industrytype?: string;
  businesstype?: string;
  cyberattacktype?: string;
}

/** Pure: Washington AG notices → one feature per ransomware notice. */
export function normalizeWa(rows: WaRow[], now: number = Date.now()): SignalFeature[] {
  const out: SignalFeature[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.cyberattacktype !== "Ransomware") continue;
    const id = String(r.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    const submitted = Date.parse(`${String(r.datesubmitted ?? "").slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(submitted) || now - submitted > DISCLOSURE_DAYS * 86_400_000) continue;
    const state = stateAnchor(r.entitystate ?? "");
    if (!state) continue;
    seen.add(id);
    const affected = Number(r.washingtoniansaffected);
    out.push({
      id: `cyber-disclosures:wa:${id}`,
      lat: state.lat,
      lon: state.lon,
      title: `Ransomware breach notice — ${String(r.name ?? "An organisation").trim()}`,
      signalId: "cyber-disclosures",
      color: "#0d9488",
      ts: new Date(submitted).toISOString(),
      link: "https://data.wa.gov/d/sb4j-ca4h",
      props: {
        source: "Washington State Attorney General breach notice",
        organisation: String(r.name ?? "").trim() || undefined,
        submitted: String(r.datesubmitted ?? "").slice(0, 10),
        attack: [r.datestart, r.dateend].map((d) => String(d ?? "").slice(0, 10)).filter(Boolean).join(" to ") || undefined,
        washingtoniansAffected: Number.isFinite(affected) ? affected : undefined,
        sector: [r.industrytype, r.businesstype].filter(Boolean).join(" · ") || undefined,
        state: state.name,
        placed: `On ${state.name} (at ${state.capital}), the organisation's own state. The notice is about Washington residents affected.`,
        meaning: "The organisation notified the Washington Attorney General of a ransomware breach. Filed weeks or months after the attack.",
      },
    });
  }
  return out;
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

export const CYBER_DISCLOSURES_SOURCE: SignalSource = {
  id: "cyber-disclosures",
  // A US state, anchored on its capital: the filings say no more than that.
  precision: "area",
  kind: "event",
  label: "Cyber incidents disclosed (US)",
  group: "Cyber threat",
  color: "#0f766e",
  refreshMs: 6 * 60 * 60 * 1000, // filings arrive days to months after the attack
  attribution: CYBER_DISCLOSURES_ATTRIBUTION,
  sourceUrl: "https://efts.sec.gov/LATEST/search-index?q=%22Item%201.05%22&forms=8-K",
  async fetch() {
    const now = Date.now();
    const since = isoDay(now - DISCLOSURE_DAYS * 86_400_000);
    const headers = { "User-Agent": UA, Accept: "application/json" };
    const [sec, wa] = await Promise.all([
      (async () => {
        try {
          const url = `${SEC_SEARCH}?q=${encodeURIComponent('"Item 1.05"')}&forms=8-K&dateRange=custom&startdt=${since}&enddt=${isoDay(now)}`;
          const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
          if (!res.ok) return null;
          const hits = ((await res.json()) as { hits?: { hits?: SecHit[] } })?.hits?.hits;
          return Array.isArray(hits) ? normalizeSec(hits, now) : null;
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          const q = new URLSearchParams({
            $where: `cyberattacktype='Ransomware' AND datesubmitted > '${since}T00:00:00'`,
            $order: "datesubmitted DESC",
            $limit: "500",
          });
          const res = await fetch(`${WA_ENDPOINT}?${q}`, { headers, signal: AbortSignal.timeout(20_000) });
          if (!res.ok) return null;
          const rows = (await res.json()) as unknown;
          return Array.isArray(rows) ? normalizeWa(rows as WaRow[], now) : null;
        } catch {
          return null;
        }
      })(),
    ]);
    if (!sec && !wa) return degraded("sec and wa failed");
    const features = [...(sec ?? []), ...(wa ?? [])].sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    if (!sec) return degradedWith(features, "sec failed", now);
    if (!wa) return degradedWith(features, "wa failed", now);
    return observed(features, now);
  },
};
