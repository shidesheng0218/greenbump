#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { resolve } from "node:path";
import { run, RunError } from "./engine/run.js";
import { runBatch } from "./engine/batch.js";
import { renderPrBody } from "./pr.js";
import { hasAnyKey, listProviders } from "./agent/factory.js";
import { formatDuration, printSummaryBox, printBatchSummary } from "./format.js";
import { listEcosystems } from "./engine/ecosystems/index.js";
import { exitCodeFor, overallExitCode } from "./exitcode.js";
import { buildReport, writeReport } from "./report.js";
import { detectOutdatedAll, WORKSPACE_ROOT } from "./engine/workspace.js";
import { detectPackageManager } from "./engine/pm.js";

const program = new Command();

program
  .name("greenbump")
  .description(
    "Upgrade a dependency and let an AI agent fix the code it breaks — until build + tests are green.",
  )
  .argument("[deps...]", "dependency name(s) to upgrade; omit with --all to auto-pick, or omit entirely for the most-outdated one")
  .option("--cwd <path>", "project directory to operate on (default: current dir)")
  .option("--to <version>", "target version (default: latest); only valid with a single dependency")
  .option("--ecosystem <id>", "dependency ecosystem (npm, poetry, cargo, maven, …); auto-detected if omitted")
  .option("--list-ecosystems", "list supported ecosystems and exit")
  .option("--build-cmd <cmd>", "override the build command, e.g. \"make build\"")
  .option("--test-cmd <cmd>", "override the test command, e.g. \"make test\"")
  .option("--provider <name>", "model provider preset (openai, anthropic, deepseek, groq, …)")
  .option("--model <model>", "model id for the fix agent (default: per provider)")
  .option("--base-url <url>", "custom OpenAI-compatible endpoint (or override a preset)")
  .option("--api-key <key>", "API key (default: read from the provider's env var)")
  .option("--list-providers", "list built-in provider presets and exit")
  .option("--max-rounds <n>", "max fix-loop rounds (caps token spend)", "15")
  .option("--max-tokens <n>", "hard cap on total tokens spent by the fix loop; stops and flags for review on overrun")
  .option("--no-git", "operate in place instead of creating a branch")
  .option("--pr-body", "print the PR body markdown after finishing")
  .option("--report-file <path>", "write a JSON report of the run(s) to this path")
  .option("--all", "upgrade every outdated dependency found")
  .option("--group <name>", "combine multiple deps named on the command line into one branch/PR")
  .option("--fail-fast", "abort a batch on the first hard failure instead of continuing")
  .option("--workspace <path>", "disambiguate a dep that's outdated at different versions in multiple workspace packages")
  .option("--scan", "list outdated dependencies without upgrading (read-only mode)")
  .action(async (deps, opts) => {
    if (opts.listProviders) {
      console.log("Built-in provider presets:\n" + listProviders());
      console.log("\nSet the matching env var (or pass --api-key), then run greenbump.");
      console.log("Any other OpenAI-compatible service: --base-url <url> --model <id> --api-key <key>");
      process.exit(0);
    }

    if (opts.listEcosystems) {
      console.log("Supported dependency ecosystems:\n" + listEcosystems());
      process.exit(0);
    }

    if (opts.scan) {
      const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
      const pm = opts.ecosystem || await detectPackageManager(cwd);
      if (!pm) {
        console.error(pc.red("✗ Could not detect package manager. Use --ecosystem to specify one."));
        process.exit(1);
      }
      const outdated = await detectOutdatedAll(pm, cwd);
      if (outdated.length === 0) {
        console.log(pc.green("✓ All dependencies are up to date."));
        process.exit(0);
      }
      console.log(pc.bold(`Found ${outdated.length} outdated dependencies:\n`));
      for (const o of outdated) {
        const loc = o.workspacePath === WORKSPACE_ROOT ? "(root)" : o.workspacePath;
        console.log(`  ${pc.cyan(o.name)} ${pc.dim(o.current)} → ${pc.green(o.latest)} ${pc.dim(`[${loc}]`)}`);
      }
      process.exit(0);
    }

    const choice = {
      provider: opts.provider,
      model: opts.model,
      baseURL: opts.baseUrl,
      apiKey: opts.apiKey,
    };
    if (!hasAnyKey(choice)) {
      console.error(
        pc.red("✗ No usable provider.") +
          " greenbump uses your own key (you pay for tokens). Set one, e.g.:",
      );
      console.error("  export DEEPSEEK_API_KEY=...          # uses DeepSeek");
      console.error("  export ANTHROPIC_API_KEY=sk-ant-...  # uses Claude");
      console.error("  export OPENAI_API_KEY=sk-...         # uses OpenAI");
      console.error("Run `greenbump --list-providers` to see all presets.");
      process.exit(1);
    }

    if (opts.all && deps.length > 0) {
      console.error(pc.red("✗ --all and an explicit dependency list are mutually exclusive."));
      process.exit(1);
    }
    if (opts.to && (opts.all || deps.length > 1)) {
      console.error(pc.red("✗ --to only makes sense with a single dependency."));
      process.exit(1);
    }

    const startedAt = Date.now();
    const log = (m: string) => {
      const elapsed = pc.dim(`[+${formatDuration(Date.now() - startedAt)}]`);
      console.error(`  ${elapsed} ${pc.dim(m)}`);
    };
    const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
    const baseOpts = {
      cwd,
      ecosystem: opts.ecosystem,
      buildCmd: opts.buildCmd,
      testCmd: opts.testCmd,
      provider: opts.provider,
      model: opts.model,
      baseURL: opts.baseUrl,
      apiKey: opts.apiKey,
      maxRounds: parseInt(opts.maxRounds, 10),
      maxTokens: opts.maxTokens ? parseInt(opts.maxTokens, 10) : undefined,
      noGit: opts.git === false,
      onLog: log,
    };

    const isBatch = opts.all || deps.length > 1;

    try {
      console.error(pc.bold(pc.green("🌱 greenbump")));

      if (isBatch) {
        const { results } = await runBatch({
          ...baseOpts,
          all: opts.all,
          deps: opts.all ? undefined : deps,
          group: opts.group,
          workspace: opts.workspace,
          failFast: opts.failFast,
        });

        console.error("");
        printBatchSummary(results, console.error);

        if (opts.reportFile) {
          await writeReport(opts.reportFile, buildReport(results));
        }

        process.exit(overallExitCode(results));
      }

      const summary = await run({
        ...baseOpts,
        dep: deps[0],
        to: opts.to,
      });

      console.error("");
      printSummaryBox(summary, console.error);

      if (opts.prBody) {
        console.log("\n" + renderPrBody(summary));
      }

      if (opts.reportFile) {
        await writeReport(opts.reportFile, buildReport([summary]));
      }

      process.exit(exitCodeFor(summary));
    } catch (err) {
      console.error("");
      if (err instanceof RunError) {
        console.error(pc.red(`✗ ${err.message}`));
      } else {
        console.error(pc.red(`✗ Unexpected error: ${(err as Error).message}`));
      }
      process.exit(1);
    }
  });

program.parseAsync();
