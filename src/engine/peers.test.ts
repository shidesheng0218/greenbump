import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePeerConflicts, readDirectDeps } from "./peers.js";

async function withPkg(pkg: unknown, fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-peers-"));
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg), "utf8");
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readDirectDeps: collects deps/devDeps/peerDeps with ranges lowered to x.y.z", async () => {
  await withPkg(
    {
      dependencies: { react: "^18.3.1" },
      devDependencies: { typescript: "~5.7.0" },
      peerDependencies: { zod: ">=3.22.0 <4" },
      optionalDependencies: { fsevents: "2.3.3" },
    },
    async (dir) => {
      const deps = await readDirectDeps(dir);
      assert.equal(deps.react, "18.3.1");
      assert.equal(deps.typescript, "5.7.0");
      assert.equal(deps.zod, "3.22.0");
      assert.equal(deps.fsevents, "2.3.3");
    },
  );
});

test("readDirectDeps: a dependency in several fields is recorded once", async () => {
  await withPkg(
    { dependencies: { react: "^18.0.0" }, devDependencies: { react: "^17.0.0" } },
    async (dir) => {
      const deps = await readDirectDeps(dir);
      assert.equal(deps.react, "18.0.0");
    },
  );
});

test("readDirectDeps: missing or corrupt package.json yields an empty map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-peers-"));
  try {
    assert.deepEqual(await readDirectDeps(dir), {});
    await writeFile(join(dir, "package.json"), "{not json", "utf8");
    assert.deepEqual(await readDirectDeps(dir), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("computePeerConflicts: a satisfied peer is not a conflict", () => {
  const conflicts = computePeerConflicts({ react: "^19.0.0" }, new Set(), { react: "19.2.0" });
  assert.deepEqual(conflicts, []);
});

test("computePeerConflicts: an outdated peer is flagged for co-upgrade with a suggestion", () => {
  // This is the react-dom@19 + react@18 case that made `npm install` fail
  // with ERESOLVE before greenbump ever reached the fix loop.
  const conflicts = computePeerConflicts({ react: "^19.0.0" }, new Set(), { react: "18.3.1" });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].name, "react");
  assert.equal(conflicts[0].current, "18.3.1");
  assert.equal(conflicts[0].required, "^19.0.0");
  assert.equal(conflicts[0].resolution, "upgrade");
  assert.equal(conflicts[0].suggested, "19.0.0");
});

test("computePeerConflicts: an absent peer is reported missing, not upgradable", () => {
  const conflicts = computePeerConflicts({ react: "^19.0.0" }, new Set(), {});
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].current, null);
  assert.equal(conflicts[0].resolution, "missing");
});

test("computePeerConflicts: optional peers are ignored entirely", () => {
  const conflicts = computePeerConflicts({ fsevents: "^2.0.0" }, new Set(["fsevents"]), {});
  assert.deepEqual(conflicts, []);
});

test("computePeerConflicts: an unsatisfiable/unparseable range is unknown rather than upgraded", () => {
  const conflicts = computePeerConflicts({ weird: ">19.0.0" }, new Set(), { weird: "1.0.0" });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].resolution, "unknown");
  assert.equal(conflicts[0].suggested, undefined);
});

test("computePeerConflicts: multiple peers are all reported", () => {
  const conflicts = computePeerConflicts(
    { react: "^19.0.0", "react-native": ">=0.76.0" },
    new Set(),
    { react: "18.3.1", "react-native": "0.70.0" },
  );
  assert.equal(conflicts.length, 2);
  assert.deepEqual(conflicts.map((c) => c.name).sort(), ["react", "react-native"]);
});