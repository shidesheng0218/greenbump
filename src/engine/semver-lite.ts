/**
 * Minimal semver range checking, dependency-free.
 *
 * greenbump must not pull in a package just to answer "does 19.2.0 satisfy
 * ^19.0.0?" — the same question npm itself answers during install. This
 * covers the range forms that actually appear in `peerDependencies`:
 *
 *   exact       1.2.3
 *   caret       ^1.2.3   (>=1.2.3 <2.0.0; ^0.x is >=0.x.y <0.(x+1).0)
 *   tilde       ~1.2.3   (>=1.2.3 <1.3.0)
 *   comparators >=1.2.3  >1  <=2.0.0  <3
 *   space-AND   >=19 <20
 *   or          ^1 || ^2
 *   x-ranges    1.x  1.2.x  1.*  *
 *   hyphen      1.2.3 - 2.3.4
 *
 * Prerelease versions sort below their release and are only matched by a
 * range that itself mentions a prerelease of the same [major.minor.patch].
 * Build metadata (+sha) is ignored, as the spec requires.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(input: string): ParsedVersion | null {
  const m = input.trim().match(VERSION_RE);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? "",
  };
}

/** Total order over versions: -1, 0 or 1. A prerelease sorts before its release. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === "") return 1; // release > prerelease
  if (b.prerelease === "") return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

/** A partially specified version, where `undefined` means "any" (from x/*). */
interface Partial {
  major?: number;
  minor?: number;
  patch?: number;
  prerelease?: string;
}

function parsePartial(text: string): Partial | null {
  const t = text.trim().replace(/^v/, "");
  if (t === "" || t === "*" || t === "x" || t === "X") return {};
  const m = t.match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  const num = (s: string | undefined): number | undefined => {
    if (s === undefined || s === "x" || s === "X" || s === "*") return undefined;
    return Number(s);
  };
  const major = num(m[1]);
  const minor = major === undefined ? undefined : num(m[2]);
  const patch = minor === undefined ? undefined : num(m[3]);
  return { major, minor, patch, prerelease: m[4] };
}

function lowerBoundOf(p: Partial): ParsedVersion {
  return { major: p.major ?? 0, minor: p.minor ?? 0, patch: p.patch ?? 0, prerelease: p.prerelease ?? "" };
}

/** The exclusive upper bound implied by a caret range. */
function caretUpper(p: Partial): ParsedVersion {
  const major = p.major ?? 0;
  const minor = p.minor ?? 0;
  const patch = p.patch ?? 0;
  // ^0.2.3 → <0.3.0 ; ^0.0.3 → <0.0.4 ; ^1.2.3 → <2.0.0
  if (major > 0 || p.minor === undefined) return { major: major + 1, minor: 0, patch: 0, prerelease: "" };
  if (minor > 0 || p.patch === undefined) return { major: 0, minor: minor + 1, patch: 0, prerelease: "" };
  return { major: 0, minor: 0, patch: patch + 1, prerelease: "" };
}

/** The exclusive upper bound implied by a tilde range. */
function tildeUpper(p: Partial): ParsedVersion {
  const major = p.major ?? 0;
  const minor = p.minor ?? 0;
  if (p.minor === undefined) return { major: major + 1, minor: 0, patch: 0, prerelease: "" };
  return { major, minor: minor + 1, patch: 0, prerelease: "" };
}

interface Bound {
  version: ParsedVersion;
  inclusive: boolean;
}

interface ComparatorSet {
  lower?: Bound;
  upper?: Bound;
  /** an exact version, when the range pins one */
  exact?: ParsedVersion;
  /** prerelease tag mentioned by this comparator set, for prerelease matching */
  prereleaseBase?: ParsedVersion;
}

function bumpLower(side: ">" | ">=", p: Partial): Bound {
  return { version: lowerBoundOf(p), inclusive: side === ">=" };
}

