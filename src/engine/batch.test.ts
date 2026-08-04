import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTargets, type BatchRunOptions } from "./batch.js";
import { WORKSPACE_ROOT, WorkspaceAmbiguityError, type WorkspaceOutdated } from "./workspace.js";
import { RunError } from "./run.js";

function outdated(name: string, current: string, latest: string, workspacePath = WORKSPACE_ROOT): WorkspaceOutdated {
  return { name, current, wanted: "", latest, workspacePath };
}

function baseOpts(overrides: Partial<BatchRunOptions> = {}): BatchRunOptions {
  return { cwd: "/tmp/does-not-matter", maxRounds: 5, ...overrides };
}

test("resolveTargets: --all resolves every candidate, carrying from/to/workspacePath", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21"), outdated("axios", "1.2.0", "1.3.0")];
  const targets = resolveTargets(baseOpts({ all: true }), candidates);
  assert.deepEqual(
    targets.map((t) => [t.dep, t.from, t.to, t.workspacePath]),
    [
      ["lodash", "4.17.20", "4.17.21", WORKSPACE_ROOT],
      ["axios", "1.2.0", "1.3.0", WORKSPACE_ROOT],
    ],
  );
});

test("resolveTargets: explicit deps list resolves each by name", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21"), outdated("axios", "1.2.0", "1.3.0")];
  const targets = resolveTargets(baseOpts({ deps: ["axios"] }), candidates);
  assert.deepEqual(targets, [{ dep: "axios", from: "1.2.0", to: "1.3.0", workspacePath: WORKSPACE_ROOT }]);
});

test("resolveTargets: a mix of valid and invalid names keeps the valid ones and defers invalid ones as targets without a resolved version", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21")];
  const targets = resolveTargets(baseOpts({ deps: ["lodash", "not-a-real-package"] }), candidates);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].dep, "lodash");
  assert.ok(targets[0].to);
  assert.equal(targets[1].dep, "not-a-real-package");
  assert.equal(targets[1].to, undefined);
});

test("resolveTargets: every requested name invalid throws before any git/branch work", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21")];
  assert.throws(
    () => resolveTargets(baseOpts({ deps: ["totally-fake-1", "totally-fake-2"] }), candidates),
    RunError,
  );
});

test("resolveTargets: neither --all nor deps given throws (batch.ts is never called this way from the CLI)", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21")];
  assert.throws(() => resolveTargets(baseOpts({}), candidates), RunError);
});

test("resolveTargets: ambiguous dep across workspaces without --workspace throws WorkspaceAmbiguityError", () => {
  const candidates = [
    outdated("lodash", "4.17.15", "4.17.21", "packages/api"),
    outdated("lodash", "4.17.20", "4.17.21", "packages/web"),
  ];
  assert.throws(() => resolveTargets(baseOpts({ deps: ["lodash"] }), candidates), WorkspaceAmbiguityError);
});

test("resolveTargets: ambiguous dep resolved via --workspace picks the right package", () => {
  const candidates = [
    outdated("lodash", "4.17.15", "4.17.21", "packages/api"),
    outdated("lodash", "4.17.20", "4.17.21", "packages/web"),
  ];
  const targets = resolveTargets(baseOpts({ deps: ["lodash"], workspace: "packages/web" }), candidates);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].from, "4.17.20");
  assert.equal(targets[0].workspacePath, "packages/web");
});
