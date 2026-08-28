import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
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
  /**
   * Advisory messages from guidance-only codemods that matched the failure
   * but didn't rewrite any code (e.g. ESLint 9 flat-config migration notes).
   * Surfaced to the user/log; does NOT mark the tier as applied.
   */
  advice?: string[];
}

// ── Built-in codemod patterns (Level 1) ───────────────────────────────────

interface Codemod {
  /** which package this applies to (or "*" for any) */
  package: string;
  /**
   * Version range this applies to. `fromMajor`/`toMajor` are the *dep's*
   * pre/post-upgrade major versions. `toMajor` may be omitted to mean
   * "exactly fromMajor+1" (single-major bump), or set higher for codemods
   * that apply across several majors.
   */
  versionRange?: { fromMajor?: number; toMajor?: number };
  /** regex tested against the failure output — if it matches, this codemod is a candidate */
  errorMatch: string;
  description: string;
  /**
   * The actual source transformation. Optional for "guidance-only" codemods
   * that match a known breakage and print advice but don't rewrite code
   * (used when a safe regex fix isn't possible, e.g. config-format changes).
   */
  transform?: {
    /** regex to find in source files */
    find: string;
    /** replacement (supports $1…$9 capture groups) */
    replace: string;
    /** only apply to files matching this glob-ish pattern (substring match) */
    fileFilter?: string;
  };
  /** import line adjustments to apply alongside the transform */
  imports?: { remove: string; add: string };
  /**
   * Files to create after a successful transform (e.g. ESLint 9 flat
   * config). Each entry is skipped if the file already exists unless
   * skipIfExists is explicitly false. Paths are relative to the project root.
   */
  creates?: Array<{ path: string; content: string; skipIfExists?: boolean }>;
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

  // ── Express 4 → 5 ──
  {
    package: "express",
    versionRange: { fromMajor: 4, toMajor: 5 },
    errorMatch: "app\\.del is not a function",
    description: "app.del() → app.delete() (Express 5 removed app.del)",
    transform: {
      find: "\\bapp\\.del\\(",
      replace: "app.delete(",
    },
  },
  {
    package: "express",
    versionRange: { fromMajor: 4, toMajor: 5 },
    errorMatch: "res\\.send\\(status\\)|res\\.send\\(\\d{3}\\)",
    description: "res.send(status) → res.sendStatus(status) (Express 5)",
    transform: {
      find: "\\bres\\.send\\((\\d{3})\\)",
      replace: "res.sendStatus($1)",
    },
  },

  // ── Zod 3 → 4 ──
  {
    package: "zod",
    versionRange: { fromMajor: 3, toMajor: 4 },
    errorMatch: "\\berrors\\b.*(not a function|undefined)|error\\.errors",
    description: "error.errors → error.issues (Zod 4)",
    transform: {
      find: "\\.error\\.errors\\b",
      replace: ".error.issues",
    },
  },
  {
    package: "zod",
    versionRange: { fromMajor: 3, toMajor: 4 },
    errorMatch: "z\\.string\\(\\)\\.email|z\\.string\\(\\)\\.url|z\\.string\\(\\)\\.uuid|deprecated.*z\\.string",
    description: "z.string().email()/.url()/.uuid() → z.email()/z.url()/z.uuid() (Zod 4)",
    transform: {
      find: "z\\.string\\(\\)\\.(email|url|uuid)\\(\\)",
      replace: "z.$1()",
    },
  },

  // ── Node util.is* removal (Node 22) ──
  {
    package: "*",
    errorMatch: "util\\.is(Array|Buffer|Date|RegExp|Error|Function|String|Number|Boolean|Object) is not a function",
    description: "util.is*() → native equivalents (removed in Node 22)",
    transform: {
      find: "util\\.isArray\\(",
      replace: "Array.isArray(",
    },
  },
  {
    package: "*",
    errorMatch: "util\\.isBuffer is not a function",
    description: "util.isBuffer() → Buffer.isBuffer() (removed in Node 22)",
    transform: {
      find: "util\\.isBuffer\\(",
      replace: "Buffer.isBuffer(",
    },
  },

