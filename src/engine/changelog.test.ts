import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchChangelog } from "./changelog.js";
import { getCache, resetCacheForTests } from "./cache/manager.js";

test("fetchChangelog: serves from cache without touching the network", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-changelog-"));
  const prev = process.env.GREENBUMP_CACHE_DIR;
  process.env.GREENBUMP_CACHE_DIR = dir;
  resetCacheForTests();
  try {
    const cache = getCache();
    await cache.init();
    await cache.setChangelog("some-pkg", "1.0.0", "2.0.0", "## v2.0.0\n\nBreaking: everything");

    // No network stubbing needed: if the cache is honored, this returns
    // immediately even though the package doesn't exist on npm.
    const result = await fetchChangelog("some-pkg", "1.0.0", "2.0.0");
    assert.equal(result, "## v2.0.0\n\nBreaking: everything");
  } finally {
    if (prev === undefined) delete process.env.GREENBUMP_CACHE_DIR;
    else process.env.GREENBUMP_CACHE_DIR = prev;
    resetCacheForTests();
    await rm(dir, { recursive: true, force: true });
  }
});
