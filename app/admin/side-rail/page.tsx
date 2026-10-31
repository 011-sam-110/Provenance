import { assertDevOnly } from "@/lib/discovery/devOnly";
import RailFixture from "./RailFixture";

/**
 * /admin/side-rail: the page tests/e2e/side-rail.spec.ts drives. It is not a tool and no
 * menu links to it.
 *
 * IT LIVES UNDER /admin FOR THE GATE. Every route here returns 404 in production, and
 * tests/unit/discovery-admin-gate.test.ts reads this directory, so this page cannot lose
 * its guard without the suite failing. A new dev-only route anywhere else would need a
 * second gate and a second test for it.
 *
 * `searchParams` is read here on the server so the spec drives the same server render a
 * real host gets. `useSearchParams` in the client would skip it and render on the client.
 */
export default async function SideRailFixturePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  assertDevOnly();
  const { tone, surface } = await searchParams;
  return (
    <RailFixture tone={tone === "skin" ? "skin" : "dark"} surface={surface === "console" ? "console" : "eye"} />
  );
}
