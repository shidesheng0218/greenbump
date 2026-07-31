import { join } from "node:path";
import { exec } from "../exec.js";
import { pathExists, type EcosystemAdapter, type Outdated } from "./types.js";

// `mix hex.outdated` prints a fixed-width table: "Dependency  Only  Current  Latest  Status".
// The "Only" cell is blank for deps with no `only:` restriction, so a plain
// whitespace-split misreads columns (e.g. a "dev"-only dep shifts every
// later field left by one). Slice by the header's column start offsets instead.
const HEADER = /^Dependency\s+Only\s+Current\s+Latest\s+Status/;

export function parseMixOutdated(stdout: string): Outdated[] {
  const lines = stdout.split("\n");
  const headerIdx = lines.findIndex((l) => HEADER.test(l));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx];
  const idxOnly = header.indexOf("Only");
  const idxCurrent = header.indexOf("Current");
  const idxLatest = header.indexOf("Latest");
  const idxStatus = header.indexOf("Status");

  const out: Outdated[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    if (!line.trim()) break; // blank line ends the table
    const name = line.slice(0, idxOnly).trim();
    const current = line.slice(idxCurrent, idxLatest).trim();
    const latest = line.slice(idxLatest, idxStatus).trim();
    if (name && current && latest && current !== latest) out.push({ name, current, wanted: "", latest });
  }
  return out;
}

export const mixAdapter: EcosystemAdapter = {
  id: "mix",
  displayName: "Mix (Hex)",
  manifestFiles: ["mix.exs"],
  lockFiles: ["mix.lock"],
  verified: true,

  async detect(cwd) {
    return pathExists(join(cwd, "mix.exs"));
  },

  async outdated(cwd): Promise<Outdated[]> {
    const r = await exec("mix", ["hex.outdated"], { cwd, timeout: 120_000 });
    return parseMixOutdated(r.stdout);
  },

  async install(cwd, name, version) {
    // mix.exs deps are declared as Elixir code (`{:name, "~> 1.0"}`); no
    // official CLI pins a single dep version, so we edit the source line.
    const { readFile, writeFile } = await import("node:fs/promises");
    const path = join(cwd, "mix.exs");
    const raw = await readFile(path, "utf8");
    const re = new RegExp(`(\\{:${name},\\s*)"[^"]+"`);
    if (!re.test(raw)) {
      return { code: 1, stdout: "", stderr: `could not find :${name} in mix.exs`, combined: `could not find :${name} in mix.exs` };
    }
    await writeFile(path, raw.replace(re, `$1"== ${version}"`), "utf8");
    return { code: 0, stdout: `pinned ${name} to ${version} in mix.exs`, stderr: "", combined: "" };
  },

  async defaultCheckCommands() {
    return {
      build: { cmd: "mix", args: ["compile"] },
      test: { cmd: "mix", args: ["test"] },
    };
  },
};
