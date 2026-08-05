import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

// Matches: .package(url: "https://github.com/org/repo", from: "1.2.3")
const PKG_LINE = /\.package\(\s*url:\s*"([^"]+)"\s*,\s*from:\s*"([^"]+)"\s*\)/g;

function repoNameFromUrl(url: string): string {
  return url.replace(/\.git$/, "").split("/").pop() ?? url;
}

/**
 * SwiftPM has no built-in "outdated" concept and Package.swift is Swift
 * source code, not a data format — we regex out `.package(url:, from:)`
 * declarations rather than truly parsing it. This is the highest-risk
 * adapter in the set: works for the common declaration style, not
 * exhaustive.
 */
export function parsePackageResolved(raw: string): Record<string, string> {
  const resolved: Record<string, string> = {};
  const data = JSON.parse(raw) as { pins?: Array<{ identity?: string; state?: { version?: string } }> };
  for (const pin of data.pins ?? []) {
    if (pin.identity && pin.state?.version) resolved[pin.identity] = pin.state.version;
  }
  return resolved;
}

export function parsePackageSwiftDeps(
  manifest: string,
  resolved: Record<string, string>,
): Array<{ name: string; current: string; url: string }> {
  const out: Array<{ name: string; current: string; url: string }> = [];
  for (const m of manifest.matchAll(PKG_LINE)) {
    const name = repoNameFromUrl(m[1]).toLowerCase();
    const current = resolved[name];
    if (!current) continue;
    out.push({ name, current, url: m[1] });
  }
  return out;
}

export const swiftpmAdapter: EcosystemAdapter = {
  id: "swiftpm",
  displayName: "Swift Package Manager",
  manifestFiles: ["Package.swift"],
  lockFiles: ["Package.resolved"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "Package.swift"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    let resolved: Record<string, string> = {};
    try {
      const raw = await readFile(join(cwd, "Package.resolved"), "utf8");
      resolved = parsePackageResolved(raw);
    } catch {
      return [];
    }

    const manifest = await readFile(join(cwd, "Package.swift"), "utf8");
    const deps = parsePackageSwiftDeps(manifest, resolved);
    const out: Outdated[] = [];
    for (const dep of deps) {
      const latest = await latestGitHubTag(dep.url);
      if (latest && latest !== dep.current) out.push({ name: dep.name, current: dep.current, wanted: "", latest });
    }
    return out;
  },

  async install(cwd, name, version) {
    const path = join(cwd, "Package.swift");
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`(\\.package\\(\\s*url:\\s*"[^"]*${escapeRegExp(name)}[^"]*"\\s*,\\s*from:\\s*")[^"]+(")`, "i");
    if (!re.test(raw)) {
      return { code: 1, stdout: "", stderr: `could not find package ${name} in Package.swift`, combined: `could not find package ${name} in Package.swift` };
    }
    await writeFile(path, raw.replace(re, `$1${version}$2`), "utf8");
    return exec("swift", ["package", "resolve"], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "swift", args: ["build"] },
      test: { cmd: "swift", args: ["test"] },
    };
  },
};

async function latestGitHubTag(repoUrl: string): Promise<string | null> {
  const m = /github\.com\/([^/]+)\/([^/.]+)/.exec(repoUrl);
  if (!m) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/tags`, {
      headers: { "User-Agent": "greenbump" },
    });
    if (!res.ok) return null;
    const tags = (await res.json()) as Array<{ name: string }>;
    return tags[0]?.name.replace(/^v/, "") ?? null;
  } catch {
    return null;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
