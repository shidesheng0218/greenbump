import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { withTmpDir } from "../test-utils.js";
import {
  detectWorkspaceMembers,
  resolveWorkspaceTarget,
  WorkspaceAmbiguityError,
  WORKSPACE_ROOT,
  type WorkspaceOutdated,
} from "./workspace.js";

async function writeJson(path: string, data: unknown): Promise<void> {
  await writeFile(path, JSON.stringify(data), "utf8");
}

test("detectWorkspaceMembers: non-workspace repo returns []", async () => {
  await withTmpDir(async (dir) => {
    await writeJson(join(dir, "package.json"), { name: "solo" });
    assert.deepEqual(await detectWorkspaceMembers(dir), []);
  });
});

test("detectWorkspaceMembers: npm/yarn `workspaces` array field", async () => {
  await withTmpDir(async (dir) => {
    await writeJson(join(dir, "package.json"), { name: "root", workspaces: ["packages/*"] });
    await mkdir(join(dir, "packages", "api"), { recursive: true });
    await mkdir(join(dir, "packages", "web"), { recursive: true });
    await writeJson(join(dir, "packages", "api", "package.json"), { name: "@x/api" });
    await writeJson(join(dir, "packages", "web", "package.json"), { name: "@x/web" });

    const members = await detectWorkspaceMembers(dir);
    const names = members.map((m) => m.name).sort();
    const paths = members.map((m) => m.path).sort();
    assert.deepEqual(names, ["@x/api", "@x/web"]);
    assert.deepEqual(paths, ["packages/api", "packages/web"]);
  });
});

test("detectWorkspaceMembers: npm `workspaces.packages` object form", async () => {
  await withTmpDir(async (dir) => {
    await writeJson(join(dir, "package.json"), { name: "root", workspaces: { packages: ["apps/*"] } });
    await mkdir(join(dir, "apps", "cli"), { recursive: true });
    await writeJson(join(dir, "apps", "cli", "package.json"), { name: "cli" });

    const members = await detectWorkspaceMembers(dir);
    assert.deepEqual(members, [{ path: "apps/cli", name: "cli" }]);
  });
});

test("detectWorkspaceMembers: pnpm-workspace.yaml", async () => {
  await withTmpDir(async (dir) => {
    await writeJson(join(dir, "package.json"), { name: "root" });
    await writeFile(
      join(dir, "pnpm-workspace.yaml"),
      'packages:\n  - "packages/*"\n  - "tools/*"\n',
      "utf8",
    );
    await mkdir(join(dir, "packages", "core"), { recursive: true });
    await mkdir(join(dir, "tools", "gen"), { recursive: true });
    await writeJson(join(dir, "packages", "core", "package.json"), { name: "core" });
    await writeJson(join(dir, "tools", "gen", "package.json"), { name: "gen" });

    const members = await detectWorkspaceMembers(dir);
    const paths = members.map((m) => m.path).sort();
    assert.deepEqual(paths, ["packages/core", "tools/gen"]);
  });
});

test("detectWorkspaceMembers: glob directories without a package.json are skipped", async () => {
  await withTmpDir(async (dir) => {
    await writeJson(join(dir, "package.json"), { name: "root", workspaces: ["packages/*"] });
    await mkdir(join(dir, "packages", "empty-scaffold"), { recursive: true });
    // no package.json inside "empty-scaffold"

    assert.deepEqual(await detectWorkspaceMembers(dir), []);
  });
});

function outdated(name: string, current: string, latest: string, workspacePath: string): WorkspaceOutdated {
  return { name, current, wanted: "", latest, workspacePath };
}

test("resolveWorkspaceTarget: unambiguous single match resolves directly", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21", WORKSPACE_ROOT)];
  const result = resolveWorkspaceTarget("lodash", candidates);
  assert.equal(result?.workspacePath, WORKSPACE_ROOT);
});

test("resolveWorkspaceTarget: same version across packages is not ambiguous", () => {
  const candidates = [
    outdated("lodash", "4.17.20", "4.17.21", "packages/api"),
    outdated("lodash", "4.17.20", "4.17.21", "packages/web"),
  ];
  // Same current version everywhere — no real ambiguity, first match wins.
  assert.doesNotThrow(() => resolveWorkspaceTarget("lodash", candidates));
});

test("resolveWorkspaceTarget: different versions across packages throws WorkspaceAmbiguityError", () => {
  const candidates = [
    outdated("lodash", "4.17.15", "4.17.21", "packages/api"),
    outdated("lodash", "4.17.20", "4.17.21", "packages/web"),
  ];
  assert.throws(() => resolveWorkspaceTarget("lodash", candidates), WorkspaceAmbiguityError);
});

test("resolveWorkspaceTarget: --workspace disambiguates an otherwise-ambiguous name", () => {
  const candidates = [
    outdated("lodash", "4.17.15", "4.17.21", "packages/api"),
    outdated("lodash", "4.17.20", "4.17.21", "packages/web"),
  ];
  const result = resolveWorkspaceTarget("lodash", candidates, "packages/web");
  assert.equal(result?.current, "4.17.20");
});

test("resolveWorkspaceTarget: no match returns undefined", () => {
  const candidates = [outdated("lodash", "4.17.20", "4.17.21", WORKSPACE_ROOT)];
  assert.equal(resolveWorkspaceTarget("react", candidates), undefined);
});
