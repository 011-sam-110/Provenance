"use client";
// OSINT "Tools" — six passive, keyless recon widgets sharing ONE target. Type a
// domain / IP / ASN into any card and all six re-resolve it via their own
// /api/recon/<tool> route. One file registers all six (mirroring signals.tsx),
// each = the shared target input + a tool-specific renderer + honest
// empty/loading/error states. Result shapes are read loosely from the route JSON
// so this stays decoupled from the pure mappers in lib/recon/*.
import { useEffect, useState } from "react";
import { registerWidget, type WidgetBodyProps } from "@/lib/console/registry";
import { useWidgetReport } from "@/components/console/WidgetFrame";
import { reconTargetStore, useReconTarget } from "@/lib/recon/targetStore";

// --- shared lookup hook: fetch /api/recon/<tool> when the target changes -------
type LookupStatus = "empty" | "loading" | "ready" | "error";
interface Lookup<T> { status: LookupStatus; data: T | null; }

function useReconLookup<T = Record<string, unknown>>(tool: string): Lookup<T> {
  const target = useReconTarget();
  const [state, setState] = useState<Lookup<T>>({ status: "empty", data: null });
  useEffect(() => {
    if (!target.value) { setState({ status: "empty", data: null }); return; }
    let alive = true;
    setState((s) => ({ status: "loading", data: s.data }));
    const t = setTimeout(() => {
      fetch(`/api/recon/${tool}?target=${encodeURIComponent(target.value)}`)
        .then((r) => r.json())
        .then((d) => { if (alive) setState({ status: "ready", data: d as T }); })
        .catch(() => { if (alive) setState({ status: "error", data: null }); });
    }, 350); // debounce keystrokes
    return () => { alive = false; clearTimeout(t); };
  }, [tool, target.value]);
  return state;
}

// --- shared target input ------------------------------------------------------
function TargetInput() {
  const target = useReconTarget();
  return (
    <div className="tn-recon-target">
      <input
        type="text"
        value={target.raw}
        placeholder="domain, IP or ASN…"
        aria-label="OSINT target"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => reconTargetStore.set(e.target.value)}
      />
      {target.kind !== "empty" && <span className="tn-recon-kind">{target.kind}</span>}
    </div>
  );
}

/** Wraps a tool renderer with the shared input + honest empty/loading/error states. */
function ToolShell<T>({ tool, label, needs, lookup, children, report }: {
  tool: string; label: string; needs?: string; lookup: Lookup<T>;
  children: (data: T) => React.ReactNode; report: (n: number) => void;
}) {
  const target = useReconTarget();
  useEffect(() => { report(lookup.status === "ready" ? 1 : 0); }, [lookup.status, report]);
  return (
    <div className="tn-recon">
      <TargetInput />
      {lookup.status === "empty" && <p className="tn-w-empty">Enter a {needs ?? "domain or IP"} to begin.</p>}
      {lookup.status === "loading" && !lookup.data && <p className="tn-w-empty">Looking up {target.value}…</p>}
      {lookup.status === "error" && <p className="tn-w-empty">{label} lookup failed.</p>}
      {(lookup.status === "ready" || (lookup.status === "loading" && lookup.data)) && lookup.data && children(lookup.data)}
    </div>
  );
}

const kv = (k: string, v: React.ReactNode) => (
  <div className="tn-recon-row" key={k}><span className="tn-recon-k">{k}</span><span className="tn-recon-v">{v}</span></div>
);
const notOk = (d: { ok?: boolean; reason?: string } | null) => !d?.ok;
function Empty({ reason }: { reason?: string }) { return <p className="tn-w-empty">{reason ?? "No results."}</p>; }

// --- per-tool renderers -------------------------------------------------------
interface DnsRec { type: string; name: string; ttl: number; value: string }
function DnsBody({ report }: { report: (n: number) => void }) {
  const lk = useReconLookup<{ ok: boolean; reason?: string; records: DnsRec[] }>("dns");
  return <ToolShell tool="dns" label="DNS" needs="domain" lookup={lk} report={report}>{(d) =>
    notOk(d) ? <Empty reason={d.reason} /> : (
      <ul className="tn-recon-list">
        {d.records.map((r, i) => (
          <li key={i}><span className="tn-recon-tag">{r.type}</span><span className="tn-recon-mono">{r.value}</span><span className="tn-recon-ttl">{r.ttl}s</span></li>
        ))}
      </ul>
    )}</ToolShell>;
}

