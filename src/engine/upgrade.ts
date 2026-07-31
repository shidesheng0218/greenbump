import { install, type PackageManager } from "./pm.js";

export interface UpgradeResult {
  ok: boolean;
  output: string;
}

/**
 * Install a specific version of a dependency, pinned exactly, so the
 * resulting PR is reproducible.
 */
export async function upgradeDependency(
  pm: PackageManager,
  cwd: string,
  name: string,
  version: string,
): Promise<UpgradeResult> {
  const r = await install(pm, cwd, name, version);
  return { ok: r.code === 0, output: r.combined };
}
