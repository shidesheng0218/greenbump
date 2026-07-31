import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, safeJson, type EcosystemAdapter, type Outdated } from "./types.js";

async function readScripts(cwd: string): Promise<{ build?: string; test?: string }> {
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(cwd, "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return { build: pkg.scripts?.build, test: pkg.scripts?.test };
  } catch {
    return {};
  }
}

export const npmAdapter: EcosystemAdapter = {
  id: "npm",
  displayName: "npm",
  manifestFiles: ["package.json"],
  lockFiles: ["package-lock.json"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "package.json"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("npm", ["outdated", "--json"], { cwd, timeout: 120_000 });
    const data = safeJson<Record<string, { current?: string; latest?: string }>>(r.stdout);
    if (!data) return [];
    return Object.entries(data)
      .map(([name, v]) => ({ name, current: v.current ?? "", wanted: "", latest: v.latest ?? "" }))
      .filter((o) => o.latest && o.current !== o.latest);
  },

  async install(cwd, name, version) {
    return exec("npm", ["install", `${name}@${version}`, "--save-exact"], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands(cwd) {
    const scripts = await readScripts(cwd);
    return {
      build: scripts.build ? { cmd: "npm", args: ["run", "build"] } : undefined,
      test: scripts.test ? { cmd: "npm", args: ["test"] } : undefined,
    };
  },
};
