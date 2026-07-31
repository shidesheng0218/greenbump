import { run, RunError } from "../engine/run.js";
import { renderPrBody } from "../pr.js";
import { exec } from "../engine/exec.js";
import {
  getInput,
  setOutput,
  info,
  setFailed,
  createPullRequest,
} from "./github.js";

async function main(): Promise<void> {
  // Map action inputs onto the env vars the provider factory reads.
  const anthropicKey = getInput("anthropic-api-key") || process.env.ANTHROPIC_API_KEY || "";
  const deepseekKey = getInput("deepseek-api-key") || process.env.DEEPSEEK_API_KEY || "";
  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;
  if (deepseekKey) process.env.DEEPSEEK_API_KEY = deepseekKey;
  const token = getInput("github-token") || process.env.GITHUB_TOKEN || "";

  if (!anthropicKey && !deepseekKey) {
    setFailed("an API key is required: set anthropic-api-key or deepseek-api-key (you pay for tokens).");
    return;
  }
  if (!token) {
    setFailed("github-token is required to push a branch and open a PR.");
    return;
  }

  const cwd = process.cwd();
  const repoSlug = process.env.GITHUB_REPOSITORY ?? "";
  const [owner, repo] = repoSlug.split("/");
  const base = getInput("base-branch") || process.env.GITHUB_REF_NAME || "main";

  let summary;
  try {
    summary = await run({
      cwd,
      dep: getInput("dependency") || undefined,
      to: getInput("to") || undefined,
      ecosystem: getInput("ecosystem") || undefined,
      buildCmd: getInput("build-cmd") || undefined,
      testCmd: getInput("test-cmd") || undefined,
      provider: getInput("provider") || undefined,
      model: getInput("model") || undefined,
      baseURL: getInput("base-url") || undefined,
      apiKey: getInput("api-key") || undefined,
      maxRounds: parseInt(getInput("max-rounds") || "15", 10),
      onLog: info,
    });
  } catch (err) {
    if (err instanceof RunError) {
      info(`nothing to do: ${err.message}`);
      setOutput("status", "skipped");
      return;
    }
    setFailed(`greenbump failed: ${(err as Error).message}`);
    return;
  }

  setOutput("dependency", summary.dep);
  setOutput("from", summary.from);
  setOutput("to", summary.to);
  setOutput("fixed", String(summary.fixed));

  if (!summary.committed || !summary.branch) {
    info("no committable changes produced — not opening a PR.");
    setOutput("status", summary.fixed ? "no-changes" : "unfixed");
    return;
  }

  // configure a bot identity and push the branch
  await exec("git", ["config", "user.name", "greenbump[bot]"], { cwd });
  await exec("git", ["config", "user.email", "greenbump@users.noreply.github.com"], { cwd });
  const remote = `https://x-access-token:${token}@github.com/${repoSlug}.git`;
  const push = await exec("git", ["push", "--force", remote, `HEAD:${summary.branch}`], { cwd });
  if (push.code !== 0) {
    setFailed(`failed to push branch:\n${push.combined}`);
    return;
  }

  const needsReview = summary.unverifiable || (summary.neededFix && !summary.fixed);
  const title = `chore(deps): bump ${summary.dep} ${summary.from} → ${summary.to}`;
  const url = await createPullRequest({
    token,
    owner,
    repo,
    head: summary.branch,
    base,
    title,
    body: renderPrBody(summary),
    draft: needsReview,
  });

  setOutput("pr-url", url ?? "");
  setOutput("status", needsReview ? "pr-needs-review" : "pr-opened");
  info(needsReview ? "opened a draft PR for review." : "opened a PR — build + tests green.");
}

main().catch((err) => setFailed(`unexpected: ${(err as Error).message}`));
