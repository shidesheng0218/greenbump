import { writeFile } from "node:fs/promises";
import type { BatchItemResult } from "./engine/run.js";

export const REPORT_SCHEMA_VERSION = 1;

export interface ReportEnvelope {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  generatedAt: string;
  /** always an array, even for a single-dependency run — one shape for every consumer */
  runs: BatchItemResult[];
}

export function buildReport(runs: BatchItemResult[]): ReportEnvelope {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    runs,
  };
}

export async function writeReport(path: string, envelope: ReportEnvelope): Promise<void> {
  await writeFile(path, JSON.stringify(envelope, null, 2) + "\n", "utf8");
}
