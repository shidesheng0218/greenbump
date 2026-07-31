import type { ExecResult } from "./exec.js";
import { ADAPTERS, getAdapter, detectEcosystem, type Outdated } from "./ecosystems/index.js";

/**
 * A package manager / dependency ecosystem id (npm, poetry, cargo, maven, …).
 * Kept as a plain string (rather than a literal union) so new ecosystems can
 * be added purely by registering an adapter, with no type changes needed
 * anywhere that threads this value through.
 */
export type PackageManager = string;

/** Detect which ecosystem this project uses; defaults to npm if nothing else matches. */
export async function detectPackageManager(cwd: string): Promise<PackageManager> {
  const adapter = await detectEcosystem(cwd);
  return adapter?.id ?? "npm";
}

export async function outdated(pm: PackageManager, cwd: string): Promise<Outdated[]> {
  return getAdapter(pm).outdated(cwd);
}

export async function install(
  pm: PackageManager,
  cwd: string,
  name: string,
  version: string,
): Promise<ExecResult> {
  return getAdapter(pm).install(cwd, name, version);
}

export { ADAPTERS, getAdapter, detectEcosystem };
export type { Outdated };
