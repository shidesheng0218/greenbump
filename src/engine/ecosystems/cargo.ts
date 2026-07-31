import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

const DEP_LINE = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]+)"/;

export function parseCargoToml(raw: string): Map<string, string> {
  const deps = new Map<string, string>();
  let inDeps = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (/^\[dependencies\]/.test(trimmed)) {
      inDeps = true;
      continue;
    }
    if (/^\[/.test(trimmed)) {
      inDeps = false;
      continue;
    }
    if (!inDeps) continue;
    const m = DEP_LINE.exec(trimmed);
    if (m) deps.set(m[1], m[2].replace(/^[\^~=]/, ""));
  }
  return deps;
}

async function directDeps(cwd: string): Promise<Map<string, string>> {
  try {
    const raw = await readFile(join(cwd, "Cargo.toml"), "utf8");
    return parseCargoToml(raw);
  } catch {
    return new Map();
  }
}

async function latestOnCratesIo(name: string): Promise<string | null> {
  try {
    const res = await fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(name)}`, {
      headers: { "User-Agent": "greenbump (https://github.com/YOUR_GH_USERNAME/greenbump)" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { crate?: { max_stable_version?: string } };
    return data.crate?.max_stable_version ?? null;
  } catch {
    return null;
  }
}

export const cargoAdapter: EcosystemAdapter = {
  id: "cargo",
  displayName: "Cargo",
  manifestFiles: ["Cargo.toml"],
  lockFiles: ["Cargo.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "Cargo.toml"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    // No reliable built-in "outdated" command ships with stock cargo (that's
    // the separate `cargo-outdated` plugin, not assumed installed) — query
    // crates.io directly for each direct dependency instead.
    const deps = await directDeps(cwd);
    const out: Outdated[] = [];
    for (const [name, current] of deps) {
      const latest = await latestOnCratesIo(name);
      if (latest && latest !== current) out.push({ name, current, wanted: "", latest });
    }
    return out;
  },

  async install(cwd, name, version) {
    // `cargo add pkg@=version` pins exactly (Cargo 1.62+, built in — no plugin needed).
    return exec("cargo", ["add", `${name}@=${version}`], { cwd, timeout: 300_000 });
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "cargo", args: ["build"] },
      test: { cmd: "cargo", args: ["test"] },
    };
  },
};
