import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCache } from "../cache/manager.js";

/**
 * Tiered fix strategies, ordered by cost:
 *
 * Level 1: REGEX  — built-in codemod patterns for well-known upgrades ($0)
 * Level 2: RULE   — learned patterns from cache, applied by template ($0)
 * Level 3: CACHED — full cached LLM fix for an identical failure ($0)
 * Level 4: LLM    — actual model call (paid, last resort)
 *
 * The first three tiers run before any LLM call. On a typical minor/patch
 * upgrade (renamed export, moved module), tier 1-2 resolves the fix with
 * zero tokens spent.
 */

export enum FixTier {
  REGEX = 1,
  RULE = 2,
  CACHED = 3,
  LLM = 4,
}

export interface TieredFixResult {
  applied: boolean;
  tier: FixTier;
  /** files that were modified */
  editedFiles: string[];
  /** human-readable description of what was done */
  description: string;
  /** tokens spent (0 for tiers 1-3) */
  tokensUsed: { inputTokens: number; outputTokens: number };
}

// ── Built-in codemod patterns (Level 1) ───────────────────────────────────

interface Codemod {
  /** which package this applies to (or "*" for any) */
  package: string;
  /** version range this applies to, e.g. { fromMajor: 18, toMajor: 19 } */
  versionRange?: { fromMajor?: number; toMajor?: number };
  /** regex tested against the failure output — if it matches, this codemod is a candidate */
  errorMatch: string;
  description: string;
  /** the actual source transformation */
  transform: {
    /** regex to find in source files */
    find: string;
    /** replacement (supports $1…$9 capture groups) */
    replace: string;
    /** only apply to files matching this glob-ish pattern (substring match) */
    fileFilter?: string;
  };
  /** import line adjustments to apply alongside the transform */
  imports?: { remove: string; add: string };
}

const BUILTIN_CODEMODS: Codemod[] = [
  // ── React 18 → 19 ──
  {
    package: "react-dom",
    versionRange: { fromMajor: 18, toMajor: 19 },
    errorMatch: "ReactDOM.render is not a function",
    description: "ReactDOM.render → createRoot (React 19)",
    transform: {
      find: "ReactDOM\\.render\\(\\s*([\\s\\S]*?),\\s*(document\\.[a-zA-Z]+\\([^)]*\\)[^)]*?)\\s*\\)",
      replace: "createRoot($2).render($1)",
    },
    imports: {
      remove: "import ReactDOM from 'react-dom'",
      add: "import { createRoot } from 'react-dom/client'",
    },
  },
  {
    package: "react-dom",
    versionRange: { fromMajor: 18, toMajor: 19 },
    errorMatch: "ReactDOM.render is not a function",
    description: "ReactDOM.render → createRoot (double-quoted imports)",
    transform: {
      find: "ReactDOM\\.render\\(\\s*([\\s\\S]*?),\\s*(document\\.[a-zA-Z]+\\([^)]*\\)[^)]*?)\\s*\\)",
      replace: "createRoot($2).render($1)",
    },
    imports: {
      remove: 'import ReactDOM from "react-dom"',
      add: 'import { createRoot } from "react-dom/client"',
    },
  },
  {
    package: "react-dom",
    versionRange: { fromMajor: 18, toMajor: 19 },
    errorMatch: "hydrate is not a function",
    description: "ReactDOM.hydrate → hydrateRoot (React 19)",
    transform: {
      find: "ReactDOM\\.hydrate\\(\\s*([\\s\\S]*?),\\s*(document\\.[a-zA-Z]+\\([^)]*\\)[^)]*?)\\s*\\)",
      replace: "hydrateRoot($2, $1)",
    },
    imports: {
      remove: "import ReactDOM from 'react-dom'",
      add: "import { hydrateRoot } from 'react-dom/client'",
    },
  },

  // ── Vue 2 → 3 ──
  {
    package: "vue",
    versionRange: { fromMajor: 2, toMajor: 3 },
    errorMatch: "Vue is not a constructor",
    description: "new Vue() → createApp() (Vue 3)",
    transform: {
      find: "new Vue\\(([^)]*)\\)",
      replace: "createApp($1)",
    },
    imports: {
      remove: "import Vue from 'vue'",
      add: "import { createApp } from 'vue'",
    },
  },

  // ── Node.js assert style ──
  {
    package: "*",
    errorMatch: "assert.equal is deprecated",
    description: "assert.equal → assert.strictEqual",
    transform: {
      find: "assert\\.equal\\(",
      replace: "assert.strictEqual(",
      fileFilter: "test",
    },
  },

  // ── Jest → Vitest common patterns ──
  {
    package: "vitest",
    errorMatch: "jest is not defined",
    description: "jest.fn() → vi.fn() (Vitest)",
    transform: {
      find: "\\bjest\\.",
      replace: "vi.",
    },
    imports: {
      remove: "",
      add: "import { vi } from 'vitest'",
    },
  },
];

