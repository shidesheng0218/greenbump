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
    const resolvedPath = join(cwd, "Package.resolved");
    let resolved: Record<string, string> = {};
    try {
      const raw = await readFile(resolvedPath, "utf8");
      const data = JSON.parse(raw) as {
        pins?: Array<{ identity?: string; state?: { version?: string } }>;
      };
      for (const pin of data.pins ?? []) {
        if (pin.identity && pin.state?.version) resolved[pin.identity] = pin.state.version;
      }
    } catch {
      return [];
    }

    const manifest = await readFile(join(cwd, "Package.swift"), "utf8");
    const out: Outdated[] = [];
    for (const m of manifest.matchAll(PKG_LINE)) {
      const name = repoNameFromUrl(m[1]).toLowerCase();
      const current = resolved[name];
      if (!current) continue;
      const latest = await latestGitHubTag(m[1]);
      if (latest && latest !== current) out.push({ name, current, wanted: "", latest });
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
