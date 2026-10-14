import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isSensitivePath } from "../../agent/guard.js";
import { REQUIRES_IMPORT_PREFIX, escapeRegExpLiteral, type Probe } from "./probes.js";

/**
 * Single-pass file walker for impact analysis.
 *
 * Scans the project tree once, checking every line against every probe.
 * Optimized for "find which files/lines match any of these patterns" —
 * the inverse of `searchCode` (which is "find lines matching this one pattern").
 */

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo"]);
const SEARCHABLE_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".json", ".vue", ".svelte",
]);
const MAX_FILE_SIZE = 1_000_000;

export interface RawHit {
  probeKey: string;
  file: string;
  line: number;
  excerpt: string;
}

/**
 * Scan the project once, finding all matches for all probes.
 *
 * Returns hits grouped by probe key, plus a set of probe keys that hit the
 * per-probe cap (indicating their match count is a lower bound).
 */
export async function scanOnce(
  cwd: string,
  probes: Probe[],
  opts: { perProbeCap: number },
): Promise<{ hits: RawHit[]; truncatedProbes: Set<string> }> {
  const hits: RawHit[] = [];
  const truncatedProbes = new Set<string>();
  const probeHitsCount = new Map<string, number>();

  // Compile each probe's regex once, not once per line per probe. A pattern
  // that fails to compile falls back to a literal match (same policy as the
  // fix loop's search_code tool).
  const compiled: Array<{ probe: Probe; re: RegExp }> = [];
  for (const probe of probes) {
    probeHitsCount.set(probe.key, 0);
    let re: RegExp;
    try {
      re = new RegExp(probe.pattern, "g");
    } catch {
      re = new RegExp(escapeRegExpLiteral(probe.pattern), "g");
    }
    compiled.push({ probe, re });
  }

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      const dot = e.name.lastIndexOf(".");
      if (dot < 0 || !SEARCHABLE_EXT.has(e.name.slice(dot))) continue;
      if (isSensitivePath(e.name)) continue;

      let content: string;
      try {
        const s = await stat(abs);
        if (s.size > MAX_FILE_SIZE) continue;
        content = await readFile(abs, "utf8");
      } catch {
        continue;
      }

      const rel = relative(cwd, abs);

      // Which packages this file imports — resolves the bare-identifier gate
      // (`__requiresImport:<pkg>`) for probes in this same file, so the file
      // is read exactly once.
      const importsHere = new Set<string>();
      for (const m of content.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)) {
        importsHere.add(m[1]);
      }

      const lines = content.split("\n");
      for (const { probe, re } of compiled) {
        if ((probeHitsCount.get(probe.key) ?? 0) >= opts.perProbeCap) {
          truncatedProbes.add(probe.key);
          continue;
        }

        // File-level gates: substring filter, or import scope for bare identifiers.
        if (probe.fileFilter) {
          if (probe.fileFilter.startsWith(REQUIRES_IMPORT_PREFIX)) {
            const pkg = probe.fileFilter.slice(REQUIRES_IMPORT_PREFIX.length);
            if (!importsHere.has(pkg)) continue;
          } else if (!rel.includes(probe.fileFilter)) {
            continue;
          }
        }

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          re.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = re.exec(line)) !== null) {
            hits.push({
              probeKey: probe.key,
              file: rel,
              line: i + 1,
              excerpt: line.trim().slice(0, 200),
            });
            const n = (probeHitsCount.get(probe.key) ?? 0) + 1;
            probeHitsCount.set(probe.key, n);
            if (n >= opts.perProbeCap) {
              truncatedProbes.add(probe.key);
              break;
            }
            // Zero-width match guard — otherwise exec() would never advance.
            if (match.index === re.lastIndex) re.lastIndex++;
          }
          if ((probeHitsCount.get(probe.key) ?? 0) >= opts.perProbeCap) break;
        }
      }
    }
  }

  await walk(cwd);

  return { hits, truncatedProbes };
}
