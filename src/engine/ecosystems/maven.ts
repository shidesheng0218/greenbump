import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

const DEP_BLOCK = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*<version>([^<]+)<\/version>/g;

export function parsePomXml(raw: string): Array<{ name: string; version: string }> {
  const deps: Array<{ name: string; version: string }> = [];
  for (const m of raw.matchAll(DEP_BLOCK)) {
    deps.push({ name: `${m[1]}:${m[2]}`, version: m[3] });
  }
  return deps;
}

async function directDeps(cwd: string): Promise<Array<{ name: string; version: string }>> {
  try {
    const raw = await readFile(join(cwd, "pom.xml"), "utf8");
    return parsePomXml(raw);
  } catch {
    return [];
  }
}

async function latestOnMavenCentral(groupArtifact: string): Promise<string | null> {
  const [g, a] = groupArtifact.split(":");
  try {
    const url = `https://search.maven.org/solrsearch/select?q=g:${encodeURIComponent(g)}+AND+a:${encodeURIComponent(a)}&core=gav&rows=1&sort=v+desc&wt=json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: { docs?: Array<{ v?: string }> } };
    return data.response?.docs?.[0]?.v ?? null;
  } catch {
    return null;
  }
}

/** Maven has no per-dependency pin CLI — versions live inline in pom.xml. */
export const mavenAdapter: EcosystemAdapter = {
  id: "maven",
  displayName: "Maven",
  manifestFiles: ["pom.xml"],
  lockFiles: [],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "pom.xml"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const deps = await directDeps(cwd);
    const out: Outdated[] = [];
    for (const d of deps) {
      const latest = await latestOnMavenCentral(d.name);
      if (latest && latest !== d.version) out.push({ name: d.name, current: d.version, wanted: "", latest });
    }
    return out;
  },

  async install(cwd, name, version) {
    const { readFile: rf, writeFile } = await import("node:fs/promises");
    const path = join(cwd, "pom.xml");
    const [, artifactId] = name.split(":");
    const raw = await rf(path, "utf8");
    const re = new RegExp(
      `(<artifactId>${escapeRegExp(artifactId)}<\\/artifactId>\\s*<version>)([^<]+)(<\\/version>)`,
    );
    if (!re.test(raw)) {
      return { code: 1, stdout: "", stderr: `could not find ${name} in pom.xml`, combined: `could not find ${name} in pom.xml` };
    }
    await writeFile(path, raw.replace(re, `$1${version}$3`), "utf8");
    return { code: 0, stdout: `pinned ${name} to ${version} in pom.xml`, stderr: "", combined: "" };
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "mvn", args: ["-q", "compile"] },
      test: { cmd: "mvn", args: ["-q", "test"] },
    };
  },
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
