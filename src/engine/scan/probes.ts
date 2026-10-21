import type { BreakingChange } from "../analyzers/changelog-parser.js";
import { type Codemod, builtinCodemods, codemodMatchesRange, parseMajor } from "../fixer/patterns.js";

/**
 * Prefix marking a probe whose matches are only valid inside files that
 * import a given package. Carried in `Probe.fileFilter` so the indexer can
 * resolve it per file without a second pass.
 */
export const REQUIRES_IMPORT_PREFIX = "__requiresImport:";

/**
 * A search probe: a pattern to find in source files, plus metadata about
 * which breaking change / codemod it came from.
 */
export interface Probe {
  /** normalized pattern key for deduplication */
  key: string;
  /** the actual regex pattern to search for */
  pattern: string;
  /** optional substring filter for file paths (e.g. "test") */
  fileFilter?: string;
  /** true when this probe is approximate (e.g. extracted from prose) */
  approx?: boolean;
  /** which detection/change this probe belongs to (for grouping results) */
  refs: Array<{ depName: string; changeIndex: number }>;
}

/**
 * Generate search probes from a breaking change.
 *
 * Strategy:
 * 1. Primary probe = oldApi.split("(")[0].trim(), if length >= 4
 * 2. If primary is a bare identifier (no `.`, `(`, quotes), mark for import-scoped search
 * 3. If primary too short, extract longest `.identifier` member and mark approx
 */
export function probesFromChange(
  change: BreakingChange,
  depName: string,
  changeIndex: number,
): Probe[] {
  const probes: Probe[] = [];
  const oldApi = change.oldApi;

  // Primary probe: everything before the first `(`
  const primary = oldApi.split("(")[0].trim();
  if (primary.length >= 4) {
    // Check if it's a bare identifier (no dots, parens, quotes, spaces)
    const isBareIdentifier = /^[a-zA-Z_$][\w$]*$/.test(primary);
    probes.push({
      key: `${depName}:${changeIndex}:primary`,
      pattern: escapeRegExpLiteral(primary),
      approx: false,
      refs: [{ depName, changeIndex }],
      // Bare identifiers like `describe` are too noisy — only search in files
      // that import the package (resolved per file by the indexer).
      ...(isBareIdentifier ? { fileFilter: `${REQUIRES_IMPORT_PREFIX}${depName}` } : {}),
    });
    return probes;
  }

  // Fallback: extract the longest `.identifier` member
  const members = oldApi.match(/\.[a-zA-Z_$][\w$]*/g) || [];
  if (members.length > 0) {
    const longest = members.reduce((a, b) => (a.length > b.length ? a : b));
    probes.push({
      key: `${depName}:${changeIndex}:member`,
      pattern: escapeRegExpLiteral(longest),
      approx: true,
      refs: [{ depName, changeIndex }],
    });
  }

  return probes;
}

/** Generate probes from a codemod (uses its transform.find pattern). */
export function probesFromCodemod(
  codemod: Codemod,
  depName: string,
  changeIndex: number,
): Probe[] {
  if (!codemod.transform) return [];
  return [
    {
      key: `${depName}:${changeIndex}:codemod`,
      pattern: codemod.transform.find,
      fileFilter: codemod.transform.fileFilter,
      approx: false,
      refs: [{ depName, changeIndex }],
    },
  ];
}

/**
 * Packages whose upgrades can plausibly break the generic Node-runtime
 * codemods (`package: "*"` in the registry, e.g. `util.isArray` removal).
 * Those codemods are error-gated in the fix loop — they only fire when the
 * failure output matches — but `--scan` has no error output, so without this
 * gate they would be attributed to *every* outdated dependency (a zod bump
 * reported as breaking `assert.equal`, which is simply wrong).
 */
const NODE_RUNTIME_PACKAGES = new Set(["node", "nodejs", "@types/node"]);

/** Find codemods that apply to a given package upgrade path. */
export function codemodsForUpgrade(
  packageName: string,
  fromVersion: string,
  toVersion: string,
): Codemod[] {
  const fromMajor = parseMajor(fromVersion);
  const toMajor = parseMajor(toVersion);

  const matched = builtinCodemods().filter((c) => {
    if (c.package === "*") {
      // Generic runtime codemods only apply to Node-runtime upgrades.
      if (!NODE_RUNTIME_PACKAGES.has(packageName)) return false;
    } else if (c.package !== packageName) {
      return false;
    }
    // Shared with the fix loop so the two can't drift.
    return codemodMatchesRange(c.versionRange, fromMajor, toMajor);
  });

  // The registry carries separate variants per import-quote style (e.g.
  // React's single- and double-quoted `import ReactDOM from …`). Both must
  // exist for the fix loop — it picks whichever matches — but for reporting
  // they describe the SAME breaking change, so counting both would double
  // every location. Dedupe by search pattern here, in the scan path only.
  const seen = new Set<string>();
  return matched.filter((c) => {
    const key = c.transform?.find ?? `guidance:${c.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Escape a string for use as a literal in a RegExp. */
export function escapeRegExpLiteral(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
