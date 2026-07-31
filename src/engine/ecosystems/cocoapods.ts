import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

// `pod outdated` prints lines like:
// "- AFNetworking 4.0.0 -> 4.0.0 (latest version 4.0.1)"
// The value after "->" is only what the Podfile's constraint allows to
// resolve to (often == current for an exact pin), NOT the true latest —
// that's only in the "(latest version X)" suffix.
const ROW = /^\s*-\s*([A-Za-z0-9_+-]+)\s+([^\s]+)\s*->\s*[^\s]+\s*\(latest version ([^)]+)\)/;

export function parseCocoapodsOutdated(stdout: string): Outdated[] {
  const out: Outdated[] = [];
  for (const line of stdout.split("\n")) {
    const m = ROW.exec(line);
    if (m && m[2] !== m[3]) out.push({ name: m[1], current: m[2], wanted: "", latest: m[3] });
  }
  return out;
}

export const cocoapodsAdapter: EcosystemAdapter = {
  id: "cocoapods",
  displayName: "CocoaPods",
  manifestFiles: ["Podfile"],
  lockFiles: ["Podfile.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "Podfile"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("pod", ["outdated"], { cwd, timeout: 120_000 });
    return parseCocoapodsOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    const path = join(cwd, "Podfile");
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`(pod\\s+["']${name}["'])(.*)$`, "m");
    if (!re.test(raw)) {
      return { code: 1, stdout: "", stderr: `could not find pod "${name}" in Podfile`, combined: `could not find pod "${name}" in Podfile` };
    }
    await writeFile(path, raw.replace(re, `$1, "= ${version}"`), "utf8");
    return exec("pod", ["install"], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return { build: { cmd: "xcodebuild", args: ["build", "-workspace", ".", "-scheme", "App"] } };
  },
};
