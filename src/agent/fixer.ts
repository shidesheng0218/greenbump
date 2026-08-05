import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { resolve, relative, isAbsolute, join } from "node:path";
import { runChecks, type CheckOverrides } from "../engine/checks.js";
import { getAdapter, type PackageManager } from "../engine/pm.js";
import type { Msg, Provider, ToolSpec, TurnResult } from "./provider.js";

export interface FixResult {
  fixed: boolean;
  rounds: number;
  unverifiable: boolean;
  usage: { inputTokens: number; outputTokens: number };
  editedFiles: string[];
  /** true when the loop stopped early because it hit `maxTokens`, not because it ran out of rounds */
  budgetExceeded: boolean;
}

export interface FixDep {
  dep: string;
  from: string;
  to: string;
  changelog?: string | null;
}

export interface FixOptions {
  cwd: string;
  pm: PackageManager;
  checkOverrides?: CheckOverrides;
  provider: Provider;
  maxRounds: number;
  /** hard cap on total (input + output) tokens spent across the whole loop; unset = no cap */
  maxTokens?: number;
  /** name of the upgraded dependency */
  dep: string;
  from: string;
  to: string;
  /**
   * Set for a `--group` run covering multiple dependencies at once — used
   * INSTEAD of the singular dep/from/to/changelog fields above when present.
   * The singular fields stay populated too (as the first entry) so existing
   * single-dep call sites and tests are unaffected.
   */
  deps?: FixDep[];
  /** the failing build/test output that triggered the fix */
  failureOutput: string;
  /** release notes / changelog for the target version, if we found any */
  changelog?: string | null;
  onLog?: (msg: string) => void;
}

function buildSystemPrompt(pm: PackageManager, deps?: FixDep[]): string {
  const adapter = getAdapter(pm);
  const protectedFiles = [...adapter.manifestFiles, ...adapter.lockFiles].join(", ");
  const upgradeLine =
    deps && deps.length > 1
      ? `${deps.length} dependencies were just upgraded together and it broke the build or tests:\n${deps
          .map((d) => `- ${d.dep} ${d.from} → ${d.to}`)
          .join("\n")}`
      : "A dependency was just upgraded and it broke the build or tests.";
  return `You are greenbump's fix agent. ${upgradeLine}
Your job: edit the project's source code so that build and tests pass again — WITHOUT downgrading any dependency and WITHOUT weakening or deleting tests to make them pass.

Rules:
- Make the smallest correct change that adapts the code to the new version's API.
- Prefer following each dependency's documented migration path (renamed exports, changed signatures, moved modules, new required options). If release notes are provided below, treat them as authoritative over guessing.
- Use search_code to find ALL call sites of the breaking API across the repo before editing — a partial fix that leaves other files broken wastes rounds.
- Never edit ${protectedFiles}. The upgrade is intentional.
- Never delete or trivially rewrite a test just to make it green. Fix the real cause.
- Use run_check to verify. When run_check reports ok, you are done — stop.
- You have a limited number of rounds. If you're running low, prioritize verifying your current fix over continuing to explore.
- Work efficiently: read only the files you need.`;
}

const tools: ToolSpec[] = [
  {
    name: "list_dir",
    description: "List files and subdirectories at a project-relative path.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "project-relative dir, '.' for root" } },
      required: ["path"],
    },
  },
  {
    name: "search_code",
    description:
      "Search the repo's source files for a literal string or regex (case-insensitive substring match per line). Use this to find every call site of a breaking API before editing.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "text or regex to search for" },
        path: { type: "string", description: "project-relative dir to search under (default: '.')" },
      },
      required: ["query"],
    },
  },
  {
    name: "read_file",
    description: "Read a project-relative file's contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Overwrite a project-relative file with new contents.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "run_check",
    description: "Run build + tests. Returns whether they pass and any failure output.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

/** Resolve a project-relative path and refuse anything escaping cwd. */
function safePath(cwd: string, p: string): string {
  const abs = isAbsolute(p) ? p : resolve(cwd, p);
  const rel = relative(cwd, abs);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error(`path escapes project root: ${p}`);
  }
  return abs;
}

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage", ".turbo"]);
const SEARCHABLE_EXT = new Set([
  ".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
  ".json", ".vue", ".svelte", ".md", ".yml", ".yaml",
]);
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_FILE_SIZE = 1_000_000;

async function searchCode(cwd: string, root: string, query: string): Promise<string> {
  let re: RegExp;
  try {
    re = new RegExp(query, "i");
  } catch {
    re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }

  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    if (results.length >= MAX_SEARCH_RESULTS) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (results.length >= MAX_SEARCH_RESULTS) return;
      if (IGNORE_DIRS.has(e.name)) continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      const dot = e.name.lastIndexOf(".");
      if (dot < 0 || !SEARCHABLE_EXT.has(e.name.slice(dot))) continue;
      let s;
      try {
        s = await stat(abs);
      } catch {
        continue;
      }
      if (s.size > MAX_SEARCH_FILE_SIZE) continue;
      let content: string;
      try {
        content = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const rel = relative(cwd, abs);
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          if (results.length >= MAX_SEARCH_RESULTS) break;
        }
      }
    }
  }
  await walk(safePath(cwd, root));
  if (results.length === 0) return "(no matches)";
  const suffix = results.length >= MAX_SEARCH_RESULTS ? "\n...(truncated, refine your query)" : "";
  return results.join("\n") + suffix;
}

