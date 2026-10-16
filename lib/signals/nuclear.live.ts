import type { SignalFeature } from "@/lib/signals/types";
import { BMU_SITE, EIA_PLANT_SITE, IESO_SITE, NRC_UNIT_SITE } from "@/lib/signals/nuclear-units.data";

// What the reactors are doing now, from the operators and agencies that publish it
// free, joined onto the OSM plant pins (nuclear.ts) through nuclear-units.data.ts.
//
//   NRC  Power Reactor Status Report: % power per US unit, once a day. US federal
//        work, public domain. Its CDN refuses curl's TLS fingerprint (403) but serves
//        Node's fetch with a browser User-Agent (200, measured 2026-10-16).
//   Elexon BMRS Physical Notifications: the MW each GB unit has notified it will
//        generate in the current half hour (a plan submitted to the grid operator,
//        not a meter reading). "Contains BMRS data © Elexon Limited copyright and
//        database right 2026."
//   IESO Generator Output and Capability: MW per Ontario unit for the last hour.
//        © Independent Electricity System Operator, IESO Terms of Use.
//   EIA  facility nuclear outages (US, daily, MW offline). KEY-GATED: dormant until
//        EIA_API_KEY is set. Derived from the same NRC report, so it is not an
//        independent check on NRC, only the MW the NRC percentages mean.
//
// A plant with no reading keeps its pin and says nothing: no reading is not "running".

export interface UnitReading {
  /** The unit as its publisher names it ("Braidwood 1", "T_SIZB-1", "BRUCEA-G2"). */
  unit: string;
  /** OSM plant id, `<type>/<id>`. */
  site: string;
  source: "NRC" | "Elexon" | "IESO";
  /** Percent of licensed power (NRC). */
  pct?: number;
  /** Megawatts (Elexon notified, IESO metered hour). */
  mw?: number;
  /** ISO date or time the reading is for. */
  at: string;
}

export interface SiteOutage {
  site: string;
  /** MW of the plant's capacity offline that day. */
  outageMw: number;
  capacityMw: number;
  /** ISO date. */
  at: string;
}

/** "10/16/2026 12:00:00 AM" → "2026-10-16". */
function nrcDate(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s.trim());
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
}

/** Pure: the NRC 365-day report (`ReportDt|Unit|Power`) → the newest day's readings
 *  for units this layer can place. */
export function parseNrcStatus(text: string, units: Readonly<Record<string, string>> = NRC_UNIT_SITE): UnitReading[] {
  const rows: { date: string; unit: string; pct: number }[] = [];
  let newest = "";
  for (const line of text.split(/\r?\n/)) {
    const [d, unit, power] = line.split("|");
    const date = d ? nrcDate(d) : null;
    const pct = Number(power);
    if (!date || !unit || power === undefined || power.trim() === "" || !Number.isFinite(pct)) continue;
    rows.push({ date, unit: unit.trim(), pct });
    if (date > newest) newest = date;
  }
  const out: UnitReading[] = [];
  for (const r of rows) {
    if (r.date !== newest) continue;
    const site = units[r.unit];
    if (site) out.push({ unit: r.unit, site, source: "NRC", pct: r.pct, at: r.date });
  }
  return out;
}

export interface PnRow {
  bmUnit?: string | null;
  timeFrom?: string;
  timeTo?: string;
  levelFrom?: number;
  levelTo?: number;
}

/** Pure: Elexon PN rows for one settlement period → one reading per listed unit, the
 *  segment covering `now` (else the latest segment). */
export function parsePnRows(
  rows: PnRow[],
  now: number,
  bmus: Readonly<Record<string, string>> = BMU_SITE,
): UnitReading[] {
  const best = new Map<string, PnRow>();
  for (const r of rows ?? []) {
    const unit = r.bmUnit ?? "";
    if (!bmus[unit] || !r.timeFrom || typeof r.levelFrom !== "number") continue;
    const from = Date.parse(r.timeFrom);
    const prev = best.get(unit);
    const covers = (x: PnRow) => Date.parse(x.timeFrom!) <= now && now < Date.parse(x.timeTo ?? x.timeFrom!);
    if (!prev || (covers(r) && !covers(prev)) || (!covers(prev) && from > Date.parse(prev.timeFrom!))) best.set(unit, r);
  }
  return [...best.entries()].map(([unit, r]) => ({
    unit,
    site: bmus[unit],
    source: "Elexon" as const,
    mw: Math.max(0, Math.round(r.levelFrom!)),
    at: r.timeFrom!,
  }));
}

