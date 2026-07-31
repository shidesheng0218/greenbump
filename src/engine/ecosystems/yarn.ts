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

/**
 * Yarn classic prints newline-delimited JSON; the row we want has type
 * "table" with data.head = ["Package", "Current", "Wanted", "Latest", …].
 * Exported standalone so it can be unit-tested against a fixture without
 * shelling out to yarn.
 */
export function parseYarnOutdated(stdout: string): Outdated[] {
  for (const line of stdout.split("\n")) {
    const obj = safeJson<{ type?: string; data?: { head: string[]; body: string[][] } }>(line);
    if (obj?.type !== "table" || !obj.data) continue;
    const head = obj.data.head.map((h) => h.toLowerCase());
    const iName = head.indexOf("package");
    const iCurrent = head.indexOf("current");
    const iLatest = head.indexOf("latest");
    if (iName < 0 || iCurrent < 0 || iLatest < 0) continue;
    return obj.data.body
      .map((row) => ({ name: row[iName], current: row[iCurrent], wanted: "", latest: row[iLatest] }))
      .filter((o) => o.name && o.latest && o.current !== o.latest);
  }
  return [];
}

export const yarnAdapter: EcosystemAdapter = {
  id: "yarn",
  displayName: "Yarn",
  manifestFiles: ["package.json"],
  lockFiles: ["yarn.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "yarn.lock"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("yarn", ["outdated", "--json"], { cwd, timeout: 120_000 });
    return parseYarnOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    return exec("yarn", ["add", `${name}@${version}`, "--exact"], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands(cwd) {
    const scripts = await readScripts(cwd);
    return {
      build: scripts.build ? { cmd: "yarn", args: ["run", "build"] } : undefined,
      test: scripts.test ? { cmd: "yarn", args: ["test"] } : undefined,
    };
  },
};
