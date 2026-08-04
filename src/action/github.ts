import { appendFileSync } from "node:fs";

/** Read a GitHub Action input from its INPUT_* env var (matching @actions/core). */
export function getInput(name: string): string {
  const key = `INPUT_${name.replace(/ /g, "_").toUpperCase()}`;
  return (process.env[key] ?? "").trim();
}

/** Write an Action output to $GITHUB_OUTPUT. */
export function setOutput(name: string, value: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  // multiline-safe heredoc format
  const delim = `ghadelimiter_${name}`;
  appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

export function info(msg: string): void {
  process.stdout.write(msg + "\n");
}

export function setFailed(msg: string): void {
  process.stdout.write(`::error::${msg}\n`);
  process.exitCode = 1;
}

export interface CreatePrArgs {
  token: string;
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  /** labels to attach after creation; GitHub auto-creates ones that don't exist yet */
  labels?: string[];
}

/** Create a PR via the REST API using Node's global fetch. Returns the PR URL, or null on failure. */
export async function createPullRequest(args: CreatePrArgs): Promise<string | null> {
  const res = await fetch(
    `https://api.github.com/repos/${args.owner}/${args.repo}/pulls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: args.title,
        body: args.body,
        head: args.head,
        base: args.base,
        draft: args.draft,
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    info(`::warning::could not open PR (${res.status}): ${text}`);
    return null;
  }
  const data = (await res.json()) as { html_url?: string; number?: number };
  info(`opened PR #${data.number}: ${data.html_url}`);

  if (args.labels?.length && data.number) {
    await addLabels(args, data.number, args.labels);
  }

  return data.html_url ?? null;
}

/** The "create PR" endpoint doesn't accept labels directly — attach them via a follow-up call. */
async function addLabels(
  args: Pick<CreatePrArgs, "token" | "owner" | "repo">,
  prNumber: number,
  labels: string[],
): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${args.owner}/${args.repo}/issues/${prNumber}/labels`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ labels }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    info(`::warning::could not add label(s) (${res.status}): ${text}`);
  }
}
