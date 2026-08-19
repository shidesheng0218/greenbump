import { mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { homedir } from "node:os";

/**
 * Disk-based cache for changelogs, LLM responses, and fix patterns.
 * Stored under ~/.greenbump/cache/ so it persists across runs and projects.
 *
 * Cache keys are content-addressed (sha256) so identical contexts always hit.
 * Entries expire after TTL to avoid stale data (changelogs don't change, but
 * LLM responses for a given context may improve as models update).
 */

export interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_CACHE_SIZE_MB = 500;

export class CacheManager {
  private cacheDir: string;
  private ttlMs: number;

  constructor(opts?: { cacheDir?: string; ttlMs?: number }) {
    // GREENBUMP_CACHE_DIR lets tests/CI point the cache at a throwaway dir
    // so cached fixes never leak between runs.
    this.cacheDir =
      opts?.cacheDir ??
      process.env.GREENBUMP_CACHE_DIR ??
      join(homedir(), ".greenbump", "cache");
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS;
  }

  async init(): Promise<void> {
    await mkdir(this.cacheDir, { recursive: true });
  }

  // ── Changelog cache ────────────────────────────────────────────────────

  async getChangelog(pkgName: string, from: string, to: string): Promise<string | null> {
    return this.get<string>("changelogs", `${pkgName}--${from}--${to}`);
  }

  async setChangelog(pkgName: string, from: string, to: string, changelog: string): Promise<void> {
    // Changelogs are immutable — use a very long TTL
    await this.set("changelogs", `${pkgName}--${from}--${to}`, changelog, 365 * 24 * 60 * 60 * 1000);
  }

  // ── LLM response cache ─────────────────────────────────────────────────

  /**
   * Cache an LLM fix response keyed by a hash of the full context
   * (dep + versions + failure output). Identical failures across projects
   * hit the same cache entry — this is where the big savings come from.
   */
  async getLlmFix(contextKey: string): Promise<LlmFixCache | null> {
    return this.get<LlmFixCache>("llm-fixes", contextKey);
  }

  async setLlmFix(contextKey: string, fix: LlmFixCache): Promise<void> {
    await this.set("llm-fixes", contextKey, fix);
  }

  // ── Fix pattern cache ──────────────────────────────────────────────────

  async getFixPattern(pkgName: string, errorSignature: string): Promise<FixPatternEntry | null> {
    return this.get<FixPatternEntry>("patterns", `${pkgName}--${this.hash(errorSignature)}`);
  }

  async setFixPattern(pkgName: string, errorSignature: string, pattern: FixPatternEntry): Promise<void> {
    await this.set("patterns", `${pkgName}--${this.hash(errorSignature)}`, pattern);
  }

  // ── Stats & maintenance ────────────────────────────────────────────────

  async stats(): Promise<CacheStats> {
    const stats: CacheStats = { entries: 0, sizeBytes: 0, byCategory: {} };
    try {
      const categories = await readdir(this.cacheDir);
      for (const cat of categories) {
        const catDir = join(this.cacheDir, cat);
        const s = await stat(catDir).catch(() => null);
        if (!s?.isDirectory()) continue;
        const files = await readdir(catDir);
        let catSize = 0;
        for (const f of files) {
          const fs2 = await stat(join(catDir, f)).catch(() => null);
          if (fs2) catSize += fs2.size;
        }
        stats.byCategory[cat] = { entries: files.length, sizeBytes: catSize };
        stats.entries += files.length;
        stats.sizeBytes += catSize;
      }
    } catch {
      // cache dir doesn't exist yet
    }
    return stats;
  }

  async clear(category?: string): Promise<void> {
    const target = category ? join(this.cacheDir, category) : this.cacheDir;
    await rm(target, { recursive: true, force: true });
    if (!category) await this.init();
  }

  /** Evict expired entries and enforce size cap. Call periodically. */
  async prune(): Promise<number> {
    let pruned = 0;
    const now = Date.now();
    try {
      const categories = await readdir(this.cacheDir);
      for (const cat of categories) {
        const catDir = join(this.cacheDir, cat);
        const s = await stat(catDir).catch(() => null);
        if (!s?.isDirectory()) continue;
        const files = await readdir(catDir);
        for (const f of files) {
          const fp = join(catDir, f);
          try {
            const raw = await readFile(fp, "utf8");
            const entry = JSON.parse(raw) as CacheEntry<unknown> & { ttl?: number };
            const ttl = entry.ttl ?? this.ttlMs;
            if (now - entry.createdAt > ttl) {
              await rm(fp, { force: true });
              pruned++;
            }
          } catch {
            // corrupt entry — remove it
            await rm(fp, { force: true });
            pruned++;
          }
        }
      }
    } catch {
      // nothing to prune
    }
    return pruned;
  }

  // ── Generic get/set ────────────────────────────────────────────────────

  private async get<T>(category: string, key: string): Promise<T | null> {
    const fp = join(this.cacheDir, category, `${this.hash(key)}.json`);
    try {
      const raw = await readFile(fp, "utf8");
      const entry = JSON.parse(raw) as CacheEntry<T> & { ttl?: number };
      const ttl = entry.ttl ?? this.ttlMs;
      if (Date.now() - entry.createdAt > ttl) {
        await rm(fp, { force: true }).catch(() => {});
        return null;
      }
      return entry.value;
    } catch {
      return null;
    }
  }

  private async set<T>(category: string, key: string, value: T, ttlMs?: number): Promise<void> {
    const dir = join(this.cacheDir, category);
    await mkdir(dir, { recursive: true });
    const entry: CacheEntry<T> & { ttl?: number } = {
      value,
      createdAt: Date.now(),
      ...(ttlMs !== undefined ? { ttl: ttlMs } : {}),
    };
    await writeFile(join(dir, `${this.hash(key)}.json`), JSON.stringify(entry), "utf8");
  }

  private hash(input: string): string {
    return createHash("sha256").update(input).digest("hex").slice(0, 24);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────

/** A cached LLM fix: the file edits that resolved a particular failure. */
export interface LlmFixCache {
  /** file path → new content */
  edits: Record<string, string>;
  /** how many times this cached fix has been successfully applied */
  hits: number;
  /** model that produced the fix (informational) */
  model: string;
}

/** A learned fix pattern: error signature → concrete edit recipe. */
export interface FixPatternEntry {
  /** human description of what this pattern fixes */
  description: string;
  /** regex string that matches the error output */
  errorPattern: string;
  /** file edits to apply (path → content, or path → {find, replace}) */
  edits: Record<string, { find: string; replace: string } | string>;
  /** import adjustments per file */
  importFixes?: Record<string, { remove?: string; add?: string }>;
  /** success rate tracking */
  hits: number;
  misses: number;
}

export interface CacheStats {
  entries: number;
  sizeBytes: number;
  byCategory: Record<string, { entries: number; sizeBytes: number }>;
}

let shared: CacheManager | null = null;
let sharedDir: string | null = null;

/** Shared singleton — one cache per process. Re-created if GREENBUMP_CACHE_DIR changes. */
export function getCache(): CacheManager {
  const dir = process.env.GREENBUMP_CACHE_DIR ?? null;
  if (!shared || sharedDir !== dir) {
    shared = new CacheManager();
    sharedDir = dir;
  }
  return shared;
}

/** Test helper: drop the singleton so the next getCache() re-reads the env. */
export function resetCacheForTests(): void {
  shared = null;
  sharedDir = null;
}
