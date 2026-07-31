import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

const REQUIRE_LINE = /^([A-Za-z0-9_-]+)\/([^@\s]+)/;

export function parseConanfileTxt(raw: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  let inRequires = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (/^\[requires\]/.test(trimmed)) {
      inRequires = true;
      continue;
    }
    if (/^\[/.test(trimmed)) {
      inRequires = false;
      continue;
    }
    if (!inRequires) continue;
    const m = REQUIRE_LINE.exec(trimmed);
    if (m) deps.push({ name: m[1], version: m[2] });
  }
  return deps;
}

async function directDeps(cwd: string, file: string): Promise<Array<{ name: string; version: string }>> {
  if (!file.endsWith(".txt")) return [];
  try {
    const raw = await readFile(join(cwd, file), "utf8");
    return parseConanfileTxt(raw);
  } catch {
    return [];
  }
}

// ConanCenter's actual remote is the Conan v1 search API at center2.conan.io,
// not a UI-search JSON endpoint — it returns package refs like
// `{"results": ["zlib/1.2.13@_/_", "zlib/1.3.1@_/_"]}`, not structured objects.
function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function latestOnConanCenter(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://center2.conan.io/v1/conans/search?q=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: string[] };
    const versions = (data.results ?? [])
      .map((ref) => ref.split("@")[0])
      .filter((nv) => nv.startsWith(`${name}/`))
      .map((nv) => nv.slice(name.length + 1));
    if (versions.length === 0) return null;
    return versions.sort(compareSemver).at(-1) ?? null;
  } catch {
    return null;
  }
}

export const conanAdapter: EcosystemAdapter = {
  id: "conan",
  displayName: "Conan (C/C++)",
  manifestFiles: ["conanfile.txt", "conanfile.py"],
  lockFiles: ["conan.lock"],
  verified: true,

  async detect(cwd) {
    return (await pathExists(join(cwd, "conanfile.txt"))) || (await pathExists(join(cwd, "conanfile.py")));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const file = (await pathExists(join(cwd, "conanfile.txt"))) ? "conanfile.txt" : "conanfile.py";
    const deps = await directDeps(cwd, file);
    const out: Outdated[] = [];
    for (const d of deps) {
      const latest = await latestOnConanCenter(d.name);
      if (latest && latest !== d.version) out.push({ name: d.name, current: d.version, wanted: "", latest });
    }
    return out;
  },

  async install(cwd, name, version) {
    const file = (await pathExists(join(cwd, "conanfile.txt"))) ? "conanfile.txt" : "conanfile.py";
    if (file !== "conanfile.txt") {
      return { code: 1, stdout: "", stderr: "conanfile.py requires manual editing (not a plain-text format)", combined: "conanfile.py requires manual editing (not a plain-text format)" };
    }
    const path = join(cwd, file);
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`^${name}\\/[^@\\s]+`, "m");
    if (!re.test(raw)) {
      return { code: 1, stdout: "", stderr: `could not find ${name} in conanfile.txt`, combined: `could not find ${name} in conanfile.txt` };
    }
    await writeFile(path, raw.replace(re, `${name}/${version}`), "utf8");
    return exec("conan", ["install", "."], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return { build: { cmd: "conan", args: ["build", "."] } };
  },
};
