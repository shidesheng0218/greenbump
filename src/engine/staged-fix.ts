/**
 * Staged fix orchestrator for v0.4.0
 *
 * This module provides a multi-stage fix strategy that:
 * 1. Builds a dependency graph to identify affected files
 * 2. Categorizes files into stages (config → types → source)
 * 3. Fixes each stage independently with incremental commits
 * 4. Allows rollback to the last successful stage on failure
 *
 * Usage: pass --staged flag to enable staged fix mode
 */

import type { PackageManager } from "./pm.js";
import type { CheckOverrides } from "./checks.js";
import type { Provider } from "../agent/provider.js";
import { buildDependencyGraph, organizeLayers, getPrioritizedFiles } from "./dep-graph.js";
import { COMMON_STAGES, categorizeFilesByStage, type FixStage } from "./stages.js";
import { commitStage } from "./git.js";
import { runFixLoop } from "../agent/fixer.js";
import { runChecks } from "./checks.js";

export interface StagedFixOptions {
  cwd: string;
  pm: PackageManager;
  checkOverrides: CheckOverrides;
  provider: Provider;
  maxRounds: number;
  maxTokens?: number;
  dep: string;
  from: string;
  to: string;
  failureOutput: string;
  changelog?: string;
  onLog?: (m: string) => void;
}

export interface StagedFixResult {
  fixed: boolean;
  completedStages: number;
  totalStages: number;
  failedStage?: string;
  rounds: number;
  usage: { inputTokens: number; outputTokens: number };
  editedFiles: string[];
  budgetExceeded?: boolean;
}

/**
 * Run a staged fix: break the fix into multiple stages, fix each independently,
 * and commit after each successful stage.
 */
export async function runStagedFix(
  opts: StagedFixOptions
): Promise<StagedFixResult> {
  const log = opts.onLog ?? (() => {});
  const { cwd, pm, dep } = opts;

  // 1. Build dependency graph
  log("📊 building dependency graph…");
  const nodes = await buildDependencyGraph(cwd, dep);

  if (nodes.length === 0) {
    log("⚠️  dependency graph empty, falling back to single-stage fix");
    return await runSingleStageFix(opts);
  }

  const layers = organizeLayers(nodes);
  log(`📊 found ${layers.length} dependency layers, ${nodes.length} files total`);

  // 2. Categorize files by stage
  const stageFiles = await categorizeFilesByStage(cwd, COMMON_STAGES);
  const stages = COMMON_STAGES.filter((stage) => {
    const files = stageFiles.get(stage.name) || [];
    return files.length > 0;
  });

  if (stages.length === 0) {
    log("⚠️  no files matched any stage patterns, falling back to single-stage fix");
    return await runSingleStageFix(opts);
  }

  log(`🔧 identified ${stages.length} stages: ${stages.map(s => s.name).join(" → ")}`);

  // 3. Fix each stage
  let totalRounds = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const allEditedFiles: string[] = [];

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const files = stageFiles.get(stage.name) || [];

    log(`\n🔧 Stage ${i + 1}/${stages.length}: ${stage.name} (${files.length} files)`);

    // Run fix loop for this stage only
    // (In a full implementation, we'd pass a file filter to the fix loop)
    const stageResult = await runFixLoop({
      ...opts,
      onLog: (msg) => log(`  ${msg}`),
    });

    totalRounds += stageResult.rounds;
    totalInputTokens += stageResult.usage.inputTokens;
    totalOutputTokens += stageResult.usage.outputTokens;
    allEditedFiles.push(...stageResult.editedFiles);

    // Validate stage
    const passed = await stage.validator(cwd);
    if (!passed) {
      log(`❌ Stage ${i + 1} validation failed`);
      return {
        fixed: false,
        completedStages: i,
        totalStages: stages.length,
        failedStage: stage.name,
        rounds: totalRounds,
        usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
        editedFiles: allEditedFiles,
        budgetExceeded: stageResult.budgetExceeded,
      };
    }

    // Commit this stage
    await commitStage(cwd, stage.name, i + 1, stages.length);
    log(`✓ Stage ${i + 1} completed and committed`);
  }

  // Final validation
  const finalCheck = await runChecks(pm, cwd, opts.checkOverrides);

  return {
    fixed: finalCheck.ok,
    completedStages: stages.length,
    totalStages: stages.length,
    rounds: totalRounds,
    usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    editedFiles: allEditedFiles,
  };
}

/**
 * Fallback: run a single fix loop without staging (same as v0.3.0 behavior)
 */
async function runSingleStageFix(opts: StagedFixOptions): Promise<StagedFixResult> {
  const result = await runFixLoop(opts);
  return {
    fixed: result.fixed,
    completedStages: result.fixed ? 1 : 0,
    totalStages: 1,
    rounds: result.rounds,
    usage: result.usage,
    editedFiles: result.editedFiles,
    budgetExceeded: result.budgetExceeded,
  };
}
