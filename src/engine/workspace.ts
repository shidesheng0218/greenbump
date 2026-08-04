import { join, relative } from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { pathExists, safeJson } from "./ecosystems/types.js";
import { getAdapter, type Outdated } from "./ecosystems/index.js";
import type { PackageManager } from "./pm.js";

export interface WorkspaceMember {
  /** repo-root-relative path, e.g. "packages/api" ("." never appears here — see WORKSPACE_ROOT) */
  path: string;
  name: string;
}

/** Sentinel workspacePath meaning "the repo root itself", distinct from any real member path. */
export const WORKSPACE_ROOT = ".";

interface PackageJsonShape {
  name?: string;
  workspaces?: string[] | { packages?: string[] };
}

async function readPackageJson(dir: string): Promise<PackageJsonShape | null> {
  try {
    const raw = await readFile(join(dir, "package.json"), "utf8");
    return safeJson<PackageJsonShape>(raw);
  } catch {
    return null;
  }
}

/**
 * Minimal `packages:` list reader for pnpm-workspace.yaml — no full YAML
 * parser dependency, just the one shape pnpm actually emits:
 *   packages:
 *     - "packages/*"
 *     - "apps/*"
 */
async function readPnpmWorkspaceGlobs(cwd: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, "pnpm-workspace.yaml"), "utf8");
  } catch {
    return [];
  }
  const globs: string[] = [];
  let inPackages = false;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (/^packages\s*:/.test(trimmed)) {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    const m = /^-\s*["']?([^"'#]+)["']?/.exec(trimmed);
    if (m) {
      globs.push(m[1].trim());
    } else if (trimmed && !trimmed.startsWith("#")) {
      // a non-list, non-comment line ends the packages block
      inPackages = false;
    }
  }
  return globs;
}

/** Expand a glob with at most one trailing `*` segment (e.g. "packages/*") into real subdirectories. */
async function expandGlob(cwd: string, glob: string): Promise<string[]> {
  const star = glob.indexOf("*");
  if (star === -1) {
    return (await pathExists(join(cwd, glob))) ? [glob] : [];
  }
  const base = glob.slice(0, star).replace(/\/$/, "");
  const baseDir = join(cwd, base);
  let entries: string[];
  try {
    entries = (await readdir(baseDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
  return entries.map((name) => (base ? `${base}/${name}` : name));
}

async function globsToMembers(cwd: string, globs: string[]): Promise<WorkspaceMember[]> {
  const members: WorkspaceMember[] = [];
  const seen = new Set<string>();
  for (const glob of globs) {
    for (const relPath of await expandGlob(cwd, glob)) {
      if (seen.has(relPath)) continue;
      const pkg = await readPackageJson(join(cwd, relPath));
      if (!pkg) continue; // not an actual package (e.g. an empty scaffold dir)
      seen.add(relPath);
      members.push({ path: relPath, name: pkg.name ?? relPath });
    }
  }
  return members;
}

/**
 * Detect workspace members for npm/yarn (`workspaces` field) or pnpm
 * (`pnpm-workspace.yaml`). Returns `[]` for non-monorepo projects — this is
 * intentionally JS-ecosystem-only; other ecosystems' own workspace/module
 * conventions (Cargo workspaces, Go modules, Gradle multi-project, …) are out
 * of scope for this pass.
 */
export async function detectWorkspaceMembers(cwd: string): Promise<WorkspaceMember[]> {
  const pnpmGlobs = await readPnpmWorkspaceGlobs(cwd);
  if (pnpmGlobs.length > 0) return globsToMembers(cwd, pnpmGlobs);

  const root = await readPackageJson(cwd);
  const raw = root?.workspaces;
  const globs = Array.isArray(raw) ? raw : raw?.packages ?? [];
  if (globs.length === 0) return [];
  return globsToMembers(cwd, globs);
}

export interface WorkspaceOutdated extends Outdated {
  /** WORKSPACE_ROOT for the repo root itself, else a member's relative path */
  workspacePath: string;
}

/**
 * Outdated deps across the repo root and every workspace member, flattened
 * into one list. Each entry is tagged with the package.json it came from so
 * batch/monorepo targets can disambiguate same-named deps at different
 * versions in different packages.
 */
export async function detectOutdatedAll(
  pm: PackageManager,
  cwd: string,
): Promise<WorkspaceOutdated[]> {
  const adapter = getAdapter(pm);
  const members = await detectWorkspaceMembers(cwd);

  const scopes: Array<{ workspacePath: string; dir: string }> = [
    { workspacePath: WORKSPACE_ROOT, dir: cwd },
    ...members.map((m) => ({ workspacePath: m.path, dir: join(cwd, m.path) })),
  ];

  const results: WorkspaceOutdated[] = [];
  for (const scope of scopes) {
    const outdated = await adapter.outdated(scope.dir);
    for (const o of outdated) {
      results.push({ ...o, workspacePath: scope.workspacePath });
    }
  }
  return results;
}

export class WorkspaceAmbiguityError extends Error {
  constructor(dep: string, candidates: WorkspaceOutdated[]) {
    const list = candidates
      .map((c) => `  - ${c.workspacePath === WORKSPACE_ROOT ? "(root)" : c.workspacePath}: ${c.current} → ${c.latest}`)
      .join("\n");
    super(
      `\`${dep}\` is outdated at different versions in multiple workspace packages — ` +
        `pass --workspace <path> to disambiguate:\n${list}`,
    );
  }
}

/**
 * Resolve a dependency name to exactly one (dep, workspace) target across
 * the flattened outdated list. Throws WorkspaceAmbiguityError if the name
 * appears in 2+ packages at different current versions and no `workspace`
 * hint was given; picks the matching one if `workspace` is given.
 */
export function resolveWorkspaceTarget(
  dep: string,
  candidates: WorkspaceOutdated[],
  workspace?: string,
): WorkspaceOutdated | undefined {
  const matches = candidates.filter((c) => c.name === dep);
  if (matches.length === 0) return undefined;
  if (workspace !== undefined) {
    return matches.find((c) => c.workspacePath === workspace || relative(workspace, c.workspacePath) === "");
  }
  const distinctVersions = new Set(matches.map((c) => c.current));
  if (matches.length > 1 && distinctVersions.size > 1) {
    throw new WorkspaceAmbiguityError(dep, matches);
  }
  return matches[0];
}
