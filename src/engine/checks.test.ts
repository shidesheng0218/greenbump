import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runChecks } from "./checks.js";

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-checks-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writePkg(dir: string, scripts: Record<string, string>): Promise<void> {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "tmp", version: "1.0.0", scripts }),
    "utf8",
  );
}

test("runChecks: unverifiable when the adapter has no build or test script", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, {});
    const r = await runChecks("npm", dir);
    assert.equal(r.unverifiable, true);
    assert.equal(r.ok, true);
  });
});

test("runChecks: ok when build and test scripts both succeed", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(0)\"", test: "node -e \"process.exit(0)\"" });
    const r = await runChecks("npm", dir);
    assert.equal(r.ok, true);
    assert.equal(r.unverifiable, false);
    assert.equal(r.failedStep, undefined);
  });
});

test("runChecks: stops at build failure without running test", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, {
      build: "node -e \"console.error('boom'); process.exit(1)\"",
      test: "node -e \"require('fs').writeFileSync('ran-test','1')\"",
    });
    const r = await runChecks("npm", dir);
    assert.equal(r.ok, false);
    assert.equal(r.failedStep, "build");
    assert.match(r.output, /boom/);
    await assert.rejects(async () => {
      const { stat } = await import("node:fs/promises");
      await stat(join(dir, "ran-test"));
    });
  });
});

test("runChecks: build passes, test fails — reports test as the failed step", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, {
      build: "node -e \"process.exit(0)\"",
      test: "node -e \"console.error('test failed'); process.exit(1)\"",
    });
    const r = await runChecks("npm", dir);
    assert.equal(r.ok, false);
    assert.equal(r.failedStep, "test");
    assert.match(r.output, /test failed/);
  });
});

test("runChecks: --build-cmd/--test-cmd overrides win over the adapter's own scripts", async () => {
  await withTmpDir(async (dir) => {
    await writePkg(dir, { build: "node -e \"process.exit(1)\"" });
    const r = await runChecks("npm", dir, { buildCmd: "node -e \"process.exit(0)\"" });
    assert.equal(r.ok, true);
    assert.equal(r.unverifiable, false);
  });
});

test("runChecks: truncates output that exceeds the max size, keeping the tail", async () => {
  await withTmpDir(async (dir) => {
    // Write >16_000 chars of stdout before failing, then check only the end survives.
    // Use process.exitCode (not process.exit()) so Node drains stdout before exiting —
    // stdout writes to a pipe are asynchronous, and a forced process.exit() right after
    // thousands of console.log calls can truncate the buffer before it's flushed. That
    // race is invisible on a local TTY but reliably bites in CI's piped, headless stdio.
    const script =
      "for (let i = 0; i < 2000; i++) console.log('line-' + i); console.error('MARKER_END'); process.exitCode = 1;";
    await writePkg(dir, { build: `node -e "${script.replace(/"/g, '\\"')}"` });
    const r = await runChecks("npm", dir);
    assert.equal(r.ok, false);
    assert.match(r.output, /MARKER_END/);
    assert.ok(r.output.length <= 16_000 + 50);
    assert.doesNotMatch(r.output, /line-0\b/);
  });
});