  // ── assert.deepEqual → deepStrictEqual ──
  {
    package: "*",
    errorMatch: "assert\\.deepEqual is deprecated",
    description: "assert.deepEqual → assert.deepStrictEqual",
    transform: {
      find: "assert\\.deepEqual\\(",
      replace: "assert.deepStrictEqual(",
      fileFilter: "test",
    },
  },

  // ── Lodash 4 removed/renamed methods ──
  {
    package: "lodash",
    errorMatch: "_\\.pluck is not a function",
    description: "_.pluck(collection, key) → _.map(collection, key) (Lodash 4 removed pluck)",
    transform: {
      find: "_\\.pluck\\(",
      replace: "_.map(",
    },
  },
  {
    package: "lodash",
    errorMatch: "_\\.contains is not a function",
    description: "_.contains → _.includes (Lodash 4 renamed contains)",
    transform: {
      find: "_\\.contains\\(",
      replace: "_.includes(",
    },
  },

  // ── React Router 5 → 6 ──
  {
    package: "react-router-dom",
    versionRange: { fromMajor: 5, toMajor: 6 },
    errorMatch: "Switch.*(is not exported|not a function)|<Switch>",
    description: "<Switch> → <Routes> (React Router 6)",
    transform: {
      find: "<Switch>",
      replace: "<Routes>",
    },
  },
  {
    package: "react-router-dom",
    versionRange: { fromMajor: 5, toMajor: 6 },
    errorMatch: "useHistory.*(is not exported|not a function)",
    description: "useHistory() → useNavigate() (React Router 6)",
    transform: {
      find: "\\buseHistory\\(\\)",
      replace: "useNavigate()",
    },
    imports: {
      remove: "useHistory",
      add: "useNavigate",
    },
  },

  // ── Mongoose 6 → 7+ (doc.remove removed) ──
  {
    package: "mongoose",
    versionRange: { fromMajor: 6, toMajor: 8 },
    errorMatch: "\\.remove is not a function|remove\\(\\).*deprecated",
    description: "doc.remove() → doc.deleteOne() (Mongoose 7+)",
    transform: {
      find: "\\.remove\\(\\)",
      replace: ".deleteOne()",
    },
  },

