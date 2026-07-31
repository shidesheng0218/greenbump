import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

interface ElmJson {
  dependencies?: { direct?: Record<string, string> };
}

async function latestOnElmPackages(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://package.elm-lang.org/packages/${name}/releases.json`);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, number>;
    const versions = Object.keys(data);
    if (versions.length === 0) return null;
    return versions.sort(compareSemver).at(-1) ?? null;
  } catch {
    return null;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

export const elmAdapter: EcosystemAdapter = {
  id: "elm",
  displayName: "Elm",
  manifestFiles: ["elm.json"],
  lockFiles: [],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "elm.json"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    try {
      const raw = await readFile(join(cwd, "elm.json"), "utf8");
      const json = JSON.parse(raw) as ElmJson;
      const deps = json.dependencies?.direct ?? {};
      const out: Outdated[] = [];
      for (const [name, current] of Object.entries(deps)) {
        const latest = await latestOnElmPackages(name);
        if (latest && latest !== current) out.push({ name, current, wanted: "", latest });
      }
      return out;
    } catch {
      return [];
    }
  },

  async install(cwd, name, version) {
    // `elm install` always adds the latest version and has no version-pin
    // flag; land the exact version by editing elm.json directly.
    const path = join(cwd, "elm.json");
    const raw = await readFile(path, "utf8");
    const json = JSON.parse(raw) as ElmJson & Record<string, unknown>;
    if (!json.dependencies?.direct?.[name]) {
      return { code: 1, stdout: "", stderr: `${name} is not a direct dependency in elm.json`, combined: `${name} is not a direct dependency in elm.json` };
    }
    json.dependencies.direct[name] = version;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(json, null, 4), "utf8");
    return { code: 0, stdout: `pinned ${name} to ${version} in elm.json`, stderr: "", combined: "" };
  },

  async defaultCheckCommands() {
    return { build: { cmd: "elm", args: ["make", "src/Main.elm", "--output=/dev/null"] } };
  },
};

void exec;