/** Parse one space-separated comparator set (an AND group). */
function parseComparatorSet(text: string): ComparatorSet | null {
  const t = text.trim();
  if (t === "") return {};

  // hyphen range: "1.2.3 - 2.3.4"
  const hyphen = t.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphen) {
    const lo = parsePartial(hyphen[1]);
    const hi = parsePartial(hyphen[2]);
    if (!lo || !hi) return null;
    return { lower: { version: lowerBoundOf(lo), inclusive: true }, upper: { version: lowerBoundOf(hi), inclusive: true } };
  }

  const set: ComparatorSet = {};
  for (const token of t.split(/\s+/)) {
    const m = token.match(/^(\^|~|>=|<=|>|<|=)?\s*(.+)$/);
    if (!m) return null;
    const op = m[1] ?? "";
    const partial = parsePartial(m[2]);
    if (!partial) return null;
    if (partial.prerelease) set.prereleaseBase = lowerBoundOf(partial);

    switch (op) {
      case "^": {
        const lower = { version: lowerBoundOf(partial), inclusive: true };
        const upper = { version: caretUpper(partial), inclusive: false };
        set.lower = tighterLower(set.lower, lower);
        set.upper = tighterUpper(set.upper, upper);
        break;
      }
      case "~": {
        const lower = { version: lowerBoundOf(partial), inclusive: true };
        const upper = { version: tildeUpper(partial), inclusive: false };
        set.lower = tighterLower(set.lower, lower);
        set.upper = tighterUpper(set.upper, upper);
        break;
      }
      case ">":
      case ">=": {
        set.lower = tighterLower(set.lower, bumpLower(op, partial));
        break;
      }
      case "<":
      case "<=": {
        const upper = { version: lowerBoundOf(partial), inclusive: op === "<=" };
        set.upper = tighterUpper(set.upper, upper);
        break;
      }
      case "=": {
        set.exact = lowerBoundOf(partial);
        break;
      }
      default: {
        // No operator: an x-range acts as a lower bound and (if minor/patch
        // are pinned) an exact match.
        if (partial.major === undefined) break; // "*" — anything goes
        if (partial.minor === undefined) {
          set.lower = tighterLower(set.lower, { version: lowerBoundOf(partial), inclusive: true });
          set.upper = tighterUpper(set.upper, { version: { major: partial.major + 1, minor: 0, patch: 0, prerelease: "" }, inclusive: false });
        } else if (partial.patch === undefined) {
          set.lower = tighterLower(set.lower, { version: lowerBoundOf(partial), inclusive: true });
          set.upper = tighterUpper(set.upper, { version: { major: partial.major, minor: partial.minor + 1, patch: 0, prerelease: "" }, inclusive: false });
        } else {
          set.exact = lowerBoundOf(partial);
        }
      }
    }
  }
  return set;
}

function tighterLower(a: Bound | undefined, b: Bound): Bound {
  if (!a) return b;
  const c = compareVersions(a.version, b.version);
  if (c === 0) return a.inclusive && b.inclusive ? a : { version: a.version, inclusive: false };
  return c < 0 ? b : a;
}

function tighterUpper(a: Bound | undefined, b: Bound): Bound {
  if (!a) return b;
  const c = compareVersions(a.version, b.version);
  if (c === 0) return a.inclusive && b.inclusive ? a : { version: a.version, inclusive: false };
  return c > 0 ? b : a;
}

function inSet(v: ParsedVersion, set: ComparatorSet): boolean {
  if (set.exact && compareVersions(v, set.exact) !== 0) return false;
  if (set.lower) {
    const c = compareVersions(v, set.lower.version);
    if (c < 0 || (c === 0 && !set.lower.inclusive)) return false;
  }
  if (set.upper) {
    const c = compareVersions(v, set.upper.version);
    if (c > 0 || (c === 0 && !set.upper.inclusive)) return false;
  }
  return true;
}

/**
 * The smallest version that satisfies `range`, as "x.y.z", when it can be
 * determined. Used to suggest a co-upgrade target for a peer dependency
 * (e.g. `^19.2.0` → `19.2.0`) rather than guessing at "latest".
 */
export function lowerBoundOfRange(range: string): string | null {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "latest" || trimmed === "x") return null;
  const first = trimmed.split("||")[0].trim();
  const set = parseComparatorSet(first);
  if (!set) return null;
  if (set.exact) return format(set.exact);
  if (set.lower?.inclusive) return format(set.lower.version);
  return null;
}

function format(v: ParsedVersion): string {
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease ? `-${v.prerelease}` : ""}`;
}

/**
 * Does `version` satisfy `range`? Unknown/garbage ranges return `true`
 * (permissive) — refusing to upgrade because a range failed to parse would
 * be worse than letting the package manager decide.
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "latest" || trimmed === "x") return true;

  const orSets = trimmed.split("||").map(parseComparatorSet);
  if (orSets.some((s) => s === null)) return true; // unparseable → permissive

  for (const set of orSets as ComparatorSet[]) {
    if (!inSet(v, set)) continue;
    // Prerelease versions only match when the range itself names a
    // prerelease of the same major.minor.patch (mirrors node-semver).
    if (v.prerelease) {
      const base = set.prereleaseBase;
      if (!base || base.major !== v.major || base.minor !== v.minor || base.patch !== v.patch) continue;
    }
    return true;
  }
  return false;
}