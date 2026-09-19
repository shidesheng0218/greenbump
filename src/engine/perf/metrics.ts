import { existsSync } from "fs";
import { join } from "path";
import { readFile, writeFile, mkdir, readdir, stat } from "fs/promises";
import { exec } from "../exec.js";
import type { CheckCommand } from "../ecosystems/index.js";

export interface PerformanceMetrics {
  installTime?: number;      // seconds
  buildTime?: number;        // seconds
  testTime?: number;         // seconds
  bundleSize?: number;       // bytes
  memoryPeak?: number;       // MB
  timestamp: Date;
}

/**
 * Get total size of a directory in bytes. Pure Node recursive walk —
 * `du -sb` is GNU-only and silently returns 0 on macOS.
 */
export async function getTotalSize(dirPath: string): Promise<number> {
  let total = 0;
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        const s = await stat(abs).catch(() => null);
        if (s) total += s.size;
      }
    }
  }
  await walk(dirPath);
  return total;
}

const MEASURE_TIMEOUT_MS = 300_000;

export interface BaselineCommands {
  /** bare install command for the ecosystem (npm-family only); skipped otherwise */
  install?: CheckCommand;
  build?: CheckCommand;
  test?: CheckCommand;
}

/**
 * Capture performance baseline before upgrade. Commands come from the
 * ecosystem adapter (via resolveCheckCommands at the call site) — never
 * hardcoded to npm, so non-JS ecosystems don't get bogus measurements.
 */
export async function captureBaseline(
  cwd: string,
  commands: BaselineCommands = {},
): Promise<PerformanceMetrics> {
  console.log("📊 Capturing performance baseline...");

  const metrics: PerformanceMetrics = {
    timestamp: new Date(),
  };

  try {
    // Measure install time
    if (commands.install) {
      console.log("   Measuring install time...");
      const installStart = Date.now();
      await exec(commands.install.cmd, commands.install.args, { cwd, timeout: MEASURE_TIMEOUT_MS });
      metrics.installTime = (Date.now() - installStart) / 1000;
      console.log(`   ✓ Install: ${metrics.installTime.toFixed(1)}s`);
    }

    // Measure build time (if a build command is known)
    if (commands.build) {
      console.log("   Measuring build time...");
      const buildStart = Date.now();
      await exec(commands.build.cmd, commands.build.args, { cwd, timeout: MEASURE_TIMEOUT_MS });
      metrics.buildTime = (Date.now() - buildStart) / 1000;
      console.log(`   ✓ Build: ${metrics.buildTime.toFixed(1)}s`);

      // Measure bundle size
      const distDir = join(cwd, "dist");
      if (existsSync(distDir)) {
        metrics.bundleSize = await getTotalSize(distDir);
        console.log(`   ✓ Bundle: ${(metrics.bundleSize / 1024).toFixed(0)} KB`);
      }
    }

    // Measure test time
    if (commands.test) {
      console.log("   Measuring test time...");
      const testStart = Date.now();
      await exec(commands.test.cmd, commands.test.args, { cwd, timeout: MEASURE_TIMEOUT_MS });
      metrics.testTime = (Date.now() - testStart) / 1000;
      console.log(`   ✓ Test: ${metrics.testTime.toFixed(1)}s`);
    }
  } catch (error: any) {
    console.warn("⚠️  Warning: Failed to capture complete baseline:", error.message);
  }

  // Save baseline to .greenbump/perf-baseline.json
  const greenbumpDir = join(cwd, ".greenbump");
  if (!existsSync(greenbumpDir)) {
    await mkdir(greenbumpDir, { recursive: true });
  }

  const baselinePath = join(greenbumpDir, "perf-baseline.json");
  await writeFile(baselinePath, JSON.stringify(metrics, null, 2));

  return metrics;
}

/**
 * Load baseline from file
 */
export async function loadBaseline(cwd: string): Promise<PerformanceMetrics | null> {
  const baselinePath = join(cwd, ".greenbump", "perf-baseline.json");

  if (!existsSync(baselinePath)) {
    return null;
  }

  try {
    const content = await readFile(baselinePath, "utf-8");
    const baseline = JSON.parse(content);

    // Convert timestamp string back to Date
    if (baseline.timestamp) {
      baseline.timestamp = new Date(baseline.timestamp);
    }

    return baseline;
  } catch {
    return null;
  }
}

/**
 * Collect current performance metrics
 */
export async function collectCurrentMetrics(cwd: string): Promise<PerformanceMetrics> {
  console.log("📊 Collecting current performance metrics...");

  const metrics: PerformanceMetrics = {
    timestamp: new Date(),
  };

  try {
    // Check bundle size if build output exists
    const distDir = join(cwd, "dist");
    if (existsSync(distDir)) {
      metrics.bundleSize = await getTotalSize(distDir);
    }

    // We can't easily measure install/build/test time after the fact
    // These would need to be captured during the actual operations
  } catch (error: any) {
    console.warn("⚠️  Warning: Failed to collect metrics:", error.message);
  }

  return metrics;
}

/**
 * Extract performance metrics from Docker container logs
 */
export async function extractMetricsFromLogs(logs: string): Promise<Partial<PerformanceMetrics>> {
  const metrics: Partial<PerformanceMetrics> = {};

  // Try to extract timing information from logs
  // This is a simple heuristic-based approach

  // Look for npm install time
  const installMatch = logs.match(/added \d+ packages.*in ([\d.]+)s/);
  if (installMatch) {
    metrics.installTime = parseFloat(installMatch[1]);
  }

  // Look for build time (webpack/vite output)
  const buildMatch = logs.match(/built in ([\d.]+)s/i) ||
                     logs.match(/Done in ([\d.]+)s/);
  if (buildMatch) {
    metrics.buildTime = parseFloat(buildMatch[1]);
  }

  // Look for test time
  const testMatch = logs.match(/Tests:\s+\d+ passed.*\(([\d.]+)s\)/) ||
                    logs.match(/Ran \d+ tests? in ([\d.]+)s/);
  if (testMatch) {
    metrics.testTime = parseFloat(testMatch[1]);
  }

  return metrics;
}
