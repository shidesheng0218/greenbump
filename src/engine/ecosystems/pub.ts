import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, safeJson, type EcosystemAdapter, type Outdated } from "./types.js";

interface PubOutdatedPkg {
  package: string;
  current?: { version: string };
  latest?: { version: string };
}

export function parsePubOutdated(stdout: string): Outdated[] {
  const data = safeJson<{ packages?: PubOutdatedPkg[] }>(stdout);
  if (!data?.packages) return [];
  return data.packages
    .filter((p) => p.current?.version && p.latest?.version && p.current.version !== p.latest.version)
    .map((p) => ({ name: p.package, current: p.current!.version, wanted: "", latest: p.latest!.version }));
}

export const pubAdapter: EcosystemAdapter = {
  id: "pub",
  displayName: "Pub (Dart/Flutter)",
  manifestFiles: ["pubspec.yaml"],
  lockFiles: ["pubspec.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "pubspec.yaml"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("dart", ["pub", "outdated", "--json"], { cwd, timeout: 120_000 });
    return parsePubOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    return exec("dart", ["pub", "add", `${name}:${version}`], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return { test: { cmd: "dart", args: ["test"] } };
  },
};
