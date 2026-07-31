import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { pathExists, type CheckCommand } from "./types.js";

/**
 * Python has no universal test runner the way `npm test` is universal, so we
 * guess: pytest config or a tests/ dir → pytest; tox.ini → tox; otherwise
 * fall back to stdlib unittest discovery. `--test-cmd` overrides this.
 */
export async function guessPythonTestCommand(cwd: string): Promise<CheckCommand | undefined> {
  if (await pathExists(join(cwd, "pytest.ini"))) return { cmd: "pytest", args: [] };
  if (await pathExists(join(cwd, "tests"))) return { cmd: "pytest", args: [] };
  if (await hasPytestConfig(cwd)) return { cmd: "pytest", args: [] };
  if (await pathExists(join(cwd, "tox.ini"))) return { cmd: "tox", args: [] };
  return { cmd: "python3", args: ["-m", "unittest", "discover"] };
}

async function hasPytestConfig(cwd: string): Promise<boolean> {
  try {
    const raw = await readFile(join(cwd, "pyproject.toml"), "utf8");
    return raw.includes("[tool.pytest");
  } catch {
    return false;
  }
}