  // ── Guidance-only codemods (match + advise, no transform) ──
  {
    package: "eslint",
    versionRange: { fromMajor: 8, toMajor: 9 },
    errorMatch: "eslintrc|ESLint configuration.*(invalid|not found)|Could not find config",
    description:
      "ESLint 9 uses flat config (eslint.config.js) instead of .eslintrc. " +
      "A starter eslint.config.js was created — migrate your rules into it. " +
      "See https://eslint.org/docs/latest/use/configure/migration-guide",
    creates: [
      {
        path: "eslint.config.js",
        content:
          "// ESLint 9 flat config — generated by greenbump\n" +
          "// Migrate rules from your old .eslintrc.* into the array below.\n" +
          "// Guide: https://eslint.org/docs/latest/use/configure/migration-guide\n" +
          "export default [\n" +
          "  {\n" +
          "    ignores: [\"dist/**\", \"node_modules/**\"],\n" +
          "  },\n" +
          "];\n",
        skipIfExists: true,
      },
    ],
  },
  {
    package: "axios",
    versionRange: { fromMajor: 0, toMajor: 1 },
    errorMatch: "axios.*(is not a function|undefined)|baseURL",
    description:
      "Axios 1.x changed default export interop and error shapes. " +
      "Check import style (default vs named) and error.response handling. " +
      "See https://github.com/axios/axios/releases/tag/v1.0.0",
  },
  {
    package: "webpack",
    versionRange: { fromMajor: 4, toMajor: 5 },
    errorMatch: "configuration\\.node|node\\.polyfill|BREAKING CHANGE.*polyfill",
    description:
      "Webpack 5 removed automatic Node.js polyfills. Add resolve.fallback " +
      "entries or the node-polyfill-webpack-plugin if you rely on node builtins. " +
      "See https://webpack.js.org/migrate/5/",
  },
  {
    package: "jest",
    versionRange: { fromMajor: 28, toMajor: 30 },
    errorMatch: "testEnvironment.*jsdom.*not found|Cannot find module.*jsdom",
    description:
      "Jest 29+ moved jsdom into a separate package. Run: npm i -D jest-environment-jsdom, " +
      "then keep testEnvironment: \"jsdom\".",
  },
  {
    package: "typescript",
    versionRange: { fromMajor: 4, toMajor: 5 },
    errorMatch: "TS1208|isolatedModules",
    description:
      "TypeScript 5 tightened module interop under isolatedModules. Enable " +
      "\"verbatimModuleSyntax\": true in tsconfig and use `import type` for type-only imports. " +
      "See https://www.typescriptlang.org/tsconfig#verbatimModuleSyntax",
  },
  {
    package: "prettier",
    versionRange: { fromMajor: 2, toMajor: 3 },
    errorMatch: "trailingComma.*invalid|arrowParens",
    description:
      "Prettier 3 changed defaults (trailingComma: \"all\", arrowParens: \"always\"). " +
      "Pin your preferred values in .prettierrc to keep formatting stable. " +
      "See https://prettier.io/blog/2023/07/05/3.0.0.html",
  },
  {
    package: "socket.io",
    versionRange: { fromMajor: 3, toMajor: 4 },
    errorMatch: "io\\.to.*emit.*not a function|namespace.*not found",
    description:
      "Socket.IO 4 changed namespace/broadcast API and default CORS handling. " +
      "Review server options (cors, allowRequest) and client connection URLs. " +
      "See https://socket.io/docs/v4/migrating-from-3-x-to-4-0/",
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
      const { fromMajor: rf, toMajor: rt } = c.versionRange;
      if (rf !== undefined && fromMajor !== rf) return false;
      // toMajor omitted → codemod targets exactly the next major (rf+1).
      // toMajor set → codemod applies to any bump landing at or below it.
      if (rt !== undefined && toMajor > rt) return false;
    }
    return true;
  });

  if (candidates.length === 0) {
    return noFix(FixTier.REGEX);
  }

  const editedFiles: string[] = [];
  const descriptions: string[] = [];
  const advice: string[] = [];

  for (const codemod of candidates) {
    let touched = false;

    if (codemod.transform) {
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
          touched = true;
        }
      }
    }

    // Create any companion files (flat configs, etc.). Runs even for
    // guidance-only codemods (no transform) so a matched breakage can still
    // scaffold the new file the upgrade expects.
    if (codemod.creates) {
      for (const create of codemod.creates) {
        const abs = join(ctx.cwd, create.path);
        if (create.skipIfExists !== false) {
          try {
            await readFile(abs, "utf8");
            continue; // already exists — don't clobber user config
          } catch {
            // doesn't exist — proceed to create
          }
        }
        try {
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, create.content, "utf8");
          editedFiles.push(create.path);
          touched = true;
        } catch {
          // unwritable — skip
        }
      }
    }

    if (touched) {
      descriptions.push(codemod.description);
    } else if (!codemod.transform && !codemod.creates) {
      // Pure guidance codemod (no transform, no creates): matched a known
      // breakage but there's nothing safe to rewrite. Surface the advice —
      // but it must NOT mark the tier as applied, or the run would treat
      // "printed advice" as "fixed" and skip straight to a green check.
      advice.push(codemod.description);
    }
  }

  const applied = editedFiles.length > 0;
  return {
    applied,
    tier: FixTier.REGEX,
    editedFiles,
    description: descriptions.join("; ") || "no codemod matched",
    tokensUsed: { inputTokens: 0, outputTokens: 0 },
    ...(advice.length > 0 ? { advice } : {}),
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
