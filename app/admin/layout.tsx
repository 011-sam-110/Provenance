import type { Metadata } from "next";
import Link from "next/link";
import { assertDevOnly } from "@/lib/discovery/devOnly";
import "./admin.css";

/**
 * /admin — the curation tools, and the only part of this repository that is not
 * meant to be reachable by the public.
 *
 * THE GATE IS THE WHOLE SECURITY MODEL, so it is worth being blunt about what it is
 * and is not. Every route under here returns 404 when NODE_ENV is production, which
 * on Vercel is every deployment. There is no password, no session and no rate limit,
 * because there is no listener: the tools run against `npm run dev` on a laptop, and
 * the thing they write is a file in the working tree that a person then commits.
 *
 * That is a deliberate trade against the alternative. The previous attempt at an
 * operator surface here needed a passphrase, a TOTP secret, a lockout policy, a
 * signed session cookie and a Postgres to keep the attempt log in — six new pieces of
 * security-critical code and a database this repo does not otherwise have, all to
 * protect a review queue. Not deploying it protects the review queue completely, and
 * the review queue does not need to be online: it needs to be next to the git
 * checkout the verdicts are committed to.
 *
 * If this ever does need to be hosted, `feat/ops-analytics` has the wall already
 * built and reviewed. Reach for that rather than bolting a check onto this.
 *
 * `tests/unit/discovery-admin-gate.test.ts` asserts that every route file under
 * `app/admin` and `app/api/admin` carries the guard, by reading the files — so a new
 * route added without one fails the suite rather than shipping.
 */

export const metadata: Metadata = {
  title: "Curation — Provenance",
  // Belt and braces. The gate means a crawler cannot reach these, but a stray
  // preview deployment with NODE_ENV unset should still never be indexed.
  robots: { index: false, follow: false },
};

const NAV = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/verify", label: "Verify cameras" },
  { href: "/admin/analytics", label: "Traffic" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  assertDevOnly();
  return (
    <div className="adm-root">
      <header className="adm-bar">
        <span className="adm-brand">
          Provenance <span className="adm-brand-sub">curation</span>
        </span>
        <nav className="adm-nav">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="adm-navlink">
              {n.label}
            </Link>
          ))}
        </nav>
        <span className="adm-env" title="These routes 404 in production. There is no wall because there is no deployment.">
          dev only
        </span>
      </header>
      <main className="adm-main">{children}</main>
    </div>
  );
}
