import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeApiChanges } from "./ast-analyzer.js";

async function withFile(
  content: string,
  before: string,
  fn: (result: Awaited<ReturnType<typeof analyzeApiChanges>>) => void,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ast-"));
  await writeFile(join(dir, "api.ts"), content, "utf8");
  try {
    const result = await analyzeApiChanges(dir, ["api.ts"], async () => before);
    fn(result);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("ast-analyzer: detects removed exported function", async () => {
  const before = `export function renderApp(el: Element): void {}
export function cleanup(): void {}
`;
  const after = `export function cleanup(): void {}
`;
  await withFile(after, before, (result) => {
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].kind, "export-removed");
    assert.equal(result.changes[0].symbol, "renderApp");
    assert.equal(result.hasCritical, false); // warning, not critical
  });
});

test("ast-analyzer: removed default export is critical", async () => {
  const before = `export default function App() { return null; }
`;
  const after = `function App() { return null; }
`;
  await withFile(after, before, (result) => {
    const removed = result.changes.find((c) => c.kind === "export-removed");
    assert.ok(removed);
    assert.equal(removed.severity, "critical");
    assert.equal(result.hasCritical, true);
  });
});

test("ast-analyzer: detects function signature changes", async () => {
  const before = `export function fetchData(url: string): Promise<Response> { throw 0; }
`;
  const after = `export function fetchData(url: string, opts: object): Promise<Response> { throw 0; }
`;
  await withFile(after, before, (result) => {
    const sig = result.changes.find((c) => c.kind === "signature-changed");
    assert.ok(sig);
    assert.equal(sig.symbol, "fetchData");
    assert.equal(sig.severity, "warning");
  });
});

test("ast-analyzer: unchanged exports produce no changes", async () => {
  const code = `export function stable(x: number): number { return x * 2; }
`;
  await withFile(code, code, (result) => {
    assert.equal(result.changes.length, 0);
    assert.equal(result.hasCritical, false);
  });
});

test("ast-analyzer: flags newly introduced any annotations", async () => {
  const before = `export function parse(input: string): object { return JSON.parse(input); }
`;
  const after = `export function parse(input: any): any { return JSON.parse(input); }
`;
  await withFile(after, before, (result) => {
    const loosened = result.changes.find((c) => c.kind === "type-loosened-to-any");
    assert.ok(loosened);
    assert.equal(loosened.severity, "warning");
  });
});

test("ast-analyzer: skips non-TS files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ast-"));
  await writeFile(join(dir, "style.css"), "body { color: red }", "utf8");
  try {
    const result = await analyzeApiChanges(dir, ["style.css"], async () => "body { color: blue }");
    assert.equal(result.changes.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ast-analyzer: new file (no before) is skipped silently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-ast-"));
  await writeFile(join(dir, "api.ts"), "export const x = 1;", "utf8");
  try {
    const result = await analyzeApiChanges(dir, ["api.ts"], async () => null);
    assert.equal(result.changes.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
