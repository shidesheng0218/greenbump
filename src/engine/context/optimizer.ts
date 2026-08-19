import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * Context optimizer: shrink what we send to the LLM.
 *
 * Two strategies:
 * 1. Trim the failure output — keep error lines, drop passing-test noise,
 *    stack frames in node_modules, and repeated warnings.
 * 2. Identify candidate files — parse the error output for file paths so the
 *    fix agent gets pointed at the right files immediately instead of
 *    exploring (every exploration round costs input tokens).
 */

const NOISE_PATTERNS = [
  /^\s*at .*node_modules.*$/,           // stack frames inside dependencies
  /^\s*at .*internal\//,                 // node internal frames
  /npm warn/i,
  /deprecated.*\(https?:\/\//i,
  /^\s*✓/,                               // passing test lines
  /^\s*PASS /,
  /Test Suites:.*passed/i,
  /Tests:.*passed/i,
];

const MAX_FAILURE_CHARS = 4_000;
const MAX_FILE_LINE = 300;

/**
 * Compress failure output: keep the informative parts (errors, file refs,
 * first stack frame per error), drop the rest. Preserves the error's
 * "signature" — the part that determines what the fix should be.
 */
export function trimFailureOutput(output: string): string {
  const lines = output.split("\n");
  const kept: string[] = [];
  let seenErrors = 0;

  for (const line of lines) {
    if (NOISE_PATTERNS.some((p) => p.test(line))) continue;

    const isError = /error|fail|✗|✘|cannot|not a function|not defined|TypeError|ReferenceError|SyntaxError/i.test(line);
    if (isError) seenErrors++;

    // After the first couple of errors, stack-trace lines become noise
    const isStackFrame = /^\s*at\s/.test(line);
    if (isStackFrame && seenErrors > 2) continue;

    kept.push(line.length > MAX_FILE_LINE ? line.slice(0, MAX_FILE_LINE) + "…" : line);
    if (kept.join("\n").length > MAX_FAILURE_CHARS) break;
  }

  let result = kept.join("\n");
  if (output.length > result.length) {
    result += `\n… (trimmed ${output.length - result.length} chars of passing/noisy output)`;
  }
  return result;
}

/**
 * Extract file paths referenced by the failure output — these are the
 * files most likely to need edits. Returned as project-relative paths,
 * deduplicated, existing files only.
 */
export async function extractCandidateFiles(
  failureOutput: string,
  cwd: string,
): Promise<string[]> {
  const found = new Set<string>();

  // Match path:line:col references (TS/JS errors), stack frames, webpack errors
  const patterns = [
    /([^\s():]+\.(?:ts|tsx|js|jsx|mjs|cjs|vue|svelte)):\d+:\d+/g,
    /at\s+(?:\w+\s+)?\(([^():\s]+\.(?:ts|tsx|js|jsx|mjs|cjs)):\d+:\d+\)/g,
    /at\s+([^():\s]+\.(?:ts|tsx|js|jsx|mjs|cjs)):\d+:\d+/g,
    /ERROR in ([^\s]+\.(?:ts|tsx|js|jsx|vue|svelte))/g,
  ];

  for (const pattern of patterns) {
    let m;
    while ((m = pattern.exec(failureOutput)) !== null) {
      const p = normalizePath(m[1], cwd);
      if (p) found.add(p);
    }
  }

  // Verify the files actually exist in the project
  const existing: string[] = [];
  for (const f of found) {
    try {
      const s = await stat(join(cwd, f));
      if (s.isFile() && s.size < 200_000) existing.push(f);
    } catch {
      // not a real project file — skip
    }
  }
  return existing.slice(0, 20); // cap to avoid flooding the context
}

/**
 * Find test files related to candidate source files, so the agent can
 * see expectations without searching.
 */
export async function findRelatedTests(
  candidateFiles: string[],
  cwd: string,
): Promise<string[]> {
  const tests = new Set<string>();
  for (const f of candidateFiles) {
    // src/foo.ts → src/foo.test.ts, tests/foo.test.ts, __tests__/foo.test.ts
    const base = f.replace(/\.(ts|tsx|js|jsx|mjs|cjs|vue|svelte)$/, "");
    const candidates = [
      `${base}.test.ts`, `${base}.test.tsx`, `${base}.test.js`, `${base}.test.jsx`,
      `${base}.spec.ts`, `${base}.spec.tsx`, `${base}.spec.js`, `${base}.spec.jsx`,
    ];
    for (const c of candidates) {
      try {
        await stat(join(cwd, c));
        tests.add(c);
      } catch { /* doesn't exist */ }
    }
  }
  return [...tests].slice(0, 10);
}

/**
 * Read candidate files (truncated) to include as upfront context.
 * Returns a map of path → content.
 */
export async function readCandidateContents(
  files: string[],
  cwd: string,
  maxCharsPerFile = 8_000,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of files) {
    try {
      let content = await readFile(join(cwd, f), "utf8");
      if (content.length > maxCharsPerFile) {
        content = content.slice(0, maxCharsPerFile) + "\n… (file truncated)";
      }
      out.set(f, content);
    } catch {
      // unreadable — skip
    }
  }
  return out;
}

/** Estimate token count for a string (~4 chars/token for code+prose mix). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Build the "files likely involved" hint block for the fix prompt. */
export function buildCandidateHint(
  candidateFiles: string[],
  relatedTests: string[],
): string {
  if (candidateFiles.length === 0 && relatedTests.length === 0) return "";
  const parts: string[] = ["\n\nFiles referenced by the failure output (start here):"];
  for (const f of candidateFiles) parts.push(`- ${f}`);
  if (relatedTests.length > 0) {
    parts.push("\nRelated test files:");
    for (const t of relatedTests) parts.push(`- ${t}`);
  }
  return parts.join("\n");
}

function normalizePath(p: string, cwd: string): string | null {
  // Strip common prefixes to get a project-relative path
  let cleaned = p
    .replace(/^file:\/\//, "")
    .replace(/\\/g, "/");

  if (cleaned.startsWith(cwd)) {
    cleaned = relative(cwd, cleaned);
  }
  // Drop absolute paths that aren't under cwd
  if (cleaned.startsWith("/")) return null;
  // Drop anything escaping the project
  if (cleaned.startsWith("..")) return null;
  // Drop node_modules references — we don't fix dependency internals
  if (cleaned.includes("node_modules/")) return null;
  return cleaned;
}

/**
 * Scan the project root for the most likely source dirs, so the candidate
 * search can stay focused (cheap heuristic, avoids walking node_modules).
 */
export async function guessSourceDirs(cwd: string): Promise<string[]> {
  const candidates = ["src", "lib", "app", "packages", "source", "test", "tests", "__tests__"];
  const found: string[] = [];
  try {
    const entries = await readdir(cwd, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && candidates.includes(e.name)) found.push(e.name);
    }
  } catch {
    // unreadable root — return empty
  }
  return found.length > 0 ? found : ["."];
}
