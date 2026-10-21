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

export function parseNpmOutdated(data: Record<string, { current?: string; wanted?: string; latest?: string }> | null): Outdated[] {
  if (!data) return [];
  return Object.entries(data)
    .map(([name, v]) => {
      // `npm outdated` omits `current` when the package is only in the
      // lockfile and not physically installed in node_modules (CI before
      // `npm ci`, partial installs). Falling back to `wanted` — the version
      // that satisfies the manifest, i.e. what the lockfile pins — keeps the
      // target version non-empty; an empty `from` would silently disable
      // codemod matching, changelog lookup and impact analysis.
      const current = v.current ?? v.wanted ?? "";
      return { name, current, wanted: v.wanted ?? "", latest: v.latest ?? "" };
    })
    .filter((o) => o.latest && o.current !== o.latest);
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
    return parseNpmOutdated(data);
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
