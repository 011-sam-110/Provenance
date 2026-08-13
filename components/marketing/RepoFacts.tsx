/**
 * Real repository facts, read from the GitHub API at render time (revalidated
 * hourly) rather than typed into the page.
 *
 * The licence row is the reason this component exists. A page arguing that open
 * source is what makes a number checkable has to show its own licence, and if
 * there isn't one it has to say so — an unlicensed public repo is visible source,
 * not open source, and quietly omitting the row would be the exact dishonesty the
 * rest of the page is against.
 */

interface Repo {
  license?: { spdx_id?: string; name?: string } | null;
  stargazers_count?: number;
  pushed_at?: string;
}

async function fetchRepo(repo: string): Promise<Repo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
      // This runs inside the page's own render. Unauthenticated GitHub allows 60
      // requests an hour per IP, so on a shared production address it will
      // sometimes be slow or 403 — and without a ceiling that latency becomes the
      // landing page's latency. Three seconds, then render the panel without it.
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Repo;
  } catch {
    return null;
  }
}

export default async function RepoFacts({ repo, adapters }: { repo: string; adapters: number }) {
  const data = await fetchRepo(repo);
  const spdx = data?.license?.spdx_id;
  const licensed = Boolean(spdx) && spdx !== "NOASSERTION";
  const pushed = data?.pushed_at ? new Date(data.pushed_at) : null;

  return (
    <dl className="pv-facts" data-pv-parallax="34">
      <div>
        <dt>Repository</dt>
        <dd>{repo.split("/")[1]}</dd>
      </div>
      <div>
        <dt>Licence</dt>
        <dd className={licensed ? undefined : "pv-flag"}>
          {data === null ? "unavailable" : licensed ? spdx : "none yet"}
        </dd>
      </div>
      <div>
        <dt>Adapters</dt>
        <dd>{adapters}</dd>
      </div>
      <div>
        <dt>Stars</dt>
        <dd>{data?.stargazers_count ?? "—"}</dd>
      </div>
      <div>
        <dt>Last push</dt>
        <dd>{pushed ? pushed.toISOString().slice(0, 10) : "—"}</dd>
      </div>
    </dl>
  );
}
