import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

// `bundle outdated` prints lines like:
//   * rails (newest 7.1.2, installed 7.0.4, requested ~> 7.0)
const OUTDATED_LINE = /^\s*\*\s*([A-Za-z0-9_.-]+)\s*\(newest\s+([^\s,]+),\s*installed\s+([^\s,)]+)/;

export function parseBundlerOutdated(stdout: string): Outdated[] {
  const out: Outdated[] = [];
  for (const line of stdout.split("\n")) {
    const m = OUTDATED_LINE.exec(line);
    if (m && m[2] !== m[3]) out.push({ name: m[1], current: m[3], wanted: "", latest: m[2] });
  }
  return out;
}

export const bundlerAdapter: EcosystemAdapter = {
  id: "bundler",
  displayName: "Bundler",
  manifestFiles: ["Gemfile"],
  lockFiles: ["Gemfile.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "Gemfile"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    // `bundle outdated` exits non-zero when it finds outdated gems.
    const r = await exec("bundle", ["outdated"], { cwd, timeout: 120_000 });
    return parseBundlerOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    // Bundler pins via the Gemfile, not a per-install flag — update the
    // version constraint then let `bundle update` resolve it.
    const r = await exec("bundle", ["update", name, "--conservative"], { cwd, timeout: 300_000 });
    if (r.code !== 0) return r;
    return pinInGemfile(cwd, name, version, r);
  },

  async defaultCheckCommands(cwd) {
    const hasRakefile = await pathExists(join(cwd, "Rakefile"));
    return { test: { cmd: "bundle", args: hasRakefile ? ["exec", "rake", "test"] : ["exec", "rspec"] } };
  },
};

async function pinInGemfile(
  cwd: string,
  name: string,
  version: string,
  fallback: { code: number; stdout: string; stderr: string; combined: string },
) {
  const { readFile, writeFile } = await import("node:fs/promises");
  try {
    const path = join(cwd, "Gemfile");
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`^(\\s*gem\\s+["']${name}["'])(.*)$`, "m");
    if (re.test(raw)) {
      const next = raw.replace(re, `$1, "= ${version}"`);
      await writeFile(path, next, "utf8");
    }
  } catch {
    // best effort; `bundle update` already ran.
  }
  return fallback;
}
