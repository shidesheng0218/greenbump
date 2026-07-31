import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, safeJson, type EcosystemAdapter, type Outdated } from "./types.js";
import { guessPythonTestCommand } from "./python-shared.js";

export const pipenvAdapter: EcosystemAdapter = {
  id: "pipenv",
  displayName: "Pipenv",
  manifestFiles: ["Pipfile"],
  lockFiles: ["Pipfile.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "Pipfile"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    // `pipenv update --outdated` prints human text; the documented
    // machine-readable path is asking pip inside pipenv's venv.
    const r = await exec("pipenv", ["run", "pip", "list", "--outdated", "--format", "json"], {
      cwd,
      timeout: 120_000,
    });
    const data = safeJson<Array<{ name: string; version: string; latest_version: string }>>(r.stdout);
    if (!data) return [];
    return data.map((d) => ({ name: d.name, current: d.version, wanted: "", latest: d.latest_version }));
  },

  async install(cwd, name, version) {
    return exec("pipenv", ["install", `${name}==${version}`], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands(cwd) {
    const test = await guessPythonTestCommand(cwd);
    return test ? { test: { cmd: "pipenv", args: ["run", test.cmd, ...test.args] } } : {};
  },
};
