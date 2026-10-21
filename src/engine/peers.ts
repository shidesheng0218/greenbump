import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchWithTimeout } from "./ecosystems/http.js";
import { satisfies, lowerBoundOfRange, parseVersion } from "./semver-lite.js";

/**
 * Peer-dependency co-upgrading.
 *
 * Some upgrades cannot succeed alone: `react-dom@19` declares
 * `peerDependencies: { react: "^19.0.0" }`, so upgrading only react-dom makes
 * `npm install` fail with ERESOLVE and greenbump never even reaches the fix
 * loop. The same applies to eslint + its plugins, @types/node + node, etc.
 *
 * This module reads the target version's peer requirements from the npm
 * registry and reports which ones the project would violate, plus the
 * smallest version that would satisfy each.
 */

const NPM_FAMILY = new Set(["npm", "yarn", "pnpm"]);

export interface PeerConflict {
  name: string;
  /** range declared by the package being upgraded, e.g. "^19.0.0" */
  required: string;
  /** the version the project currently has, or null if it is not a direct dep */
  current: string | null;
  /**
   * upgrade   — present but too old; a co-upgrade fixes it
   * missing   — required but not a direct dependency (npm may auto-install)
   * unknown   — present, but the range could not be narrowed to a version
   */
  resolution: "upgrade" | "missing" | "unknown";
  /** version to co-upgrade to, when resolution is "upgrade" */
  suggested?: string;
}

export interface PeerUpgrade {
  name: string;
  from: string;
  to: string;
}

/** Direct dependency versions declared in package.json (declared ranges stripped to x.y.z). */
export async function readDirectDeps(cwd: string): Promise<Record<string, string>> {
  let raw: string;
  try {
    raw = await readFile(join(cwd, "package.json"), "utf8");
  } catch {
    return {};
  }
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return {};
  }

  const out: Record<string, string> = {};
  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
    for (const [name, range] of Object.entries(pkg[field] ?? {})) {
      if (out[name]) continue;
      const concrete = lowerBoundOfRange(range) ?? range.replace(/^[\^~>=<\s]+/, "").trim();
      if (parseVersion(concrete)) out[name] = concrete;
    }
  }
  return out;
}

/** Fetch a specific version's peer requirements from the npm registry. */
export async function fetchPeerDependencies(
  packageName: string,
  version: string,
): Promise<{ required: Record<string, string>; optional: Set<string> } | null> {
  try {
    const res = await fetchWithTimeout(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}/${encodeURIComponent(version)}`,
      { headers: { Accept: "application/json" } },
      10_000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    const optional = new Set(
      Object.entries(data.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta?.optional)
        .map(([name]) => name),
    );
    return { required: data.peerDependencies ?? {}, optional };
  } catch {
    return null;
  }
}

/**
 * Pure conflict computation, split out from the registry call so it can be
 * tested without network access.
 */
export function computePeerConflicts(
  required: Record<string, string>,
  optional: Set<string>,
  direct: Record<string, string>,
): PeerConflict[] {
  const conflicts: PeerConflict[] = [];

  for (const [name, range] of Object.entries(required)) {
    if (optional.has(name)) continue;
    const current = direct[name] ?? null;

    if (current === null) {
      conflicts.push({ name, required: range, current: null, resolution: "missing" });
      continue;
    }
    if (satisfies(current, range)) continue;

    const suggested = lowerBoundOfRange(range);
    conflicts.push({
      name,
      required: range,
      current,
      resolution: suggested ? "upgrade" : "unknown",
      ...(suggested ? { suggested } : {}),
    });
  }

  return conflicts;
}

/**
 * Which of `packageName@version`'s peer requirements does this project
 * violate? Network failures degrade to an empty list — peer handling is an
 * optimization that unblocks upgrades, never a gate.
 */
export async function findPeerConflicts(
  cwd: string,
  pm: string,
  packageName: string,
  version: string,
): Promise<PeerConflict[]> {
  if (!NPM_FAMILY.has(pm)) return [];

  const peers = await fetchPeerDependencies(packageName, version);
  if (!peers) return [];

  const direct = await readDirectDeps(cwd);
  return computePeerConflicts(peers.required, peers.optional, direct);
}