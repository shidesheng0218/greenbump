import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, safeJson, type EcosystemAdapter, type Outdated } from "./types.js";
import { guessPythonTestCommand } from "./python-shared.js";

export function parseUvOutdated(
  data: Array<{ name: string; version: string; latest_version: string }> | null,
): Outdated[] {
  if (!data) return [];
  return data.map((d) => ({ name: d.name, current: d.version, wanted: "", latest: d.latest_version }));
}

export const uvAdapter: EcosystemAdapter = {
  id: "uv",
  displayName: "uv",
  manifestFiles: ["pyproject.toml"],
  lockFiles: ["uv.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "uv.lock"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("uv", ["tree", "--outdated", "--depth", "1"], { cwd, timeout: 120_000 });
    // `uv tree --outdated` has no stable JSON output; fall back to `uv pip list --outdated --format json`
    // against the project's venv, which is the documented machine-readable path.
    const r2 = await exec("uv", ["pip", "list", "--outdated", "--format", "json"], { cwd, timeout: 120_000 });
    const data = safeJson<Array<{ name: string; version: string; latest_version: string }>>(r2.stdout);
    void r;
    return parseUvOutdated(data);
  },

  async install(cwd, name, version) {
    return exec("uv", ["add", `${name}==${version}`], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands(cwd) {
    const test = await guessPythonTestCommand(cwd);
    return test ? { test: { cmd: "uv", args: ["run", test.cmd, ...test.args] } } : {};
  },
};
