import type { Provider } from "../../agent/provider.js";
import { getCache } from "../cache/manager.js";

/**
 * Deep changelog analysis: instead of dumping raw release notes into the
 * fix prompt (expensive, unfocused), we pre-digest them ONCE into a
 * structured list of breaking changes with concrete migrations.
 *
 * Benefits:
 * - The fix loop gets a short, authoritative checklist instead of 6k chars
 *   of prose (saves tokens on every round, since the changelog is in the
 *   initial prompt which is re-sent each round).
 * - The structured result is cached per (package, version-range) so the
 *   digest cost is paid at most once per upgrade path, across all projects.
 * - The breaking-change list doubles as input for AST verification: we can
 *   check whether each flagged API actually appears in the project.
 */

export interface BreakingChange {
  /** what changed, one sentence */
  description: string;
  /** the old API (function/export/pattern) that no longer works */
  oldApi: string;
  /** what to replace it with */
  newApi: string;
  /** severity for prioritization */
  severity: "low" | "medium" | "high";
  /** a short code example of the migration, if the changelog has one */
  example?: string;
}

export interface ChangelogDigest {
  packageName: string;
  fromVersion: string;
  toVersion: string;
  breakingChanges: BreakingChange[];
  /** true when the digest came from cache (no LLM call was made) */
  fromCache: boolean;
  /** tokens spent producing the digest (0 when cached) */
  tokensUsed: { inputTokens: number; outputTokens: number };
}

const DIGEST_PROMPT = (pkg: string, from: string, to: string, changelog: string) =>
  `You are analyzing release notes for a dependency upgrade. Extract ONLY the breaking changes.

Package: ${pkg}
Upgrade: ${from} → ${to}

Release notes:
"""
${changelog}
"""

Respond with a JSON array (and NOTHING else — no markdown fences, no commentary):
[
  {
    "description": "one sentence about what changed",
    "oldApi": "the exact old API/usage that breaks (e.g. ReactDOM.render(el, container))",
    "newApi": "the replacement (e.g. createRoot(container).render(el))",
    "severity": "low" | "medium" | "high",
    "example": "optional short code snippet of the migration"
  }
]

Rules:
- Include ONLY breaking changes (removed APIs, renamed exports, changed required signatures, behavior changes that break existing code). Skip new features, bug fixes, deprecations that still work.
- If there are no breaking changes, respond with [].
- oldApi/newApi must be concrete enough to search for in source code.`;

/**
 * Produce a structured digest of the changelog, cached per upgrade path.
 * Returns null when there's no changelog to digest.
 */
export async function digestChangelog(
  provider: Provider,
  packageName: string,
  from: string,
  to: string,
  changelog: string | null,
): Promise<ChangelogDigest | null> {
  if (!changelog) return null;

  const cache = getCache();
  await cache.init();
  const cacheKey = `digest::${packageName}--${from}--${to}`;

  const cached = await cache.getLlmFix(cacheKey);
  if (cached) {
    try {
      const breakingChanges = JSON.parse((cached.edits as any)["__digest__"] ?? "[]") as BreakingChange[];
      return {
        packageName,
        fromVersion: from,
        toVersion: to,
        breakingChanges,
        fromCache: true,
        tokensUsed: { inputTokens: 0, outputTokens: 0 },
      };
    } catch {
      // corrupt cache entry — fall through and re-digest
    }
  }

  const result = await provider.send(
    "You extract breaking changes from release notes and respond with strict JSON only.",
    [{ role: "user", text: DIGEST_PROMPT(packageName, from, to, changelog) }],
    [],
  );

  let breakingChanges: BreakingChange[] = [];
  try {
    const text = result.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      breakingChanges = parsed.filter(
        (c): c is BreakingChange =>
          typeof c === "object" &&
          c !== null &&
          typeof c.description === "string" &&
          typeof c.oldApi === "string" &&
          typeof c.newApi === "string",
      );
    }
  } catch {
    // Unparseable digest — treat as "no structured info", the raw changelog
    // is still passed to the fix loop as before.
    breakingChanges = [];
  }

  // Cache the digest (reuse the LlmFixCache shape to avoid a second schema)
  await cache.setLlmFix(cacheKey, {
    edits: { __digest__: JSON.stringify(breakingChanges) },
    hits: 0,
    model: provider.model,
  });

  return {
    packageName,
    fromVersion: from,
    toVersion: to,
    breakingChanges,
    fromCache: false,
    tokensUsed: result.usage,
  };
}

/**
 * Render the digest as a compact prompt block for the fix loop.
 * Much cheaper than the raw changelog: ~40 tokens per breaking change.
 */
export function renderDigestForPrompt(digest: ChangelogDigest): string {
  if (digest.breakingChanges.length === 0) return "";
  const lines = digest.breakingChanges.map(
    (c, i) =>
      `${i + 1}. [${c.severity}] ${c.description}\n   Replace: ${c.oldApi}\n   With:    ${c.newApi}`,
  );
  return `\n\nBreaking changes in ${digest.packageName}@${digest.toVersion} (pre-digested from release notes — treat as authoritative):\n${lines.join("\n")}`;
}

/**
 * Which of the breaking changes actually affect this project?
 * Cheap substring scan — a breaking change only matters if the old API
 * string appears somewhere in the project's source.
 */
export async function findApplicableChanges(
  digest: ChangelogDigest,
  searchCode: (query: string) => Promise<string>,
): Promise<BreakingChange[]> {
  const applicable: BreakingChange[] = [];
  for (const change of digest.breakingChanges) {
    // Search for the core identifier of the old API (e.g. "ReactDOM.render")
    const probe = change.oldApi.split("(")[0].trim();
    if (probe.length < 4) continue;
    try {
      const hits = await searchCode(probe);
      if (hits && hits !== "(no matches)") applicable.push(change);
    } catch {
      // search failed — include the change to be safe
      applicable.push(change);
    }
  }
  return applicable;
}
