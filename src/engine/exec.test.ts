import { test } from "node:test";
import assert from "node:assert/strict";
import { exec } from "./exec.js";

test("exec: captures output and exit code without rejecting", async () => {
  const r = await exec("node", ["-e", "console.log('hi'); process.exit(3)"], { cwd: process.cwd() });
  assert.equal(r.code, 3);
  assert.equal(r.stdout.trim(), "hi");
});

test("exec: output is capped and keeps the tail", async () => {
  // Print ~3MB: 3000 numbered lines of 1000 chars
  const r = await exec(
    "node",
    ["-e", "for (let i = 0; i < 3000; i++) console.log(String(i).padStart(6, '0') + 'x'.repeat(1000))"],
    { cwd: process.cwd() },
  );
  assert.equal(r.code, 0);
  assert.ok(r.stdout.length <= 1_000_100, `expected bounded output, got ${r.stdout.length}`);
  assert.ok(r.stdout.includes("output truncated"), "truncation marker present");
  assert.ok(r.stdout.includes("002999"), "tail preserved");
  assert.ok(!r.stdout.includes("000000x"), "head dropped");
});

test("exec: timeout kills the process and reports the timeout", async () => {
  const start = Date.now();
  const r = await exec("node", ["-e", "setTimeout(() => {}, 60000)"], { cwd: process.cwd(), timeout: 200 });
  assert.notEqual(r.code, 0);
  assert.ok(r.combined.includes("timed out"));
  assert.ok(Date.now() - start < 5000);
});

test("exec: timeout kills child process group tree", async () => {
  // Spawn a parent node script that spawns a long-lived child
  const script = `
    const { spawn } = require('child_process');
    spawn('node', ['-e', 'setInterval(() => {}, 1000)']);
    setInterval(() => {}, 1000);
  `;
  const r = await exec("node", ["-e", script], { cwd: process.cwd(), timeout: 300 });
  assert.notEqual(r.code, 0);
  assert.ok(r.combined.includes("timed out"));
});
