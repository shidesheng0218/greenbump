import type { WorkspaceOutdated } from "../workspace.js";
import { detectForOutdated, type ScanDetection, type BreakingChangeImpact, type FileGroup } from "./detect.js";
import { scanOnce } from "./indexer.js";
import type { Probe } from "./probes.js";

/**
 * Orchestrates the deterministic impact analysis for --scan.
 *
 * Data flow:
 * 1. For each outdated dependency, collect search probes from codemods + changelog cache
 * 2. Scan the project once with all probes
 * 3. Assemble per-dependency impact reports
 */

export interface ScanReport {
  schemaVersion: 1;
  cwd: string;
  packageManager: string;
  summary: ScanSummary;
  detections: ScanDetection[];
}

export interface ScanSummary {
  depsScanned: number;
  depsWithKnownBreaking: number;
  filesAffected: number;
  locationsAffected: number;
  truncated: boolean;
}

export interface ScanOptions {
  noCache?: boolean;
  maxPerChange?: number;
  maxPerFile?: number;
}

export async function buildScanReport(
  cwd: string,
  outdated: WorkspaceOutdated[],
  opts: ScanOptions = {},
): Promise<ScanReport> {
  const maxPerChange = opts.maxPerChange ?? 200;

  // Phase 1: collect detections (probes) for all outdated deps
  const pendingDetections = await Promise.all(
    outdated.map((o) => detectForOutdated(cwd, o, opts.noCache ?? false)),
  );

  // Phase 2: collect all probes
  const allProbes: Probe[] = [];
  for (const detection of pendingDetections) {
    allProbes.push(...detection.probes);
  }

  // Phase 3: single-pass scan
  const { hits, truncatedProbes } = await scanOnce(cwd, allProbes, { perProbeCap: maxPerChange });

  // Phase 4: assemble report
  const detections: ScanDetection[] = pendingDetections.map((pending) => {
    // Group hits by change index
    const changeHits = new Map<number, typeof hits>();
    for (const hit of hits) {
      const probe = pending.probes.find((p) => p.key === hit.probeKey);
      if (!probe) continue;
      const changeIndex = probe.refs[0]?.changeIndex;
      if (changeIndex === undefined) continue;
      if (!changeHits.has(changeIndex)) {
        changeHits.set(changeIndex, []);
      }
      changeHits.get(changeIndex)!.push(hit);
    }

    // Build BreakingChangeImpact for each change
    const changes: BreakingChangeImpact[] = pending.changesMetadata.map((meta, idx) => {
      const changeHitsList = changeHits.get(idx) ?? [];
      const truncated = pending.probes
        .filter((p) => p.refs[0]?.changeIndex === idx)
        .some((p) => truncatedProbes.has(p.key));

      // Group by file
      const fileMap = new Map<string, typeof changeHitsList>();
      for (const hit of changeHitsList) {
        if (!fileMap.has(hit.file)) {
          fileMap.set(hit.file, []);
        }
        fileMap.get(hit.file)!.push(hit);
      }

      const fileGroups: FileGroup[] = Array.from(fileMap.entries()).map(([file, locations]) => ({
        file,
        locations: locations.map((l) => ({ file: l.file, line: l.line, excerpt: l.excerpt })),
        shown: Math.min(locations.length, 20),
        totalInFile: locations.length,
      }));

      const approx = pending.probes
        .filter((p) => p.refs[0]?.changeIndex === idx)
        .some((p) => p.approx);

      return {
        description: meta.description,
        oldApi: meta.oldApi,
        newApi: meta.newApi,
        severity: meta.severity,
        source: meta.source,
        rewrite: meta.rewrite,
        fileGroups,
        truncated,
        matches: changeHitsList.length,
        ...(approx ? { approx: true } : {}),
      };
    });

    // Calculate detection-level stats
    const allFiles = new Set<string>();
    let totalLocations = 0;
    for (const change of changes) {
      for (const fg of change.fileGroups) {
        allFiles.add(fg.file);
        totalLocations += fg.totalInFile;
      }
    }

    const hasApprox = changes.some((c) => c.approx);
    const status =
      pending.status === "unknown" || pending.status === "info-only"
        ? pending.status
        : hasApprox
          ? "approx"
          : "ok";

    return {
      name: pending.name,
      current: pending.current,
      latest: pending.latest,
      workspacePath: pending.workspacePath,
      kind: pending.kind,
      status,
      changes,
      ...(pending.fileCreations.length > 0 ? { fileCreations: pending.fileCreations } : {}),
      filesMatched: allFiles.size,
      locationsMatched: totalLocations,
      displayedImpact: changes.length > 0 && totalLocations > 0,
      truncated: pending.probes.some((p) => truncatedProbes.has(p.key)),
    };
  });

  // Summary stats
  const allAffectedFiles = new Set<string>();
  let totalLocationsAffected = 0;
  let depsWithKnownBreaking = 0;
  let anyTruncated = false;

  for (const d of detections) {
    if (d.status === "ok" || d.status === "approx") {
      depsWithKnownBreaking++;
      for (const change of d.changes) {
        for (const fg of change.fileGroups) {
          allAffectedFiles.add(fg.file);
          totalLocationsAffected += fg.totalInFile;
        }
      }
    }
    if (d.truncated) anyTruncated = true;
  }

  return {
    schemaVersion: 1,
    cwd,
    packageManager: "", // filled by caller
    summary: {
      depsScanned: outdated.length,
      depsWithKnownBreaking,
      filesAffected: allAffectedFiles.size,
      locationsAffected: totalLocationsAffected,
      truncated: anyTruncated,
    },
    detections,
  };
}
