import { outdated, type PackageManager } from "./pm.js";
import type { Outdated } from "./ecosystems/index.js";

export type { Outdated };

export async function detectOutdated(pm: PackageManager, cwd: string): Promise<Outdated[]> {
  return outdated(pm, cwd);
}
