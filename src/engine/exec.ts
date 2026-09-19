import { spawn } from "node:child_process";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  /** stdout + stderr interleaved as best we can, for feeding to the agent */
  combined: string;
}

export interface ExecOptions {
  cwd: string;
  /** milliseconds; kill the process if it runs longer */
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

/** Cap on captured output per stream — a runaway `npm test` must not eat all memory. Keeps the tail. */
const MAX_CAPTURE_CHARS = 1_000_000;
const TRUNCATION_MARKER = "[greenbump] output truncated (kept the last 1MB)\n";

/** Append `chunk` to `buf`, keeping at most MAX_CAPTURE_CHARS of tail. */
function cappedAppend(buf: string, chunk: string): string {
  const next = buf + chunk;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  // Drop the head (including any earlier marker) and re-prefix it once.
  const bodyBudget = MAX_CAPTURE_CHARS - TRUNCATION_MARKER.length;
  return TRUNCATION_MARKER + next.slice(next.length - bodyBudget);
}

/**
 * Run a command and capture its output. Never rejects on a non-zero exit —
 * callers inspect `code` themselves, because tools like `npm outdated` use
 * non-zero exits to signal "found something", not failure.
 */
export function exec(
  cmd: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    // detached: true on POSIX causes child to be leader of a new process group,
    // allowing us to SIGKILL the entire process tree on timeout.
    const isWindows = process.platform === "win32";
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
      detached: !isWindows,
    });

    let stdout = "";
    let stderr = "";
    let combined = "";

    child.stdout?.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout = cappedAppend(stdout, s);
      combined = cappedAppend(combined, s);
    });
    child.stderr?.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr = cappedAppend(stderr, s);
      combined = cappedAppend(combined, s);
    });

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        if (isWindows && child.pid) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]).on("error", () => {});
        } else if (child.pid) {
          try {
            // Kill entire process group
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          child.kill("SIGKILL");
        }
        combined += `\n[greenbump] command timed out after ${opts.timeout}ms\n`;
      }, opts.timeout);
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, combined });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      combined += `\n[greenbump] failed to spawn ${cmd}: ${err.message}\n`;
      resolve({ code: 1, stdout, stderr: String(err), combined });
    });
  });
}
