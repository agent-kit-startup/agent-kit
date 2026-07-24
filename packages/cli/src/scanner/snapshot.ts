import path from "node:path";
import type { ReadinessReport } from "../types.js";
import { writeJson } from "../utils/fs.js";

export const READINESS_SNAPSHOT_RELATIVE_PATH = ".cursor/context/readiness.json";

export function serializeReadinessReport(report: ReadinessReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export async function writeReadinessSnapshot(
  rootDir: string,
  report: ReadinessReport,
): Promise<string> {
  const snapshotPath = path.join(rootDir, READINESS_SNAPSHOT_RELATIVE_PATH);
  await writeJson(snapshotPath, report);
  return snapshotPath;
}
