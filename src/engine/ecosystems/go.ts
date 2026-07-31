import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

interface GoListModule {
  Path: string;
  Version?: string;
  Update?: { Version?: string };
  Main?: boolean;
  Indirect?: boolean;
}

export const goAdapter: EcosystemAdapter = {
  id: "go",
  displayName: "Go modules",
  manifestFiles: ["go.mod"],
  lockFiles: ["go.sum"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "go.mod"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("go", ["list", "-u", "-m", "-json", "all"], { cwd, timeout: 180_000 });
    return parseGoListOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    return exec("go", ["get", `${name}@v${version.replace(/^v/, "")}`], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "go", args: ["build", "./..."] },
      test: { cmd: "go", args: ["test", "./..."] },
    };
  },
};

/**
 * `go list -json all` streams one JSON object per module, not a single
 * array. Exported standalone so it can be unit-tested against a fixture
 * without shelling out to go.
 */
export function parseGoListOutdated(stdout: string): Outdated[] {
  const out: Outdated[] = [];
  for (const chunk of splitJsonObjects(stdout)) {
    const mod = safeJsonParse<GoListModule>(chunk);
    if (!mod || mod.Main || mod.Indirect || !mod.Update?.Version || !mod.Version) continue;
    if (mod.Update.Version === mod.Version) continue;
    out.push({ name: mod.Path, current: mod.Version, wanted: "", latest: mod.Update.Version });
  }
  return out;
}

function splitJsonObjects(text: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        chunks.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return chunks;
}

function safeJsonParse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