interface WhoisData { ok: boolean; reason?: string; kind: string; name?: string; registrar?: string; created?: string; updated?: string; expires?: string; status: string[]; nameservers: string[]; country?: string; range?: string; type?: string; registrant?: string }
function WhoisBody({ report }: { report: (n: number) => void }) {
  const lk = useReconLookup<WhoisData>("whois");
  return <ToolShell tool="whois" label="WHOIS" lookup={lk} report={report}>{(d) =>
    notOk(d) ? <Empty reason={d.reason} /> : (
      <div className="tn-recon-kv">
        {d.name && kv("name", d.name)}
        {d.registrar && kv("registrar", d.registrar)}
        {d.created && kv("created", d.created.slice(0, 10))}
        {d.expires && kv("expires", d.expires.slice(0, 10))}
        {d.registrant && kv("registrant", d.registrant)}
        {d.country && kv("country", d.country)}
        {d.range && kv("range", <span className="tn-recon-mono">{d.range}</span>)}
        {d.nameservers?.length > 0 && kv("nameservers", d.nameservers.join(", "))}
        {d.status?.length > 0 && kv("status", d.status.join(", "))}
      </div>
    )}</ToolShell>;
}

interface CertData { ok: boolean; reason?: string; subdomains: string[]; certs: { issuer: string; commonName: string; notBefore: string; notAfter: string }[]; subdomainCount: number }
function CertsBody({ report }: { report: (n: number) => void }) {
  const lk = useReconLookup<CertData>("certs");
  return <ToolShell tool="certs" label="Certificates" needs="domain" lookup={lk} report={report}>{(d) =>
    notOk(d) ? <Empty reason={d.reason} /> : (
      <div>
        <div className="tn-recon-stat">{d.subdomainCount} subdomains · {d.certs.length} recent certs</div>
        <ul className="tn-recon-list">{d.subdomains.slice(0, 40).map((s) => <li key={s}><span className="tn-recon-mono">{s}</span></li>)}</ul>
      </div>
    )}</ToolShell>;
}

// Mirrors BgpResult in lib/recon/bgp.ts. `announced` and `prefixCount` arrived with
// the move off the shut-down BGPView onto RIPEstat; `description`/`website` did not
// survive it (RIPEstat publishes neither) and are gone rather than left as dead keys.
interface BgpData { ok: boolean; reason?: string; kind: string; asn?: number; name?: string; country?: string; rir?: string; ptr?: string; announced?: boolean; prefixCount?: number; prefixes: { prefix: string; asn?: number; holder?: string; country?: string }[] }
function BgpBody({ report }: { report: (n: number) => void }) {
  const lk = useReconLookup<BgpData>("bgp");
  return <ToolShell tool="bgp" label="BGP" needs="IP or ASN" lookup={lk} report={report}>{(d) =>
    notOk(d) ? <Empty reason={d.reason} /> : (
      <div className="tn-recon-kv">
        {d.asn != null && kv("ASN", <span className="tn-recon-mono">AS{d.asn}</span>)}
        {d.name && kv("holder", d.name)}
        {d.country && kv("country", d.country)}
        {d.ptr && kv("PTR", <span className="tn-recon-mono">{d.ptr}</span>)}
        {/* Whether the global routing table currently carries it. An allocated
            but unrouted ASN is a real answer, so false is shown, not hidden. */}
        {d.announced != null && kv("routed", d.announced ? "yes — visible in the global table" : "no — allocated but not announced")}
        {d.rir && kv("registry", d.rir)}
        {d.prefixes?.length > 0 && kv(
          d.prefixCount && d.prefixCount > d.prefixes.length
            ? `prefixes (${d.prefixes.slice(0, 8).length} of ${d.prefixCount.toLocaleString()})`
            : "prefixes",
          <span className="tn-recon-mono">{d.prefixes.slice(0, 8).map((p) => p.prefix).join(", ")}</span>,
        )}
      </div>
    )}</ToolShell>;
}

