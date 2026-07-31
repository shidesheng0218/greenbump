import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";
import { guessPythonTestCommand } from "./python-shared.js";

const OUTDATED_LINE = /^(\S+)\s+(\S+)\s+(\S+)/;

export function parsePoetryOutdated(stdout: string): Outdated[] {
  const out: Outdated[] = [];
  for (const line of stdout.split("\n")) {
    const m = OUTDATED_LINE.exec(line.trim());
    if (!m) continue;
    const [, name, current, latest] = m;
    if (current !== latest) out.push({ name, current, wanted: "", latest });
  }
  return out;
}

export const poetryAdapter: EcosystemAdapter = {
  id: "poetry",
  displayName: "Poetry",
  manifestFiles: ["pyproject.toml"],
  lockFiles: ["poetry.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "poetry.lock"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    // `poetry show -o` prints "name  current  latest  description" as plain
    // text (no --json flag exists for this subcommand).
    const r = await exec("poetry", ["show", "-o", "--no-ansi"], { cwd, timeout: 120_000 });
    return parsePoetryOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    return exec("poetry", ["add", `${name}==${version}`], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands(cwd) {
    const test = await guessPythonTestCommand(cwd);
    // poetry-managed projects run their tests through the poetry venv.
    return test ? { test: { cmd: "poetry", args: ["run", test.cmd, ...test.args] } } : {};
  },
};
