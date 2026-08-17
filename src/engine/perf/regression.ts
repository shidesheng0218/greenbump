import { PerformanceMetrics } from "./metrics.js";

export interface PerformanceComparison {
  metric: string;
  before: number;
  after: number;
  delta: number;            // absolute change
  percentChange: number;    // percentage change
  isRegression: boolean;    // exceeded threshold
  severity: "ok" | "warning" | "critical";
}

export interface RegressionThresholds {
  installTime: number;    // 0.30 = 30%
  buildTime: number;      // 0.20 = 20%
  testTime: number;       // 0.30 = 30%
  bundleSize: number;     // 0.15 = 15%
  memoryPeak: number;     // 0.40 = 40%
}

const DEFAULT_THRESHOLDS: RegressionThresholds = {
  installTime: 0.30,    // 30% slower
  buildTime: 0.20,      // 20% slower
  testTime: 0.30,       // 30% slower
  bundleSize: 0.15,     // 15% larger
  memoryPeak: 0.40,     // 40% more memory
};

/**
 * Compare performance metrics and detect regressions
 */
export function comparePerformance(
  baseline: PerformanceMetrics,
  current: PerformanceMetrics,
  thresholds: Partial<RegressionThresholds> = {}
): PerformanceComparison[] {
  const mergedThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const comparisons: PerformanceComparison[] = [];

  // Compare each metric
  for (const [metric, threshold] of Object.entries(mergedThresholds)) {
    const before = baseline[metric as keyof PerformanceMetrics] as number;
    const after = current[metric as keyof PerformanceMetrics] as number;

    if (before === undefined || after === undefined) continue;
    if (before === 0) continue; // Avoid division by zero

    const delta = after - before;
    const percentChange = (delta / before) * 100;
    const isRegression = percentChange > threshold * 100;

    comparisons.push({
      metric,
      before,
      after,
      delta,
      percentChange,
      isRegression,
      severity: isRegression
        ? percentChange > threshold * 200
          ? "critical"
          : "warning"
        : "ok",
    });
  }

  return comparisons;
}

/**
 * Check if any regressions were detected
 */
export function hasRegressions(comparisons: PerformanceComparison[]): boolean {
  return comparisons.some(c => c.isRegression);
}

/**
 * Get human-readable metric name
 */
export function getMetricDisplayName(metric: string): string {
  const names: Record<string, string> = {
    installTime: "Install time",
    buildTime: "Build time",
    testTime: "Test time",
    bundleSize: "Bundle size",
    memoryPeak: "Memory usage",
  };

  return names[metric] || metric;
}

/**
 * Format metric value for display
 */
export function formatMetricValue(metric: string, value: number): string {
  if (metric === "bundleSize") {
    // Format as KB or MB
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(0)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (metric === "memoryPeak") {
    return `${value.toFixed(0)} MB`;
  }

  // Time metrics - format as seconds
  return `${value.toFixed(1)}s`;
}

/**
 * Format percent change for display
 */
export function formatPercentChange(percentChange: number): string {
  const sign = percentChange > 0 ? "+" : "";
  return `${sign}${percentChange.toFixed(1)}%`;
}

/**
 * Display performance comparison results
 */
export function displayPerformanceComparison(
  comparisons: PerformanceComparison[]
): void {
  if (comparisons.length === 0) {
    console.log("📊 No performance metrics to compare");
    return;
  }

  console.log("\n📊 Performance Comparison:");

  for (const comparison of comparisons) {
    const name = getMetricDisplayName(comparison.metric);
    const before = formatMetricValue(comparison.metric, comparison.before);
    const after = formatMetricValue(comparison.metric, comparison.after);
    const change = formatPercentChange(comparison.percentChange);

    if (comparison.isRegression) {
      const icon = comparison.severity === "critical" ? "🔴" : "⚠️";
      console.log(`   ${icon} ${name}: ${before} → ${after} (${change}) - REGRESSION`);
    } else {
      console.log(`   ✓ ${name}: ${before} → ${after} (${change})`);
    }
  }

  const regressionCount = comparisons.filter(c => c.isRegression).length;

  if (regressionCount > 0) {
    console.log(`\n⚠️  ${regressionCount} performance regression(s) detected!`);
    console.log("   Review changes before committing.\n");
  } else {
    console.log("\n✅ No performance regressions detected\n");
  }
}
