"use client";
// The network dossier: what the search box's "Locate network" found for an IP or a
// domain. It renders in the Inspector panel like every other dossier (lib/overlay-content
// .tsx), from three answers:
//
//   Location    /api/recon/geo (through lib/recon/ipLocate.ts): MaxMind GeoLite2 via RIPEstat
//   Network     /api/recon/bgp: the origin ASN, its holder, the prefix and the PTR
//   Reputation  /api/recon/threat: Shodan InternetDB tags and CVEs
//
// What it never does: name a point. The source's coordinates are not printed and not
// drawn; the map shows the country, or a circle when a radius is published
// (lib/recon/geo.ts has the rules). It carries NOT_A_PERSON at the top, and the
// MaxMind credit that the GeoLite licence asks for at the bottom.

import { useEffect, useState } from "react";
import type { WorldObject } from "@/lib/world";
import { NOT_A_PERSON, GEOLITE_CREDIT, hostingNetwork, verdictOf, type GeoLocation } from "@/lib/recon/geo";
import { countryName, useIpLocate } from "@/lib/recon/ipLocate";
import { openReconTools } from "@/lib/recon/openTools";
import { overlay } from "@/lib/overlay";

interface BgpData {
  ok: boolean;
  asn?: number;
  name?: string;
  ptr?: string;
  prefixes?: { prefix: string }[];
}
interface ThreatData {
  ok: boolean;
  baseline?: { tags: string[]; vulns: string[]; flagged: boolean } | null;
  providers?: { id: string; state?: string; locked?: boolean }[];
}

/** One GET of a recon route for this IP; null while it loads or when it fails. */
function useRecon<T>(tool: "bgp" | "threat", ip: string | undefined): { done: boolean; data: T | null } {
  const [state, setState] = useState<{ for: string; data: T | null } | null>(null);
  useEffect(() => {
    if (!ip) return;
    let alive = true;
    fetch(`/api/recon/${tool}?target=${encodeURIComponent(ip)}`)
      .then((r) => r.json())
      .then((d) => alive && setState({ for: ip, data: d as T }))
      .catch(() => alive && setState({ for: ip, data: null }));
    return () => {
      alive = false;
    };
  }, [tool, ip]);
  const done = !!ip && state?.for === ip;
  return { done, data: done ? state!.data : null };
}

function placeOf(l: GeoLocation): string {
  return l.countryOnly ? countryName(l.country) : `${l.city}, ${countryName(l.country)}`;
}

