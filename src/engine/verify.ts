import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathExists } from "./ecosystems/types.js";

const execAsync = promisify(exec);

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
    try {
      const { stdout, stderr } = await execAsync("npx tsc --noEmit", {
        cwd,
        timeout: 60000, // 1 minute timeout
      });
      results.push({
        passed: true,
        stage: "types",
        output: stdout + stderr,
      });
    } catch (err: any) {
      const output = err.stdout + err.stderr;
      results.push({
        passed: false,
        stage: "types",
        output,
        warnings: parseTypeErrors(output),
      });
    }
  }

  // 2. ESLint check
  if (checkLint && (await hasEslintConfig(cwd))) {
    try {
      const { stdout, stderr } = await execAsync(
        "npx eslint . --ext .ts,.tsx,.js,.jsx --format compact",
        {
          cwd,
          timeout: 60000,
        }
      );
      results.push({
        passed: true,
        stage: "lint",
        output: stdout + stderr,
      });
    } catch (err: any) {
      const output = err.stdout + err.stderr;
      results.push({
        passed: strictLint ? false : true, // Lint warnings don't fail by default
        stage: "lint",
        output,
        warnings: parseLintWarnings(output),
      });
    }
  }

  return results;
}

async function hasTsConfig(cwd: string): Promise<boolean> {
  return await pathExists(join(cwd, "tsconfig.json"));
}

async function hasEslintConfig(cwd: string): Promise<boolean> {
  const configs = [
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ];
  for (const cfg of configs) {
    if (await pathExists(join(cwd, cfg))) return true;
  }
  // Check package.json for eslintConfig field
  try {
    const pkgPath = join(cwd, "package.json");
    if (await pathExists(pkgPath)) {
      const pkg = JSON.parse(
        await import("node:fs/promises").then((fs) =>
          fs.readFile(pkgPath, "utf8")
        )
      );
      if (pkg.eslintConfig) return true;
    }
  } catch {
    // Ignore
  }
  return false;
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
