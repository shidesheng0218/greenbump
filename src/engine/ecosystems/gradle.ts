import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

// Matches lines like: implementation("group:artifact:1.2.3") or implementation 'group:artifact:1.2.3'
const DEP_LINE = /(implementation|api|testImplementation|compileOnly|runtimeOnly)[\s(]+['"]([^:'"]+):([^:'"]+):([^'")]+)['")]/g;

export function parseGradleBuildFile(raw: string): Array<{ group: string; artifact: string; version: string }> {
  const deps: Array<{ group: string; artifact: string; version: string }> = [];
  for (const m of raw.matchAll(DEP_LINE)) {
    deps.push({ group: m[2], artifact: m[3], version: m[4] });
  }
  return deps;
}

async function findBuildFile(cwd: string): Promise<string | null> {
  for (const name of ["build.gradle.kts", "build.gradle"]) {
    if (await pathExists(join(cwd, name))) return name;
  }
  return null;
}

async function directDeps(cwd: string, file: string): Promise<Array<{ group: string; artifact: string; version: string }>> {
  try {
    const raw = await readFile(join(cwd, file), "utf8");
    return parseGradleBuildFile(raw);
  } catch {
    return [];
  }
}

async function latestOnMavenCentral(group: string, artifact: string): Promise<string | null> {
  try {
    const url = `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(group)}+AND+a:${encodeURIComponent(artifact)}&core=gav&rows=1&sort=v+desc&wt=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: { docs?: Array<{ v?: string }> } };
    return data.response?.docs?.[0]?.v ?? null;
  } catch {
    return null;
  }
}

/** Gradle dependency versions are inline in build.gradle(.kts), same constraint as Maven. */
export const gradleAdapter: EcosystemAdapter = {
  id: "gradle",
  displayName: "Gradle",
  manifestFiles: ["build.gradle", "build.gradle.kts"],
  lockFiles: ["gradle.lockfile"],
  verified: true,

  async detect(cwd) {
    return (await findBuildFile(cwd)) !== null;
  },

  async outdated(cwd): Promise<Outdated[]> {
    const file = await findBuildFile(cwd);
    if (!file) return [];
    const deps = await directDeps(cwd, file);
    const out: Outdated[] = [];
    for (const d of deps) {
      const latest = await latestOnMavenCentral(d.group, d.artifact);
      if (latest && latest !== d.version) {
        out.push({ name: `${d.group}:${d.artifact}`, current: d.version, wanted: "", latest });
      }
    }
    return out;
  },

  async install(cwd, name, version) {
    const file = await findBuildFile(cwd);
    if (!file) return { code: 1, stdout: "", stderr: "no build.gradle(.kts) found", combined: "no build.gradle(.kts) found" };
    const [, artifact] = name.split(":");
    const path = join(cwd, file);
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`(['"][^:'"]+:${escapeRegExp(artifact)}:)[^'")]+(['")])`);
    if (!re.test(raw)) {
      return { code: 1, stdout: "", stderr: `could not find ${name} in ${file}`, combined: `could not find ${name} in ${file}` };
    }
    await writeFile(path, raw.replace(re, `$1${version}$2`), "utf8");
    return { code: 0, stdout: `pinned ${name} to ${version} in ${file}`, stderr: "", combined: "" };
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "gradle", args: ["build", "-x", "test"] },
      test: { cmd: "gradle", args: ["test"] },
    };
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
