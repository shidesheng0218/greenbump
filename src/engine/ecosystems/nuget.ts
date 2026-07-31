import { readdir } from "node:fs/promises";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";
import { exec } from "../exec.js";

// `dotnet list package --outdated` prints whitespace-aligned columns, no
// arrow: "   > Newtonsoft.Json      13.0.1      13.0.1     13.0.3"
// (Package  Requested  Resolved  Latest) — current version is "Resolved".
const OUTDATED_LINE = /^\s*>\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/;

export function parseNugetOutdated(stdout: string): Outdated[] {
  const out: Outdated[] = [];
  for (const line of stdout.split("\n")) {
    const m = OUTDATED_LINE.exec(line);
    if (m) out.push({ name: m[1], current: m[3], wanted: m[2], latest: m[4] });
  }
  return out;
}

async function hasCsproj(cwd: string): Promise<boolean> {
  try {
    const entries = await readdir(cwd);
    return entries.some((e) => e.endsWith(".csproj") || e.endsWith(".sln"));
  } catch {
    return false;
  }
}

export const nugetAdapter: EcosystemAdapter = {
  id: "nuget",
  displayName: "NuGet (.NET)",
  manifestFiles: ["*.csproj"],
  lockFiles: ["packages.lock.json"],
  verified: true,

  async detect(cwd) {
    return hasCsproj(cwd);
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("dotnet", ["list", "package", "--outdated"], { cwd, timeout: 180_000 });
    return parseNugetOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    return exec("dotnet", ["add", "package", name, "--version", version], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "dotnet", args: ["build"] },
      test: { cmd: "dotnet", args: ["test"] },
    };
  },
};

void pathExists;
