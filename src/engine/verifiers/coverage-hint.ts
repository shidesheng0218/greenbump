import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, basename, extname } from "node:path";

/**
 * "Is this green actually meaningful?"
 *
 * greenbump's honest boundary is your test suite: if the code it edited is not
 * referenced by any test, then build+test going green proves the project still
 * compiles — nothing more. That is worth saying out loud rather than implying
 * a fix was verified.
 *
 * This is a REFERENCE heuristic, not coverage measurement: it looks for files
 * that import/require the edited module. Deliberately conservative — an
 * unreadable test file or an unusual import style yields "covered", because a
 * false alarm here would train people to ignore the warning.
 */

const TEST_FILE_RE = /(^|[/\\])(__tests__|tests?|spec)([/\\])|\.(test|spec)\.[^/\\]+$/i;
const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo"]);
const MAX_BYTES = 500_000;

async function collectTestFiles(cwd: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      const rel = relative(cwd, abs);
      if (TEST_FILE_RE.test(rel)) out.push(abs);
    }
  }
  await walk(cwd);
  return out;
}

/**
 * Edited (non-test) files that no test file appears to reference.
 * Empty when every edit is reachable from a test, or when no tests exist at
 * all — "no tests" is already reported separately as `unverifiable`.
 */
export async function findUnreferencedEdits(cwd: string, editedFiles: string[]): Promise<string[]> {
  const candidates = editedFiles.filter(
    (f) => !TEST_FILE_RE.test(f) && [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte"].includes(extname(f)),
  );
  if (candidates.length === 0) return [];

  const testFiles = await collectTestFiles(cwd);
  if (testFiles.length === 0) return [];

  // Read each test file once and look for references to any candidate.
  const unresolved = new Set(candidates);
  for (const testAbs of testFiles) {
    if (unresolved.size === 0) break;
    let content: string;
    try {
      const s = await stat(testAbs);
      if (s.size > MAX_BYTES) continue;
      content = await readFile(testAbs, "utf8");
    } catch {
      // Unreadable test file — can't prove the edit is unreferenced, so stay quiet.
      return [];
    }
    for (const rel of [...unresolved]) {
      const stem = basename(rel, extname(rel));
      // Match `./foo`, `../lib/foo`, `@/foo`, `~/foo` in any quote style, with
      // or without extension. Stem matching is intentionally loose.
      const pattern = new RegExp(`['"\`][^'"\`]*[/\\\\]?${escapeRe(stem)}(\\.[a-z]+)?['"\`]`, "i");
      if (pattern.test(content)) unresolved.delete(rel);
    }
  }

  return [...unresolved];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}