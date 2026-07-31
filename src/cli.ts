#!/usr/bin/env node
import { Command } from "commander";
import pc from "picocolors";
import { resolve } from "node:path";
import { run, RunError } from "./engine/run.js";
import { renderPrBody } from "./pr.js";
import { hasAnyKey, listProviders } from "./agent/factory.js";
import { formatDuration, printSummaryBox } from "./format.js";
import { listEcosystems } from "./engine/ecosystems/index.js";

const program = new Command();

program
  .name("greenbump")
  .description(
    "Upgrade a dependency and let an AI agent fix the code it breaks — until build + tests are green.",
  )
  .argument("[dep]", "dependency to upgrade (default: the most-outdated one)")
  .option("--cwd <path>", "project directory to operate on (default: current dir)")
  .option("--to <version>", "target version (default: latest)")
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
  .option("--no-git", "operate in place instead of creating a branch")
  .option("--pr-body", "print the PR body markdown after finishing")
  .action(async (dep, opts) => {
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

    const startedAt = Date.now();
    const log = (m: string) => {
      const elapsed = pc.dim(`[+${formatDuration(Date.now() - startedAt)}]`);
      console.error(`  ${elapsed} ${pc.dim(m)}`);
    };

    try {
      console.error(pc.bold(pc.green("🌱 greenbump")));
      const summary = await run({
        cwd: opts.cwd ? resolve(opts.cwd) : process.cwd(),
        dep,
        to: opts.to,
        ecosystem: opts.ecosystem,
        buildCmd: opts.buildCmd,
        testCmd: opts.testCmd,
        provider: opts.provider,
        model: opts.model,
        baseURL: opts.baseUrl,
        apiKey: opts.apiKey,
        maxRounds: parseInt(opts.maxRounds, 10),
        noGit: opts.git === false,
        onLog: log,
      });

      console.error("");
      printSummaryBox(summary, console.error);

      if (opts.prBody) {
        console.log("\n" + renderPrBody(summary));
      }

      process.exit(summary.neededFix && !summary.fixed ? 2 : 0);
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
