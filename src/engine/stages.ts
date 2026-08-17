import { join } from "node:path";
import { pathExists } from "./ecosystems/types.js";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { glob } from "glob";

const execAsync = promisify(exec);

export interface FixStage {
  name: string;
  filePatterns: string[]; // glob patterns for files in this stage
  validator: (cwd: string) => Promise<boolean>; // check if this stage succeeded
}

/**
 * Common staged fix strategy for most projects:
 * 1. Configuration files (package.json, tsconfig.json, webpack.config.js)
 * 2. Type definitions (*.d.ts, types/)
 * 3. Source code (*.ts, *.tsx, *.js, *.jsx)
 */
export const COMMON_STAGES: FixStage[] = [
  {
    name: "Configuration",
    filePatterns: [
      "**/package.json",
      "**/tsconfig.json",
      "**/tsconfig.*.json",
      "**/webpack.config.js",
      "**/webpack.*.js",
      "**/.eslintrc.*",
      "**/babel.config.*",
      "**/vite.config.*",
      "**/rollup.config.*",
    ],
    validator: async (cwd) => {
      // Check if config files are syntactically valid
      return await validateConfigSyntax(cwd);
    },
  },
  {
    name: "Type Definitions",
    filePatterns: [
      "**/*.d.ts",
      "**/types/**/*.ts",
      "**/@types/**/*.ts",
    ],
    validator: async (cwd) => {
      // Check if TypeScript types are valid
      if (await pathExists(join(cwd, "tsconfig.json"))) {
        try {
          await execAsync("npx tsc --noEmit", { cwd, timeout: 60000 });
          return true;
        } catch {
          return false;
        }
      }
      return true; // No TypeScript, skip
    },
  },
  {
    name: "Source Code",
    filePatterns: [
      "**/*.ts",
      "**/*.tsx",
      "**/*.js",
      "**/*.jsx",
      // Exclude already handled files
      "!**/*.d.ts",
      "!**/types/**",
      "!**/@types/**",
      "!**/node_modules/**",
      "!**/dist/**",
      "!**/build/**",
      "!**/*.test.*",
      "!**/*.spec.*",
    ],
    validator: async (cwd) => {
      // Source code stage succeeds if tests pass
      // (This will be checked by the main fix loop)
      return true; // Delegated to main validator
    },
  },
];

async function validateConfigSyntax(cwd: string): Promise<boolean> {
  // Check if package.json is valid JSON
  try {
    const pkgPath = join(cwd, "package.json");
    if (await pathExists(pkgPath)) {
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(pkgPath, "utf8");
      JSON.parse(content); // Will throw if invalid
    }

    // Check if tsconfig.json is valid JSON
    const tsconfigPath = join(cwd, "tsconfig.json");
    if (await pathExists(tsconfigPath)) {
      const fs = await import("node:fs/promises");
      const content = await fs.readFile(tsconfigPath, "utf8");
      JSON.parse(content); // Will throw if invalid
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Match files against a set of glob patterns.
 */
export async function matchFiles(
  cwd: string,
  patterns: string[]
): Promise<string[]> {
  const allMatches = new Set<string>();

  for (const pattern of patterns) {
    const matches = await glob(pattern, {
      cwd,
      absolute: false,
      ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    });
    matches.forEach((m: string) => allMatches.add(m));
  }

  return Array.from(allMatches);
}

/**
 * Determine which files belong to which stage based on glob patterns.
 */
export async function categorizeFilesByStage(
  cwd: string,
  stages: FixStage[]
): Promise<Map<string, string[]>> {
  const stageFiles = new Map<string, string[]>();

  for (const stage of stages) {
    const files = await matchFiles(cwd, stage.filePatterns);
    stageFiles.set(stage.name, files);
  }

  return stageFiles;
}
