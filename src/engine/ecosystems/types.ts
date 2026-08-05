import type { ExecResult } from "../exec.js";

export interface Outdated {
  name: string;
  current: string;
  wanted: string;
  latest: string;
}

export interface CheckCommand {
  cmd: string;
  args: string[];
}

export interface CheckCommands {
  build?: CheckCommand;
  test?: CheckCommand;
}

/**
 * One dependency ecosystem (npm, poetry, cargo, maven, …). Adapters are
 * intentionally thin — they know how to detect themselves, list outdated
 * direct dependencies, pin-install one version, and guess a build/test
 * command. Everything else (git isolation, the fix loop, PR rendering)
 * is ecosystem-agnostic and lives above this layer.
 */
export interface EcosystemAdapter {
  /** stable id used on the CLI (`--ecosystem <id>`) and in RunSummary */
  id: string;
  displayName: string;
  /** dependency manifests the fix agent must never edit */
  manifestFiles: string[];
  /** lockfiles the fix agent must never edit; also used for detection */
  lockFiles: string[];
  /** true if this adapter's project type is present in cwd */
  detect(cwd: string): Promise<boolean>;
  outdated(cwd: string): Promise<Outdated[]>;
  install(cwd: string, name: string, version: string): Promise<ExecResult>;
  /** best-effort guess at how to build/test this project; either may be omitted */
  defaultCheckCommands(cwd: string): Promise<CheckCommands>;
  /**
   * Self-reported by the adapter's author: true means "I manually ran the
   * detect → outdated → install → build/test chain against a real project
   * on my own machine at least once." It is NOT re-checked by CI and is not
   * a guarantee — treat it as "implemented per official docs and given one
   * manual smoke test," not an automated verification badge. False means
   * "implemented per official docs only, never run against a real project."
   */
  verified: boolean;
}

export function safeJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    const { access } = await import("node:fs/promises");
    await access(p);
    return true;
  } catch {
    return false;
  }
}
