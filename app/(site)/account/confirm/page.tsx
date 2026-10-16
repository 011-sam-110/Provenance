import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { accountsConfigured } from "@/lib/account/config";
import ConfirmView from "@/components/account/ConfirmView";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Account · ${BRAND.name}`,
  robots: { index: false, follow: false },
};

export default function ConfirmPage() {
  // A build with no account settings has no account pages. The value is fixed at build time.
  if (!accountsConfigured()) notFound();
  return (
    <>
      <div className="pv-ground" aria-hidden="true" />
      <div className="pv-doc">
        <section className="pv-block">
          <ConfirmView />
        </section>
      </div>
      {/* AGPL-3.0 section 13: every page a visitor can land on offers the source, and an
          email link lands here. The page shows no third-party data, so it carries the
          /privacy footer without the attribution column or the description. */}
      <footer className="pv-footer">
        <div className="pv-footer-inner">
          {/* No BRAND.description: it says "No login", and this page exists only in a
              build that has accounts. That sentence changes at M5 (see the plan). */}
          <div>
            <h4>{BRAND.name}</h4>
            <a href="/">Home</a>
            <a href="/app">Open the map</a>
          </div>
          <div>
            <h4>The code</h4>
            <a href={BRAND.repoUrl} target="_blank" rel="noreferrer noopener">GitHub</a>
            <a href={BRAND.license.url} target="_blank" rel="noreferrer noopener">
              Licence ({BRAND.license.short})
            </a>
            <p>
              &copy; {BRAND.license.year} {BRAND.license.holder}. {BRAND.name} is free software
              under the {BRAND.license.name}.
            </p>
          </div>
        </div>
      </footer>
    </>
  );
}
