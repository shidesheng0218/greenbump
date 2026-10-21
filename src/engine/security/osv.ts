import { fetchWithTimeout } from "../ecosystems/http.js";
import { compareVersions, parseVersion } from "../semver-lite.js";

/**
 * Vulnerability lookups via osv.dev (Google's open database).
 *
 * No SDK, no API key: one HTTPS POST. Security-driven upgrades are the
 * highest-urgency upgrades there are, and they are exactly the ones that
 * break code — which is the problem greenbump already solves.
 */

export type Severity = "critical" | "high" | "medium" | "low" | "unknown";

export interface Vulnerability {
  /** OSV id, e.g. "GHSA-…" or "CVE-2024-…" */
  id: string;
  summary: string;
  severity: Severity;
  /** CVE/GHSA cross-references */
  aliases: string[];
  /** first versions that fix this advisory, if the database says */
  fixedVersions: string[];
  url: string;
}

/** Map a greenbump ecosystem id onto an osv.dev ecosystem name. */
export function osvEcosystem(pm: string): string | null {
  switch (pm) {
    case "npm":
    case "yarn":
    case "pnpm":
      return "npm";
    case "pip":
    case "poetry":
    case "uv":
    case "pipenv":
      return "PyPI";
    case "cargo":
      return "crates.io";
    case "go":
      return "Go";
    case "maven":
    case "gradle":
      return "Maven";
    case "composer":
      return "Packagist";
    case "bundler":
      return "RubyGems";
    case "nuget":
      return "NuGet";
    case "pub":
      return "Pub";
    case "mix":
      return "Hex";
    case "swiftpm":
      return "SwiftURL";
    case "conan":
      return "ConanCenter";
    default:
      return null;
  }
}

interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
}

interface OsvVuln {
  id?: string;
  summary?: string;
  aliases?: string[];
  database_specific?: { severity?: string };
  severity?: Array<{ type?: string; score?: string }>;
  affected?: Array<{ ranges?: Array<{ type?: string; events?: OsvEvent[] }> }>;
  references?: Array<{ type?: string; url?: string }>;
}

/** CVSS v3 base score → coarse severity band. */
function severityFromCvss(score: number): Severity {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

/**
 * Normalize an advisory's severity. Split out and exported so it can be
 * tested without network access.
 *
 * GitHub advisories (the bulk of OSV's npm records) report severity in
 * database_specific using GitHub's own vocabulary — CRITICAL / HIGH /
 * MODERATE / LOW — where "MODERATE" must map to medium. Treating it as
 * unknown understated roughly half of the real lodash advisories.
 */
export function normalizeSeverity(databaseSeverity?: string, scores?: string[]): Severity {
  const raw = databaseSeverity?.toLowerCase();
  if (raw) {
    if (raw === "critical") return "critical";
    if (raw === "high") return "high";
    if (raw === "moderate" || raw === "medium") return "medium";
    if (raw === "low") return "low";
  }

  for (const score of scores ?? []) {
    // Usually a CVSS *vector* ("CVSS:3.1/AV:N/…"), not a number. Only numeric
    // scores are usable without re-deriving the base score, so vector-only
    // records stay "unknown" rather than being guessed at.
    const n = Number(score);
    if (Number.isFinite(n)) return severityFromCvss(n);
  }
  return "unknown";
}

function extractSeverity(v: OsvVuln): Severity {
  return normalizeSeverity(
    v.database_specific?.severity,
    (v.severity ?? []).map((s) => s.score ?? ""),
  );
}

function extractFixedVersions(v: OsvVuln): string[] {
  const fixed: string[] = [];
  for (const affected of v.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      for (const event of range.events ?? []) {
        if (event.fixed) fixed.push(event.fixed);
      }
    }
  }
  return [...new Set(fixed)].filter((f) => parseVersion(f) !== null);
}

/** The lowest "fixed" version greater than the installed one, if any. */
export function minimalFix(current: string, vulns: Vulnerability[]): string | null {
  const candidates = vulns.flatMap((v) => v.fixedVersions).filter((f) => {
    const a = parseVersion(f);
    const b = parseVersion(current);
    return a && b && compareVersions(a, b) > 0;
  });
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => compareVersions(parseVersion(a)!, parseVersion(b)!))[0];
}

const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

export function compareSeverity(a: Severity, b: Severity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

/**
 * Query osv.dev for advisories affecting `name@version` in this ecosystem.
 * Any failure (network, unsupported ecosystem, rate limit) yields an empty
 * result — this is best-effort enrichment, never a gate.
 */
export async function queryVulnerabilities(
  pm: string,
  name: string,
  version: string,
): Promise<Vulnerability[]> {
  const ecosystem = osvEcosystem(pm);
  if (!ecosystem || !version || !parseVersion(version)) return [];

  let res: Response;
  try {
    res = await fetchWithTimeout(
      "https://api.osv.dev/v1/query",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ package: { name, ecosystem }, version }),
      },
      15_000,
    );
  } catch {
    return [];
  }
  if (!res.ok) return [];

  let data: { vulns?: OsvVuln[] };
  try {
    data = (await res.json()) as { vulns?: OsvVuln[] };
  } catch {
    return [];
  }

  return (data.vulns ?? []).map((v) => ({
    id: v.id ?? "unknown",
    summary: v.summary ?? "",
    severity: extractSeverity(v),
    aliases: v.aliases ?? [],
    fixedVersions: extractFixedVersions(v),
    url: v.references?.find((r) => r.type === "ADVISORY")?.url ?? (v.id ? `https://osv.dev/vulnerability/${v.id}` : ""),
  }));
}

/** Sort a list of findings the way a human triages them: worst first. */
export function sortBySeverity(vulns: Vulnerability[]): Vulnerability[] {
  return [...vulns].sort((a, b) => compareSeverity(a.severity, b.severity));
}