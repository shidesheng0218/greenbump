import { exec } from "./exec.js";
import { join } from "node:path";
import { pathExists } from "./ecosystems/types.js";

export interface VerificationResult {
  passed: boolean;
  stage: "types" | "lint" | "format";
  output: string;
  warnings?: string[];
}

export interface StaticAnalysisOptions {
  /** Run TypeScript type checking (tsc --noEmit) */
  checkTypes?: boolean;
  /** Run ESLint checks */
  checkLint?: boolean;
  /** Treat lint errors as fatal (default: false, only warns) */
  strictLint?: boolean;
}

/** Milliseconds; type/lint checks on a large project must not hang the run forever. */
const CHECK_TIMEOUT_MS = 120_000;

/**
 * Run static analysis checks (TypeScript, ESLint) on the codebase.
 * This catches issues that runtime tests might miss:
 * - Type errors in TypeScript projects
 * - Lint violations (code style, best practices)
 */
export async function runStaticAnalysis(
  cwd: string,
  options: StaticAnalysisOptions = {}
): Promise<VerificationResult[]> {
  const {
    checkTypes = true,
    checkLint = true,
    strictLint = false,
  } = options;

  const results: VerificationResult[] = [];

  // 1. TypeScript type check
  if (checkTypes && (await hasTsConfig(cwd))) {
    const r = await exec("npx", ["tsc", "--noEmit"], { cwd, timeout: CHECK_TIMEOUT_MS });
    results.push({
      passed: r.code === 0,
      stage: "types",
      output: r.combined,
      ...(r.code !== 0 ? { warnings: parseTypeErrors(r.combined) } : {}),
    });
  }

  // 2. ESLint check
  const eslint = await detectEslintConfig(cwd);
  if (checkLint && eslint) {
    // ESLint 9 flat config rejects --ext (it lints configured files); only
    // legacy eslintrc setups need the explicit extension list.
    const args = eslint.kind === "flat"
      ? ["eslint", ".", "--format", "compact"]
      : ["eslint", ".", "--ext", ".ts,.tsx,.js,.jsx", "--format", "compact"];
    const r = await exec("npx", args, { cwd, timeout: CHECK_TIMEOUT_MS });
    const failed = r.code !== 0;
    results.push({
      passed: strictLint ? !failed : true, // Lint errors don't fail by default…
      stage: "lint",
      output: r.combined,
      // …but the warnings must still reach the summary — previously they were
      // computed and then silently dropped by the caller.
      ...(failed ? { warnings: parseLintWarnings(r.combined) } : {}),
    });
  }

  return results;
}

async function hasTsConfig(cwd: string): Promise<boolean> {
  return await pathExists(join(cwd, "tsconfig.json"));
}

interface EslintConfig {
  kind: "flat" | "legacy";
}

export async function detectEslintConfig(cwd: string): Promise<EslintConfig | null> {
  // ESLint 9+ flat config
  for (const cfg of ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts"]) {
    if (await pathExists(join(cwd, cfg))) return { kind: "flat" };
  }
  // Legacy eslintrc (including the extension-less variant)
  for (const cfg of [".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml", ".eslintrc.yaml"]) {
    if (await pathExists(join(cwd, cfg))) return { kind: "legacy" };
  }
  // package.json eslintConfig field is legacy-style config
  try {
    const pkgPath = join(cwd, "package.json");
    if (await pathExists(pkgPath)) {
      const { readFile } = await import("node:fs/promises");
      const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
      if (pkg.eslintConfig) return { kind: "legacy" };
    }
  } catch {
    // Ignore
  }
  return null;
}

function parseTypeErrors(output: string): string[] {
  // TypeScript error format: "file.ts(line,col): error TS1234: message"
  const lines = output.split("\n");
  const errors: string[] = [];

  for (const line of lines) {
    if (/error TS\d+:/.test(line)) {
      // Extract just the file and error message
      const match = line.match(/^(.+?\.\w+)\(\d+,\d+\): (.+)$/);
      if (match) {
        errors.push(`${match[1]}: ${match[2]}`);
      } else {
        errors.push(line.trim());
      }
    }
  }

  return errors.slice(0, 10); // Limit to first 10 errors
}

function parseLintWarnings(output: string): string[] {
  // ESLint compact format: "file.js: line 10, col 5, Error - message (rule-name)"
  const lines = output.split("\n");
  const warnings: string[] = [];

  for (const line of lines) {
    if (line.includes("Error") || line.includes("Warning")) {
      warnings.push(line.trim());
    }
  }

  return warnings.slice(0, 10); // Limit to first 10 warnings
}
