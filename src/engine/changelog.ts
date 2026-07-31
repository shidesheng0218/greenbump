const FETCH_TIMEOUT_MS = 8_000;
const MAX_CHANGELOG_CHARS = 6_000;

async function timedFetch(url: string, headers?: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

function truncate(s: string): string {
  return s.length > MAX_CHANGELOG_CHARS ? s.slice(0, MAX_CHANGELOG_CHARS) + "\n...(truncated)" : s;
}

interface NpmRepo {
  repository?: { url?: string } | string;
}

/** Extract an `owner/repo` slug from npm's registry metadata, if it points at GitHub. */
async function githubSlug(pkgName: string): Promise<string | null> {
  const res = await timedFetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}/latest`);
  if (!res) return null;
  const data = (await res.json().catch(() => null)) as NpmRepo | null;
  const url = typeof data?.repository === "string" ? data.repository : data?.repository?.url;
  if (!url) return null;
  const m = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Try GitHub's release notes for a version tag, trying a couple of common tag formats. */
async function githubRelease(slug: string, version: string): Promise<string | null> {
  for (const tag of [version, `v${version}`]) {
    const res = await timedFetch(`https://api.github.com/repos/${slug}/releases/tags/${tag}`, {
      Accept: "application/vnd.github+json",
    });
    if (!res) continue;
    const data = (await res.json().catch(() => null)) as { body?: string; name?: string } | null;
    if (data?.body) return `## ${data.name ?? tag}\n\n${data.body}`;
  }
  return null;
}

/**
 * Best-effort fetch of release notes / changelog for the version range being
 * upgraded to, to give the fix agent real migration guidance instead of
 * making it guess from the error alone. Never throws — returns null on any
 * failure (offline, rate-limited, no GitHub repo, etc).
 */
export async function fetchChangelog(pkgName: string, from: string, to: string): Promise<string | null> {
  try {
    const slug = await githubSlug(pkgName);
    if (!slug) return null;
    const notes = await githubRelease(slug, to);
    if (!notes) return null;
    return truncate(notes);
  } catch {
    return null;
  }
}