async function toolResult(
  cwd: string,
  pm: PackageManager,
  checkOverrides: CheckOverrides | undefined,
  name: string,
  input: any,
): Promise<{ text: string; checkOk?: boolean }> {
  switch (name) {
    case "list_dir": {
      const abs = safePath(cwd, input.path ?? ".");
      const entries = await readdir(abs, { withFileTypes: true });
      const lines = entries
        .filter((e) => !IGNORE_DIRS.has(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return { text: lines.join("\n") || "(empty)" };
    }
    case "search_code": {
      const text = await searchCode(cwd, input.path ?? ".", input.query);
      return { text };
    }
    case "read_file": {
      const abs = safePath(cwd, input.path);
      const s = await stat(abs);
      if (s.size > 200_000) return { text: "(file too large to read)" };
      return { text: await readFile(abs, "utf8") };
    }
    case "write_file": {
      const abs = safePath(cwd, input.path);
      await writeFile(abs, input.content, "utf8");
      return { text: `wrote ${input.path}` };
    }
    case "run_check": {
      const r = await runChecks(pm, cwd, checkOverrides);
      if (r.ok) return { text: "PASS: build and tests are green.", checkOk: true };
      return {
        text: `FAIL (${r.failedStep}):\n${r.output}`,
        checkOk: false,
      };
    }
    default:
      return { text: `unknown tool ${name}` };
  }
}

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1_000;

function isRetryable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /connection error|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network|429|500|502|503|504/i.test(msg);
}

/** Call the provider with retry/backoff for transient network or server errors. */
async function sendWithRetry(
  provider: Provider,
  system: string,
  messages: Msg[],
  toolSpecs: ToolSpec[],
  log: (m: string) => void,
): Promise<TurnResult> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await provider.send(system, messages, toolSpecs);
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES || !isRetryable(err)) throw err;
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      log(`provider request failed (${(err as Error).message}) — retrying in ${delay}ms (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function runFixLoop(opts: FixOptions): Promise<FixResult> {
  const { provider, pm, checkOverrides } = opts;
  const log = opts.onLog ?? (() => {});
  const usage = { inputTokens: 0, outputTokens: 0 };
  const editedFiles = new Set<string>();
  const SYSTEM = buildSystemPrompt(pm, opts.deps);

  const upgradeSummary =
    opts.deps && opts.deps.length > 1
      ? opts.deps.map((d) => `\`${d.dep}\` from ${d.from} to ${d.to}`).join(", ")
      : `\`${opts.dep}\` from ${opts.from} to ${opts.to}`;
  const changelogBlock = opts.deps && opts.deps.length > 1
    ? opts.deps
        .filter((d) => d.changelog)
        .map((d) => `\n\nRelease notes for ${d.dep}@${d.to}:\n\n${d.changelog}`)
        .join("")
    : opts.changelog
      ? `\n\nHere are the release notes for ${opts.dep}@${opts.to} — use them to find the correct migration:\n\n${opts.changelog}`
      : "";

  const messages: Msg[] = [
    {
      role: "user",
      text: `The dependenc${opts.deps && opts.deps.length > 1 ? "ies" : "y"} ${upgradeSummary} ${opts.deps && opts.deps.length > 1 ? "were" : "was"} upgraded.
This broke the project. Here is the failing output:

\`\`\`
${opts.failureOutput}
\`\`\`${changelogBlock}

Fix the source code so build and tests pass. Call run_check to verify before finishing.`,
    },
  ];

  let fixed = false;
  let budgetExceeded = false;
  let round = 0;

  for (round = 1; round <= opts.maxRounds; round++) {
    const remaining = opts.maxRounds - round + 1;
    const system = remaining <= 2 ? `${SYSTEM}\n\nYou have ${remaining} round(s) left. Wrap up and verify now.` : SYSTEM;

    const turn = await sendWithRetry(provider, system, messages, tools, log);
    usage.inputTokens += turn.usage.inputTokens;
    usage.outputTokens += turn.usage.outputTokens;

    messages.push({ role: "assistant", text: turn.text, toolCalls: turn.toolCalls });

    if (opts.maxTokens !== undefined && usage.inputTokens + usage.outputTokens >= opts.maxTokens) {
      log(
        `round ${round}: hit token budget (${usage.inputTokens + usage.outputTokens}/${opts.maxTokens}) — stopping without a final fix, flagging for review`,
      );
      budgetExceeded = true;
      break;
    }

    if (turn.toolCalls.length === 0) {
      // Model stopped without a tool call — verify once and finish.
      const r = await runChecks(pm, opts.cwd, checkOverrides);
      fixed = r.ok;
      log(`round ${round}: agent stopped, final check ${r.ok ? "PASS" : "FAIL"}`);
      break;
    }

    const results = [];
    for (const tc of turn.toolCalls) {
      if (tc.name === "write_file") {
        editedFiles.add((tc.input as any).path);
      }
      let out: { text: string; checkOk?: boolean };
      try {
        out = await toolResult(opts.cwd, pm, checkOverrides, tc.name, tc.input);
      } catch (err) {
        out = { text: `error: ${(err as Error).message}` };
      }
      log(`round ${round}: ${tc.name} ${(tc.input as any).path ?? (tc.input as any).query ?? ""}`.trim());
      if (out.checkOk) fixed = true;
      results.push({
        id: tc.id,
        content: out.text,
        isError: out.text.startsWith("error:") || undefined,
      });
    }

    messages.push({ role: "tool", results });

    if (fixed) {
      log(`round ${round}: check passed — fixed`);
      break;
    }
  }

  return {
    fixed,
    // `round` overshoots by 1 when the for-loop exhausts naturally (its
    // increment runs once more before the loop condition fails) — clamp so
    // callers never see e.g. "16 rounds" for a --max-rounds 15 run.
    rounds: Math.min(round, opts.maxRounds),
    unverifiable: false,
    usage,
    editedFiles: [...editedFiles],
    budgetExceeded,
  };
}
