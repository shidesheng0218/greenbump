import type { EcosystemAdapter } from "./types.js";
import { npmAdapter } from "./npm.js";
import { yarnAdapter } from "./yarn.js";
import { pnpmAdapter } from "./pnpm.js";
import { pipAdapter } from "./pip.js";
import { poetryAdapter } from "./poetry.js";
import { uvAdapter } from "./uv.js";
import { pipenvAdapter } from "./pipenv.js";
import { cargoAdapter } from "./cargo.js";
import { goAdapter } from "./go.js";
import { bundlerAdapter } from "./bundler.js";
import { composerAdapter } from "./composer.js";
import { mavenAdapter } from "./maven.js";
import { gradleAdapter } from "./gradle.js";
import { nugetAdapter } from "./nuget.js";
import { mixAdapter } from "./mix.js";
import { pubAdapter } from "./pub.js";
import { swiftpmAdapter } from "./swiftpm.js";
import { cocoapodsAdapter } from "./cocoapods.js";
import { conanAdapter } from "./conan.js";
import { elmAdapter } from "./elm.js";

export type { EcosystemAdapter, Outdated, CheckCommand, CheckCommands } from "./types.js";

/**
 * Detection order matters: within one language, lockfile-specific tools
 * (pnpm/yarn/poetry/uv/pipenv/…) must be checked before their more generic
 * sibling (npm/pip) so a project using e.g. poetry.lock doesn't fall through
 * to a bare pip read.
 */
export const ADAPTERS: EcosystemAdapter[] = [
  pnpmAdapter,
  yarnAdapter,
  npmAdapter,
  uvAdapter,
  poetryAdapter,
  pipenvAdapter,
  pipAdapter,
  cargoAdapter,
  goAdapter,
  bundlerAdapter,
  composerAdapter,
  gradleAdapter,
  mavenAdapter,
  nugetAdapter,
  mixAdapter,
  pubAdapter,
  swiftpmAdapter,
  cocoapodsAdapter,
  conanAdapter,
  elmAdapter,
];

export function getAdapter(id: string): EcosystemAdapter {
  const found = ADAPTERS.find((a) => a.id === id);
  if (!found) {
    throw new Error(`Unknown ecosystem "${id}". Available: ${ADAPTERS.map((a) => a.id).join(", ")}`);
  }
  return found;
}

/** Detect which ecosystem(s) this project uses; returns the first match in priority order. */
export async function detectEcosystem(cwd: string): Promise<EcosystemAdapter | undefined> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(cwd)) return adapter;
  }
  return undefined;
}

export function listEcosystems(): string {
  return ADAPTERS.map((a) => `${a.id.padEnd(12)} ${a.displayName}${a.verified ? "" : "  (docs-only, unverified)"}`).join(
    "\n",
  );
}
