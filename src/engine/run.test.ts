import { test } from "node:test";
import assert from "node:assert/strict";
import { computeNeedsReview, runEnhancedVerification } from "./run.js";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function withTmpProject(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-run-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Make the repo's own TypeScript resolvable inside a tmp project (npx tsc). */
async function linkTypescript(dir: string): Promise<void> {
  await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
  await symlink(
    join(repoRoot, "node_modules", "typescript"),
    join(dir, "node_modules", "typescript"),
    "dir",
  );
  await symlink(
    join("..", "typescript", "bin", "tsc"),
    join(dir, "node_modules", ".bin", "tsc"),
  );
}

test("runEnhancedVerification: TypeScript type errors become an actionable report", async () => {
  await withTmpProject(async (dir) => {
    await linkTypescript(dir);
    await mkdir(join(dir, "src"));
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      "utf8",
    );
    await writeFile(
      join(dir, "src", "index.ts"),
      `export function greet(name: string): string {\n  return name.toFixed(2);\n}\n`,
      "utf8",
    );

    const v = await runEnhancedVerification(dir, ["src/index.ts"]);

    assert.equal(v.hasIssues, true);
    assert.match(v.report, /TypeScript type errors/);
    assert.match(v.report, /error TS\d+/);
    assert.match(v.summary, /issue category/);
  });
});

test("runEnhancedVerification: clean project reports no issues", async () => {
  await withTmpProject(async (dir) => {
    await writeFile(join(dir, "index.js"), "console.log('ok');\n", "utf8");

    const v = await runEnhancedVerification(dir, []);

    assert.equal(v.hasIssues, false);
    assert.equal(v.summary, "clean");
  });
});

test("runEnhancedVerification: removed export after the fix is reported, new `any` is not", async () => {
  await withTmpProject(async (dir) => {
    await mkdir(join(dir, "src"));
    const before = `export function compute(a: number): number {\n  return a * 2;\n}\n`;
    await writeFile(join(dir, "src", "api.ts"), before, "utf8");
    await execFileP("git", ["init", "-q"], { cwd: dir });
    await execFileP("git", ["add", "-A"], { cwd: dir });
    await execFileP("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], {
      cwd: dir,
    });

    // The "fix" drops the export and silences the compiler with `any`.
    await writeFile(
      join(dir, "src", "api.ts"),
      `function compute(a: any): any {\n  return a * 2;\n}\n`,
      "utf8",
    );

    const v = await runEnhancedVerification(dir, ["src/api.ts"]);

    assert.equal(v.hasIssues, true);
    assert.match(v.report, /Public API surface changed/);
    assert.match(v.report, /`compute`/);
    // Type-loosening-to-any is a style signal for humans, not fed back to the agent.
    assert.doesNotMatch(v.report, /any annotation/);
  });
});

test("computeNeedsReview: unverifiable always needs review, regardless of anything else", () => {
  assert.equal(
    computeNeedsReview({ unverifiable: true, neededFix: false, fixed: true, testFilesTouched: [] }),
    true,
  );
});

test("computeNeedsReview: clean upgrade (no fix needed) never needs review", () => {
  assert.equal(
    computeNeedsReview({ unverifiable: false, neededFix: false, fixed: true, testFilesTouched: [] }),
    false,
  );
});

test("computeNeedsReview: fixed with a test file touched needs review", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: true,
      fixed: true,
      testFilesTouched: ["src/foo.test.ts"],
    }),
    true,
  );
});

test("computeNeedsReview: fixed with no test file touched does not need review", () => {
  assert.equal(
    computeNeedsReview({ unverifiable: false, neededFix: true, fixed: true, testFilesTouched: [] }),
    false,
  );
});

test("computeNeedsReview: fix loop failed (unfixed) never needs review — that's exit code 2's job, not 3's", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: true,
      fixed: false,
      testFilesTouched: ["src/foo.test.ts"],
    }),
    false,
  );
});

test("computeNeedsReview: budgetExceeded always needs review, even on a clean/no-fix-needed run", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: false,
      fixed: true,
      testFilesTouched: [],
      budgetExceeded: true,
    }),
    true,
  );
});

test("computeNeedsReview: budgetExceeded still needs review even when fixed with no test file touched", () => {
  assert.equal(
    computeNeedsReview({
      unverifiable: false,
      neededFix: true,
      fixed: true,
      testFilesTouched: [],
      budgetExceeded: true,
    }),
    true,
  );
});
