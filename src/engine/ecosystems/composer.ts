import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, safeJson, type EcosystemAdapter, type Outdated } from "./types.js";

interface ComposerOutdatedRow {
  name: string;
  version: string;
  latest: string;
}

export function parseComposerOutdated(stdout: string): Outdated[] {
  const data = safeJson<{ installed?: ComposerOutdatedRow[] }>(stdout);
  if (!data?.installed) return [];
  return data.installed
    .filter((d) => d.version !== d.latest)
    .map((d) => ({ name: d.name, current: d.version, wanted: "", latest: d.latest }));
}

export const composerAdapter: EcosystemAdapter = {
  id: "composer",
  displayName: "Composer",
  manifestFiles: ["composer.json"],
  lockFiles: ["composer.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "composer.json"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("composer", ["outdated", "--direct", "--format", "json"], { cwd, timeout: 120_000 });
    return parseComposerOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    return exec("composer", ["require", `${name}:${version}`, "--no-interaction"], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return { test: { cmd: "composer", args: ["exec", "phpunit"] } };
  },
};
