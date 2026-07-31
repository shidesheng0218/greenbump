import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "../exec.js";
import { pathExists, safeJson, type EcosystemAdapter, type Outdated } from "./types.js";
import { guessPythonTestCommand } from "./python-shared.js";

const REQ_FILE = "requirements.txt";

/**
 * pip has no per-project isolation of its own — `pip list` reports whatever
 * is installed in the active interpreter/venv. We assume the caller has
 * already activated the right venv (same assumption `pip install` itself
 * makes). This is a known limitation vs. lockfile-based ecosystems.
 */
export const pipAdapter: EcosystemAdapter = {
  id: "pip",
  displayName: "pip",
  manifestFiles: [REQ_FILE],
  lockFiles: [],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, REQ_FILE));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("pip3", ["list", "--outdated", "--format", "json"], { cwd, timeout: 120_000 });
    const data = safeJson<Array<{ name: string; version: string; latest_version: string }>>(r.stdout);
    if (!data) return [];
    return data.map((d) => ({ name: d.name, current: d.version, wanted: "", latest: d.latest_version }));
  },

  async install(cwd, name, version) {
    const r = await exec("pip3", ["install", `${name}==${version}`], { cwd, timeout: 300_000 });
    if (r.code !== 0) return r;
    await pinInRequirements(cwd, name, version);
    return r;
  },

  async defaultCheckCommands(cwd) {
    const test = await guessPythonTestCommand(cwd);
    return { test };
  },
};

/** `pip install` doesn't touch requirements.txt, so we pin the version ourselves. */
async function pinInRequirements(cwd: string, name: string, version: string): Promise<void> {
  const path = join(cwd, REQ_FILE);
  try {
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`^${escapeRegExp(name)}\\s*(==|>=|<=|~=|>|<)?.*$`, "im");
    const line = `${name}==${version}`;
    const next = re.test(raw) ? raw.replace(re, line) : raw.trimEnd() + `\n${line}\n`;
    await writeFile(path, next, "utf8");
  } catch {
    // no requirements.txt to update; the pip install itself already ran.
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