// ── Public API ─────────────────────────────────────────────────────────────

export interface PatternFixContext {
  cwd: string;
  packageName: string;
  fromVersion: string;
  toVersion: string;
  failureOutput: string;
  /** source files the fix may touch — discovered by scanning error output */
  candidateFiles: string[];
}

/**
 * Level 1: try built-in codemods. Returns applied=true if any codemod
 * matched the error AND modified at least one file.
 */
export async function tryBuiltinCodemods(ctx: PatternFixContext): Promise<TieredFixResult> {
  const fromMajor = parseMajor(ctx.fromVersion);
  const toMajor = parseMajor(ctx.toVersion);

  const candidates = BUILTIN_CODEMODS.filter((c) => {
    if (c.package !== "*" && c.package !== ctx.packageName) return false;
    if (!new RegExp(c.errorMatch, "i").test(ctx.failureOutput)) return false;
    if (c.versionRange) {
      if (c.versionRange.fromMajor !== undefined && fromMajor !== c.versionRange.fromMajor) return false;
      if (c.versionRange.toMajor !== undefined && toMajor !== c.versionRange.toMajor) return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    return noFix(FixTier.REGEX);
  }

  const editedFiles: string[] = [];
  const descriptions: string[] = [];

  for (const codemod of candidates) {
    for (const file of ctx.candidateFiles) {
      if (codemod.transform.fileFilter && !file.includes(codemod.transform.fileFilter)) continue;

      const abs = join(ctx.cwd, file);
      let content: string;
      try {
        content = await readFile(abs, "utf8");
      } catch {
        continue;
      }

      let updated = content;
      try {
        updated = updated.replace(new RegExp(codemod.transform.find, "g"), codemod.transform.replace);
      } catch {
        continue;
      }

      if (codemod.imports) {
        const { remove, add } = codemod.imports;
        if (remove && updated.includes(remove)) {
          updated = updated.replace(remove, add);
        } else if (add && !updated.includes(add) && updated !== content) {
          // Transform applied but import line wasn't there in expected form —
          // prepend the new import at the top.
          updated = add + "\n" + updated;
        }
      }

      if (updated !== content) {
        await writeFile(abs, updated, "utf8");
        editedFiles.push(file);
      }
    }
    if (editedFiles.length > 0) descriptions.push(codemod.description);
  }

  return {
    applied: editedFiles.length > 0,
    tier: FixTier.REGEX,
    editedFiles,
    description: descriptions.join("; ") || "no codemod matched",
    tokensUsed: { inputTokens: 0, outputTokens: 0 },
  };
}

/**
 * Level 2: try learned patterns from the local cache (patterns that worked
 * in previous runs of greenbump, either here or on other projects).
 */
export async function tryLearnedPatterns(ctx: PatternFixContext): Promise<TieredFixResult> {
  const cache = getCache();
  await cache.init();

  // Try each error line as a signature — the cache is keyed by
  // (package, hash(error signature)) so we probe with the first few
  // distinctive lines of the failure.
  const signatures = extractErrorSignatures(ctx.failureOutput);

  for (const sig of signatures) {
    const pattern = await cache.getFixPattern(ctx.packageName, sig);
    if (!pattern) continue;

    const editedFiles: string[] = [];
    let allApplied = true;

    for (const [file, edit] of Object.entries(pattern.edits)) {
      const abs = join(ctx.cwd, file);
      let content: string;
      try {
        content = await readFile(abs, "utf8");
      } catch {
        allApplied = false;
        continue;
      }

      let updated: string;
      if (typeof edit === "string") {
        updated = edit; // whole-file replacement
      } else {
        try {
          updated = content.replace(new RegExp(edit.find, "g"), edit.replace);
        } catch {
          allApplied = false;
          continue;
        }
      }

      const importFix = pattern.importFixes?.[file];
      if (importFix?.remove && updated.includes(importFix.remove)) {
        updated = updated.replace(importFix.remove, importFix.add ?? "");
      }

      if (updated !== content) {
        await writeFile(abs, updated, "utf8");
        editedFiles.push(file);
      }
    }

    if (editedFiles.length > 0 && allApplied) {
      pattern.hits++;
      await cache.setFixPattern(ctx.packageName, sig, pattern);
      return {
        applied: true,
        tier: FixTier.RULE,
        editedFiles,
        description: `learned pattern: ${pattern.description}`,
        tokensUsed: { inputTokens: 0, outputTokens: 0 },
      };
    }

    if (editedFiles.length === 0) {
      pattern.misses++;
      await cache.setFixPattern(ctx.packageName, sig, pattern);
    }
  }

  return noFix(FixTier.RULE);
}

/**
 * Level 3: try a fully cached LLM fix for an identical failure context.
 * The context key covers (package, versions, failure output hash) so this
 * only hits when the exact same failure has been fixed before.
 */
export async function tryCachedLlmFix(
  ctx: PatternFixContext,
  contextKey: string,
): Promise<TieredFixResult> {
  const cache = getCache();
  await cache.init();

  const cached = await cache.getLlmFix(contextKey);
  if (!cached) return noFix(FixTier.CACHED);

  const editedFiles: string[] = [];
  for (const [file, content] of Object.entries(cached.edits)) {
    const abs = join(ctx.cwd, file);
    try {
      await writeFile(abs, content, "utf8");
      editedFiles.push(file);
    } catch {
      // file path doesn't exist in this project — the cached fix doesn't
      // apply cleanly, bail rather than write partial state
      return noFix(FixTier.CACHED);
    }
  }

  cached.hits++;
  await cache.setLlmFix(contextKey, cached);

  return {
    applied: true,
    tier: FixTier.CACHED,
    editedFiles,
    description: `cached fix (used ${cached.hits}x before, from ${cached.model})`,
    tokensUsed: { inputTokens: 0, outputTokens: 0 },
  };
}

/**
 * Record a successful LLM fix as a learned pattern + full cached fix,
 * so future identical failures cost $0.
 */
export async function learnFromSuccessfulFix(
  ctx: PatternFixContext,
  contextKey: string,
  editedFiles: string[],
  model: string,
): Promise<void> {
  const cache = getCache();
  await cache.init();

  // Store the full fix (file contents after edit)
  const edits: Record<string, string> = {};
  for (const file of editedFiles) {
    try {
      edits[file] = await readFile(join(ctx.cwd, file), "utf8");
    } catch {
      // skip unreadable files
    }
  }
  if (Object.keys(edits).length > 0) {
    const existing = await cache.getLlmFix(contextKey);
    await cache.setLlmFix(contextKey, {
      edits,
      hits: (existing?.hits ?? 0),
      model,
    });
  }
}

/** Build the cache context key for a failure — stable across projects. */
export function buildContextKey(
  packageName: string,
  from: string,
  to: string,
  failureOutput: string,
): string {
  // Normalize the failure output: strip paths, line numbers, timings —
  // keep only the error essence so identical errors across projects collide.
  const normalized = failureOutput
    .replace(/[^\s]*node_modules[^\s]*/g, "<pkg>")
    .replace(/[A-Za-z]:?[\\/][^\s:;)]+/g, "<path>")
    .replace(/:\d+:\d+/g, "")
    .replace(/\d+ms/g, "<time>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
  return `${packageName}@${from}->${to}::${normalized}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseMajor(version: string): number {
  const m = version.replace(/^[~^>=\s]*/, "").match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

/** Extract distinctive error lines to use as cache probe signatures. */
function extractErrorSignatures(failureOutput: string): string[] {
  const lines = failureOutput.split("\n");
  const sigs: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    // Keep lines that look like actual error messages
    if (/error|failed|is not a function|is not defined|cannot find|deprecated/i.test(t)
        && t.length > 15 && t.length < 300) {
      sigs.push(t);
      if (sigs.length >= 5) break;
    }
  }
  return sigs;
}

function noFix(tier: FixTier): TieredFixResult {
  return {
    applied: false,
    tier,
    editedFiles: [],
    description: "no applicable pattern",
    tokensUsed: { inputTokens: 0, outputTokens: 0 },
  };
}

/** List built-in codemods (for --list-codemods CLI / docs). */
export function listBuiltinCodemods(): string {
  return BUILTIN_CODEMODS
    .map((c) => `  ${c.package}${c.versionRange ? ` (${c.versionRange.fromMajor}→${c.versionRange.toMajor})` : ""}: ${c.description}`)
    .join("\n");
}
