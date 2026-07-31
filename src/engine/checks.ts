import { exec } from "./exec.js";
import { getAdapter, type PackageManager } from "./pm.js";
import type { CheckCommand } from "./ecosystems/index.js";

export interface CheckResult {
  ok: boolean;
  /** Truncated combined output of whatever step failed (or the last step). */
  output: string;
  /** Which step failed, for messaging. */
  failedStep?: "build" | "test";
  /** True when the repo has neither a build nor a test check to verify against. */
  unverifiable: boolean;
}

export interface CheckOverrides {
  /** full command string, e.g. "make test" — splits on whitespace */
  buildCmd?: string;
  testCmd?: string;
}

const MAX_OUTPUT = 16_000;

function tail(s: string, max = MAX_OUTPUT): string {
  if (s.length <= max) return s;
  return "...(truncated)...\n" + s.slice(s.length - max);
}

function parseOverride(raw: string): CheckCommand {
  const [cmd, ...args] = raw.split(/\s+/).filter(Boolean);
  return { cmd, args };
}

/**
 * Run the project's build then test command, whichever exist. Stops at the
 * first failure and returns its output so the agent has something concrete
 * to fix. Commands come from `--build-cmd`/`--test-cmd` when given,
 * otherwise from the detected ecosystem adapter's best-effort defaults.
 */
export async function runChecks(
  pm: PackageManager,
  cwd: string,
  overrides: CheckOverrides = {},
): Promise<CheckResult> {
  const adapter = getAdapter(pm);
  const defaults = await adapter.defaultCheckCommands(cwd);
  const build = overrides.buildCmd ? parseOverride(overrides.buildCmd) : defaults.build;
  const test = overrides.testCmd ? parseOverride(overrides.testCmd) : defaults.test;

  if (!build && !test) {
    return { ok: true, output: "", unverifiable: true };
  }

  if (build) {
    const r = await exec(build.cmd, build.args, { cwd, timeout: 300_000 });
    if (r.code !== 0) {
      return { ok: false, output: tail(r.combined), failedStep: "build", unverifiable: false };
    }
  }

  if (test) {
    const r = await exec(test.cmd, test.args, { cwd, timeout: 300_000 });
    if (r.code !== 0) {
      return { ok: false, output: tail(r.combined), failedStep: "test", unverifiable: false };
    }
  }

  return { ok: true, output: "", unverifiable: false };
}