/** Pure: the IESO GenOutputCapability XML → each listed unit's latest hourly output. */
export function parseIesoXml(xml: string, gens: Readonly<Record<string, string>> = IESO_SITE): UnitReading[] {
  const date = /<Date>(\d{4}-\d{2}-\d{2})<\/Date>/.exec(xml)?.[1] ?? "";
  const out: UnitReading[] = [];
  const re = /<Generator>([\s\S]*?)<\/Generator>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const name = /<GeneratorName>([^<]+)<\/GeneratorName>/.exec(block)?.[1]?.trim() ?? "";
    const site = gens[name];
    if (!site) continue;
    const outputs = /<Outputs>([\s\S]*?)<\/Outputs>/.exec(block)?.[1] ?? "";
    let hour = 0;
    let mw: number | undefined;
    for (const o of outputs.matchAll(/<Hour>(\d+)<\/Hour>\s*<EnergyMW>(-?[\d.]+)<\/EnergyMW>/g)) {
      const h = Number(o[1]);
      if (h >= hour) {
        hour = h;
        mw = Number(o[2]);
      }
    }
    if (mw === undefined || !Number.isFinite(mw)) continue;
    // IESO's market day runs on Eastern Standard Time all year; hour N ends at N:00 EST.
    out.push({ unit: name, site, source: "IESO", mw: Math.max(0, Math.round(mw)), at: `${date} hour ${hour} EST` });
  }
  return out;
}

export interface EiaRow {
  period?: string;
  facility?: string;
  capacity?: string | number;
  outage?: string | number;
}

/** Pure: EIA facility-nuclear-outages rows → each placeable plant's newest day. */
export function parseEiaOutages(
  rows: EiaRow[],
  plants: Readonly<Record<string, string>> = EIA_PLANT_SITE,
): SiteOutage[] {
  const best = new Map<string, SiteOutage>();
  for (const r of rows ?? []) {
    const site = plants[String(r.facility ?? "")];
    const outageMw = Number(r.outage);
    const capacityMw = Number(r.capacity);
    if (!site || !r.period || !Number.isFinite(outageMw) || !Number.isFinite(capacityMw)) continue;
    const prev = best.get(site);
    if (prev && prev.at > r.period) continue;
    // Two EIA plant codes on one OSM site (Salem + Hope Creek) add up on the same day.
    if (prev && prev.at === r.period) {
      best.set(site, { site, outageMw: prev.outageMw + outageMw, capacityMw: prev.capacityMw + capacityMw, at: r.period });
    } else {
      best.set(site, { site, outageMw, capacityMw, at: r.period });
    }
  }
  return [...best.values()];
}

/** Pure: plant features + readings → features with the live props. Never adds or
 *  drops a pin. */
export function applyNuclearLive(
  features: SignalFeature[],
  readings: UnitReading[],
  outages: SiteOutage[] = [],
): SignalFeature[] {
  const bySite = new Map<string, UnitReading[]>();
  for (const r of readings) bySite.set(r.site, [...(bySite.get(r.site) ?? []), r]);
  const outBySite = new Map(outages.map((o) => [o.site, o]));
  return features.map((f) => {
    const site = f.id.replace(/^nuclear:/, "");
    const rs = bySite.get(site);
    const outage = outBySite.get(site);
    if (!rs?.length && !outage) return f;
    const extra: Record<string, unknown> = {};
    if (rs?.length) {
      rs.sort((a, b) => a.unit.localeCompare(b.unit, "en", { numeric: true }));
      const sources = [...new Set(rs.map((r) => r.source))];
      extra.liveSource = sources.join(", ");
      extra.liveAt = rs.map((r) => r.at).sort().pop();
      extra.unitsReporting = rs.length;
      extra.unitsGenerating = rs.filter((r) => (r.pct ?? r.mw ?? 0) > 0).length;
      extra.liveUnits = rs.map((r) => `${r.unit} ${r.pct != null ? `${r.pct}%` : `${r.mw} MW`}`).join(", ");
      const pcts = rs.filter((r) => r.pct != null).map((r) => r.pct!);
      if (pcts.length) extra.powerPct = Math.round(pcts.reduce((s, v) => s + v, 0) / pcts.length);
      const mws = rs.filter((r) => r.mw != null).map((r) => r.mw!);
      if (mws.length) extra.outputNowMw = mws.reduce((s, v) => s + v, 0);
    }
    if (outage) {
      extra.outageMw = Math.round(outage.outageMw);
      extra.outageAt = outage.at;
    }
    return { ...f, props: { ...(f.props ?? {}), ...extra } };
  });
}

/** Elexon settlement date and period for an instant: half hours since UK local
 *  midnight, so a clock-change day has 46 or 50 periods, as Elexon counts them. */
export function settlementPeriod(now: number): { date: string; period: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  // UK clocks change at 01:00 UTC, so at local midnight the offset is the one in force
  // an hour before UTC midnight: +1 h in summer time, 0 in winter.
  const hourAt = (t: number) =>
    Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
  const offsetH = (hourAt(utcMidnight - 3_600_000) + 1) % 24; // 23+1 → 0 (GMT), 0+1 → 1 (BST)
  const localMidnight = utcMidnight - offsetH * 3_600_000;
  return { date, period: Math.floor((now - localMidnight) / 1_800_000) + 1 };
}
