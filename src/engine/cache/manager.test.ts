import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CacheManager } from "./manager.js";

async function withCache(fn: (cache: CacheManager) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-cache-test-"));
  const cache = new CacheManager({ cacheDir: dir });
  await cache.init();
  try {
    await fn(cache);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("CacheManager: changelog round-trip", async () => {
  await withCache(async (cache) => {
    assert.equal(await cache.getChangelog("react", "18.0.0", "19.0.0"), null);
    await cache.setChangelog("react", "18.0.0", "19.0.0", "## Breaking\nReactDOM.render removed");
    assert.equal(
      await cache.getChangelog("react", "18.0.0", "19.0.0"),
      "## Breaking\nReactDOM.render removed",
    );
  });
});

test("CacheManager: LLM fix round-trip with hit counter", async () => {
  await withCache(async (cache) => {
    const key = "lodash@4.17.20->4.17.21::some-error";
    assert.equal(await cache.getLlmFix(key), null);

    await cache.setLlmFix(key, {
      edits: { "app.js": "fixed content" },
      hits: 0,
      model: "test-model",
    });

    const got = await cache.getLlmFix(key);
    assert.ok(got);
    assert.deepEqual(got.edits, { "app.js": "fixed content" });
    assert.equal(got.model, "test-model");
  });
});

test("CacheManager: expired entries are evicted on read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "greenbump-cache-test-"));
  const cache = new CacheManager({ cacheDir: dir, ttlMs: 50 }); // 50ms TTL
  await cache.init();
  try {
    // setLlmFix uses the manager's default TTL (unlike setChangelog, which pins 1 year)
    await cache.setLlmFix("some-key", { edits: { "a.js": "x" }, hits: 0, model: "m" });
    // Present immediately
    assert.ok(await cache.getLlmFix("some-key"));
    // Gone after the TTL elapses
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(await cache.getLlmFix("some-key"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CacheManager: stats reflect stored entries", async () => {
  await withCache(async (cache) => {
    await cache.setChangelog("react", "18.0.0", "19.0.0", "notes");
    await cache.setLlmFix("key1", { edits: {}, hits: 0, model: "m" });
    const stats = await cache.stats();
    assert.equal(stats.entries, 2);
    assert.ok(stats.sizeBytes > 0);
    assert.ok(stats.byCategory["changelogs"]);
    assert.ok(stats.byCategory["llm-fixes"]);
  });
});

test("CacheManager: clear removes entries", async () => {
  await withCache(async (cache) => {
    await cache.setChangelog("react", "18.0.0", "19.0.0", "notes");
    await cache.clear("changelogs");
    assert.equal(await cache.getChangelog("react", "18.0.0", "19.0.0"), null);
  });
});
