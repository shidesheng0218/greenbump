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
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let combined = "";

    child.stdout.on("data", (d: Buffer) => {
      const s = d.toString();
      stdout += s;
      combined += s;
    });
    child.stderr.on("data", (d: Buffer) => {
      const s = d.toString();
      stderr += s;
      combined += s;
    });

    let timer: NodeJS.Timeout | undefined;
    if (opts.timeout) {
      timer = setTimeout(() => {
        child.kill("SIGKILL");
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