interface PortsData { ok: boolean; reason?: string; ip: string; ports: number[]; cpes: string[]; hostnames: string[]; vulns: string[] }
function PortsBody({ report }: { report: (n: number) => void }) {
  const lk = useReconLookup<PortsData>("ports");
  return <ToolShell tool="ports" label="Ports" lookup={lk} report={report}>{(d) =>
    notOk(d) ? <Empty reason={d.reason} /> : (
      <div>
        {d.ip && <div className="tn-recon-stat">{d.ip} · {d.ports.length} open ports{d.vulns.length ? ` · ${d.vulns.length} CVEs` : ""}</div>}
        <div className="tn-recon-ports">{d.ports.map((p) => <span key={p} className="tn-recon-port">{p}</span>)}</div>
        {d.vulns?.length > 0 && <div className="tn-recon-vulns">{d.vulns.slice(0, 12).map((v) => <span key={v} className="tn-recon-cve">{v}</span>)}</div>}
      </div>
    )}</ToolShell>;
}

interface ThreatData { ok: boolean; reason?: string; ip?: string; baseline?: { ip: string; tags: string[]; vulns: string[]; flagged: boolean } | null; providers: { id: string; label: string; envKey: string; locked: boolean }[] }
function ThreatBody({ report }: { report: (n: number) => void }) {
  const lk = useReconLookup<ThreatData>("threat");
  return <ToolShell tool="threat" label="Threat intel" lookup={lk} report={report}>{(d) => (
    <div>
      {d.baseline?.flagged ? (
        <div className="tn-recon-stat tn-recon-flagged">⚠ {d.baseline.tags.length} tags · {d.baseline.vulns.length} CVEs</div>
      ) : d.baseline ? (
        <div className="tn-recon-stat">✓ no InternetDB tags or CVEs</div>
      ) : d.reason ? <Empty reason={d.reason} /> : null}
      {d.baseline?.tags?.length ? <div className="tn-recon-vulns">{d.baseline.tags.map((t) => <span key={t} className="tn-recon-cve">{t}</span>)}</div> : null}
      {d.providers?.length > 0 && (
        <div className="tn-recon-providers">
          {d.providers.map((p) => (
            <div key={p.id} className={`tn-recon-provider${p.locked ? " is-locked" : ""}`}>
              <span>{p.locked ? "🔒" : "✓"} {p.label}</span>
              {p.locked && <span className="tn-recon-env">set {p.envKey}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )}</ToolShell>;
}

// --- registration -------------------------------------------------------------
function bodyFor(Comp: (p: { report: (n: number) => void }) => React.ReactNode) {
  return function ReconWidget(_p: WidgetBodyProps) {
    const report = useWidgetReport();
    const set = (n: number) => report({ alerts: [], count: n, freshLabel: "lookup" });
    return <Comp report={set} />;
  };
}

const TOOLS: { id: string; title: string; icon: string; help: { what: string; source: string }; body: (p: { report: (n: number) => void }) => React.ReactNode }[] = [
  { id: "dns", title: "DNS records", icon: "🌐",
    help: { what: "Type a domain to resolve its live DNS — A/AAAA/MX/TXT/NS — so you can see where it points and who handles its mail. Passive; nothing is sent to the target.", source: "Cloudflare DNS-over-HTTPS (keyless)" },
    body: DnsBody },
  { id: "whois", title: "WHOIS / RDAP", icon: "📄",
    help: { what: "Registration details for a domain or IP — registrar, org and key dates — from the authoritative registries.", source: "rdap.org (regional internet registries), keyless" },
    body: WhoisBody },
  { id: "certs", title: "Certificates & subdomains", icon: "🔏",
    help: { what: "Every TLS certificate ever issued for a domain, which quietly enumerates its subdomains.", source: "crt.sh Certificate Transparency logs (keyless)" },
    body: CertsBody },
  { id: "bgp", title: "BGP / ASN", icon: "🛰",
    help: { what: "The autonomous system and network that announces an IP or domain to the internet — who really hosts it.", source: "BGPView routing data (keyless)" },
    body: BgpBody },
  { id: "ports", title: "Ports & services", icon: "🔌",
    help: { what: "Internet-facing ports and services already observed for a host. Passive lookup only — no scan is performed from here.", source: "Shodan InternetDB (keyless, passive)" },
    body: PortsBody },
  { id: "threat", title: "Threat intel", icon: "🛡",
    help: { what: "A quick reputation read on a host — known-bad tags and blocklist hits — to gauge whether it's flagged anywhere.", source: "Shodan InternetDB + public DNS blocklists (keyless)" },
    body: ThreatBody },
];

for (const t of TOOLS) {
  registerWidget({
    id: `recon:${t.id}`,
    title: t.title,
    icon: t.icon,
    category: "Tools",
    defaultHeight: 240,
    defaultConfig: {},
    component: bodyFor(t.body),
    help: t.help,
  });
}
