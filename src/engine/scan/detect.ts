import type { WorkspaceOutdated } from "../workspace.js";
import { readDigestFromCache } from "../analyzers/changelog-parser.js";
import { codemodsForUpgrade, probesFromCodemod, probesFromChange, type Probe } from "./probes.js";
import type { Codemod } from "../fixer/patterns.js";

/**
 * Generate detection metadata for a single outdated dependency.
 *
 * Collects probes from two sources:
 * - Tier A: built-in codemods (zero IO, always available)
 * - Tier B: changelog digest cache (read-only, no LLM calls)
 */
export async function detectForOutdated(
  cwd: string,
  o: WorkspaceOutdated,
  noCache: boolean,
): Promise<PendingDetection> {
  const codemods = codemodsForUpgrade(o.name, o.current, o.latest);
  const digest = noCache ? null : await readDigestFromCache(o.name, o.current, o.latest);

  const probes: Probe[] = [];
  const changesMetadata: ChangeMetadata[] = [];
  const fileCreations: Array<{ path: string; note: string }> = [];

  let changeIndex = 0;

  // Tier A: codemods
  for (const codemod of codemods) {
    if (codemod.transform) {
      const codemodProbes = probesFromCodemod(codemod, o.name, changeIndex);
      probes.push(...codemodProbes);
      changesMetadata.push({
        description: codemod.description,
        oldApi: codemod.transform.find,
        newApi: codemod.transform.replace,
        severity: "high", // codemods are known breakages
        source: "builtin-codemod",
        rewrite: codemod.transform.replace,
      });
    }
    if (codemod.creates) {
      for (const create of codemod.creates) {
        fileCreations.push({
          path: create.path,
          note: `will be created by codemod: ${codemod.description}`,
        });
      }
    }
    if (!codemod.transform && !codemod.creates) {
      // Guidance-only codemod
      changesMetadata.push({
        description: codemod.description,
        oldApi: "",
        severity: "medium",
        source: "builtin-codemod",
      });
    }
    changeIndex++;
  }

  // Tier B: changelog digest
  if (digest && digest.length > 0) {
    for (const change of digest) {
      const changeProbes = probesFromChange(change, o.name, changeIndex);
      probes.push(...changeProbes);
      changesMetadata.push({
        description: change.description,
        oldApi: change.oldApi,
        newApi: change.newApi,
        severity: change.severity,
        source: "changelog-cache",
      });
      changeIndex++;
    }
  }

  // Determine status
  let status: ScanDetection["status"];
  let kind: ScanDetection["kind"];
  if (codemods.length > 0 && digest && digest.length > 0) {
    kind = "both";
    status = "ok";
  } else if (codemods.length > 0) {
    kind = "codemod";
    status = codemods.some((c) => c.transform || c.creates) ? "ok" : "info-only";
  } else if (digest && digest.length > 0) {
    kind = "digest";
    status = "ok";
  } else {
    kind = "codemod";
    status = "unknown";
  }

  return {
    name: o.name,
    current: o.current,
    latest: o.latest,
    workspacePath: o.workspacePath,
    kind,
    status,
    probes,
    changesMetadata,
    fileCreations,
  };
}

export interface ChangeMetadata {
  description: string;
  oldApi: string;
  newApi?: string;
  severity: "low" | "medium" | "high";
  source: "changelog-cache" | "builtin-codemod";
  rewrite?: string;
}

export interface PendingDetection {
  name: string;
  current: string;
  latest: string;
  workspacePath: string;
  kind: "codemod" | "digest" | "both";
  status: "ok" | "approx" | "unknown" | "info-only";
  probes: Probe[];
  changesMetadata: ChangeMetadata[];
  fileCreations: Array<{ path: string; note: string }>;
}

export interface ScanDetection {
  name: string;
  current: string;
  latest: string;
  workspacePath: string;
  kind: "codemod" | "digest" | "both";
  status: "ok" | "approx" | "unknown" | "info-only";
  changes: BreakingChangeImpact[];
  fileCreations?: Array<{ path: string; note: string }>;
  filesMatched: number;
  locationsMatched: number;
  displayedImpact: boolean;
  truncated: boolean;
}

export interface BreakingChangeImpact {
  description: string;
  oldApi: string;
  newApi?: string;
  severity: "low" | "medium" | "high";
  source: "changelog-cache" | "builtin-codemod";
  rewrite?: string;
  fileGroups: FileGroup[];
  truncated: boolean;
  matches: number;
  approx?: boolean;
}

export interface FileGroup {
  file: string;
  locations: CodeLocation[];
  shown: number;
  totalInFile: number;
}

export interface CodeLocation {
  file: string;
  line: number;
  excerpt: string;
}