function dateOf(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export default function NetworkDetail({ object }: { object: WorldObject }) {
  const look = useIpLocate();
  const result = look.result;
  const ip = result?.ip;
  const bgp = useRecon<BgpData>("bgp", ip);
  const threat = useRecon<ThreatData>("threat", ip);
  const [opened, setOpened] = useState<string | null>(null);

  // The dossier belongs to the look-up in the store. A stale object (a reload, or an
  // older look-up) has nothing behind it, so it says so rather than inventing a result.
  const current = look.status !== "idle" && object.id === `net:${look.target}`;
  if (!current) {
    return (
      <div className="tn-net">
        <h3 className="tn-net-title">{object.label}</h3>
        <p className="tn-net-muted">This look-up is closed. Search for the IP or domain again to see it.</p>
      </div>
    );
  }

  const locations = result?.locations ?? [];
  const hosting = hostingNetwork(bgp.data?.asn);
  const countryOnly = locations.length > 0 && locations.every((l) => l.countryOnly);
  const flags = [
    countryOnly ? "Country only" : null,
    hosting ? `Cloud or CDN: ${hosting}` : null,
    locations.length > 1 ? "Several places" : null,
  ].filter((f): f is string => f !== null);
  const reputation = threat.data?.baseline;
  const keyedProviders = threat.data?.providers?.filter((p) => p.state !== "on").length ?? 0;
  const dataDate = dateOf(result?.dataDate);

  return (
    <div className="tn-net" data-testid="network-detail">
      <h3 className="tn-net-title">{look.target}</h3>
      {result?.resolvedFrom && ip && (
        <p className="tn-net-muted">Resolves to <span className="tn-net-mono">{ip}</span>, its first A record.</p>
      )}
      <p className="tn-net-fixed">{NOT_A_PERSON}</p>
      {flags.length > 0 && (
        <ul className="tn-net-flags" aria-label="Flags">
          {flags.map((f) => <li key={f}>{f}</li>)}
        </ul>
      )}

      <section className="tn-net-section" aria-labelledby="tn-net-loc">
        <h4 id="tn-net-loc">Location</h4>
        {look.status === "loading" && <p className="tn-net-muted">Looking up {look.target}…</p>}
        {look.status === "error" && (
          <p className="tn-net-error">{result?.reason ?? "IP location failed."} Nothing is drawn on the map.</p>
        )}
        {look.status === "ready" && (
          <>
            <p className="tn-net-verdict">{verdictOf(locations, countryName)}</p>
            {locations.length > 0 && (
              <dl className="tn-net-rows">
                {locations.map((l, i) => (
                  <div key={`${l.country}:${l.city}:${i}`} className="tn-net-row">
                    <dt>Place</dt>
                    <dd>{placeOf(l)}</dd>
                    <dt>Precision</dt>
                    <dd>{l.countryOnly ? "country only" : "city"}</dd>
                    <dt>Radius</dt>
                    <dd>{l.radiusKm !== null ? `${Math.round(l.radiusKm)} km` : "not published by this source"}</dd>
                    {locations.length > 1 && (
                      <>
                        <dt>Covers</dt>
                        <dd>{Math.round(l.coveredPct)}% of the addresses</dd>
                      </>
                    )}
                  </div>
                ))}
              </dl>
            )}
            {countryOnly && (
              <p className="tn-net-note">
                MaxMind gives a country&rsquo;s centre point when it knows no city. For the US that point
                is a reservoir in Kansas. It is not a place, so the map shows the whole country.
              </p>
            )}
            {locations.length > 0 && !countryOnly && locations.every((l) => l.radiusKm === null) && (
              <p className="tn-net-note">
                The map shows the country. A smaller area needs a published accuracy radius, and this
                source publishes none.
              </p>
            )}
            {hosting && (
              <p className="tn-net-note">
                This address is in {hosting}&rsquo;s network, so the place is a server or a data centre,
                not the owner of the site.
              </p>
            )}
          </>
        )}
      </section>

      <section className="tn-net-section" aria-labelledby="tn-net-net">
        <h4 id="tn-net-net">Network</h4>
        {!ip ? (
          <p className="tn-net-muted">Waits for the IP.</p>
        ) : !bgp.done ? (
          <p className="tn-net-muted">Looking up the route…</p>
        ) : !bgp.data?.ok ? (
          <p className="tn-net-muted">No routing answer for this IP.</p>
        ) : (
          <dl className="tn-net-rows">
            <div className="tn-net-row">
              {bgp.data.asn != null && (<><dt>ASN</dt><dd className="tn-net-mono">AS{bgp.data.asn}</dd></>)}
              {bgp.data.name && (<><dt>Holder</dt><dd>{bgp.data.name}</dd></>)}
              {bgp.data.prefixes?.[0] && (<><dt>Prefix</dt><dd className="tn-net-mono">{bgp.data.prefixes[0].prefix}</dd></>)}
              {bgp.data.ptr && (<><dt>PTR</dt><dd className="tn-net-mono">{bgp.data.ptr}</dd></>)}
            </div>
          </dl>
        )}
      </section>

      <section className="tn-net-section" aria-labelledby="tn-net-rep">
        <h4 id="tn-net-rep">Reputation</h4>
        {!ip ? (
          <p className="tn-net-muted">Waits for the IP.</p>
        ) : !threat.done ? (
          <p className="tn-net-muted">Looking up the reputation…</p>
        ) : !reputation ? (
          <p className="tn-net-muted">No reputation answer for this IP.</p>
        ) : (
          <p>
            {reputation.flagged
              ? `Shodan InternetDB lists ${reputation.tags.length} tags and ${reputation.vulns.length} CVEs for this IP.`
              : "Shodan InternetDB lists no tags and no CVEs for this IP."}
            {keyedProviders > 0 && ` ${keyedProviders} more providers need a key.`}
          </p>
        )}
      </section>

      <div className="tn-net-actions">
        <button
          type="button"
          className="tn-net-btn"
          onClick={() => {
            const r = openReconTools(look.target);
            setOpened(
              r.missing > 0
                ? `Opened ${r.added} recon tools. The board is full, so ${r.missing} did not fit.`
                : r.added > 0
                  ? `Opened ${r.added} recon tools in the right rail, all set to ${look.target}.`
                  : `The six recon tools are on the board, now set to ${look.target}.`,
            );
          }}
        >
          Open the six recon tools
        </button>
        <button type="button" className="tn-net-btn is-quiet" onClick={() => overlay.close()}>
          Clear
        </button>
      </div>
      {opened && <p className="tn-net-muted" role="status">{opened}</p>}

      <p className="tn-net-foot">
        Not saved as a pin. Closing this takes the area off the map.
        {" "}Location data: MaxMind GeoLite2, through RIPEstat{dataDate ? `, data of ${dataDate}` : ""}. {GEOLITE_CREDIT}
      </p>
    </div>
  );
}
