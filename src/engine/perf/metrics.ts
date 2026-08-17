import { existsSync } from "fs";
import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import { exec } from "../git.js";

export interface PerformanceMetrics {
  installTime?: number;      // seconds
  buildTime?: number;        // seconds
  testTime?: number;         // seconds
  bundleSize?: number;       // bytes
  memoryPeak?: number;       // MB
  timestamp: Date;
}

/**
 * Check if project has build script
 */
async function hasBuildScript(cwd: string): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return pkg.scripts?.build !== undefined;
  } catch {
    return false;
  }
}

/**
 * Check if project has test script
 */
async function hasTestScript(cwd: string): Promise<boolean> {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return false;

  try {
    const content = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(content);
    return pkg.scripts?.test !== undefined;
  } catch {
    return false;
  }
}

/**
 * Get total size of directory in bytes
 */
async function getTotalSize(dirPath: string): Promise<number> {
  if (!existsSync(dirPath)) return 0;

  try {
    const result = await exec("du", ["-sb", dirPath], { cwd: dirPath });
    const match = result.stdout.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * Capture performance baseline before upgrade
 */
export async function captureBaseline(cwd: string): Promise<PerformanceMetrics> {
  console.log("📊 Capturing performance baseline...");

  const metrics: PerformanceMetrics = {
    timestamp: new Date(),
  };

  try {
    // Measure install time
    console.log("   Measuring install time...");
    const installStart = Date.now();
    await exec("npm", ["install"], { cwd });
    metrics.installTime = (Date.now() - installStart) / 1000;
    console.log(`   ✓ Install: ${metrics.installTime.toFixed(1)}s`);

    // Measure build time (if build script exists)
    if (await hasBuildScript(cwd)) {
      console.log("   Measuring build time...");
      const buildStart = Date.now();
      await exec("npm", ["run", "build"], { cwd });
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
    if (await hasTestScript(cwd)) {
      console.log("   Measuring test time...");
      const testStart = Date.now();
      await exec("npm", ["test"], { cwd });
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
