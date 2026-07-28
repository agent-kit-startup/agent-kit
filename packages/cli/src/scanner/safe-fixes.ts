import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  OnboardingState,
  ReadinessAction,
  ReadinessReport,
  RepositoryProfile,
  SafeReadinessChange,
  SafeReadinessExecution,
  ScanResult,
} from "../types.js";
import { ensureDir, fileExists, readJson, writeJson } from "../utils/fs.js";
import { REQUIRED_SECRET_PATTERNS } from "./detect-repository.js";
import { createReadinessReport } from "./readiness.js";
import { runScanner } from "./scan.js";

const PROFILE_RELATIVE_PATH = ".cursor/agent-kit.config.json";
const CONTEXT_CONFIG_RELATIVE_PATH = ".cursor/context/config.json";
const ESSENTIAL_DIRECTORIES = [
  ".cursor",
  ".cursor/context",
  ".cursor/context/current",
  ".cursor/context/backups",
  ".cursor/plans",
  ".cursor/memory",
] as const;

interface SafeReadinessOptions {
  generatorVersion: string;
  dryRun?: boolean;
  generatedAt?: string;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeMissing(existing: unknown, defaults: unknown): unknown {
  if (!isObject(existing) || !isObject(defaults)) return existing ?? defaults;
  const merged: JsonObject = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    merged[key] = key in existing ? mergeMissing(existing[key], value) : value;
  }
  return merged;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function relativeEvidence(relativePath: string, detail: string): string[] {
  return [`${relativePath}: ${detail}`];
}

function createProfile(
  scan: ScanResult,
  report: ReadinessReport,
  generatedAt: string,
): RepositoryProfile {
  const git: RepositoryProfile["git"] = {
    mode: scan.git.mode,
    workflow: scan.git.workflow,
    remotes: scan.git.remotes,
    remoteUrl: scan.git.remoteUrl,
    remoteName: scan.git.remoteName,
    currentBranch: scan.git.currentBranch,
    defaultBranch: scan.git.defaultBranch,
    isDirty: scan.git.isDirty,
    hasLocalStaging: scan.git.hasLocalStaging,
    hasRemoteStaging: scan.git.hasRemoteStaging,
  };
  if (scan.git.providerConfidence === "high") {
    git.provider = scan.git.provider;
    git.providerKind = scan.git.providerKind;
    git.providerConfidence = scan.git.providerConfidence;
    git.providerEvidence = scan.git.providerEvidence;
  }

  return {
    schemaVersion: 1,
    contractVersion: 1,
    purpose: scan.purpose,
    stack: scan.stack,
    git,
    infra: scan.infra,
    services: scan.services,
    context: scan.context,
    detection: {
      generatedAt,
      repositoryFingerprint: report.repositoryFingerprint,
      providerConfidence: scan.git.providerConfidence,
      providerEvidence: scan.git.providerEvidence,
    },
  };
}

function createOnboardingState(
  report: ReadinessReport,
  generatedAt: string,
  deferredItems = report.deferredChecks,
): OnboardingState {
  const validDeferredCheckIds = new Set(
    deferredItems.filter((item) => item.reason.trim().length > 0).map((item) => item.checkId),
  );
  const unresolvedEssential = report.pillars
    .flatMap((pillar) => pillar.checks)
    .some(
      (check) =>
        check.essential &&
        check.status !== "ready" &&
        (check.status === "blocked" || !validDeferredCheckIds.has(check.id)),
    );
  return {
    contractVersion: 1,
    status: unresolvedEssential ? "in_progress" : "completed",
    updatedAt: generatedAt,
    checks: Object.fromEntries(
      report.pillars
        .flatMap((pillar) => pillar.checks)
        .map((check) => [
          check.id,
          {
            status: check.status,
            essential: check.essential,
            evidence: check.evidence,
          },
        ]),
    ),
    deferredItems,
  };
}

function validDeferredItems(
  value: unknown,
  fallback: OnboardingState["deferredItems"],
): OnboardingState["deferredItems"] {
  if (!Array.isArray(value)) return fallback;
  return value.filter(
    (item): item is OnboardingState["deferredItems"][number] =>
      isObject(item) &&
      typeof item.checkId === "string" &&
      typeof item.reason === "string" &&
      (item.recoveryCommand === undefined || typeof item.recoveryCommand === "string"),
  );
}

function reconcileOnboardingState(
  report: ReadinessReport,
  existingConfig: JsonObject,
  generatedAt: string,
): OnboardingState & JsonObject {
  const existing = isObject(existingConfig.onboarding) ? existingConfig.onboarding : {};
  const deferredItems = validDeferredItems(existing.deferredItems, report.deferredChecks);
  const derived = createOnboardingState(report, generatedAt, deferredItems);
  const candidate = {
    ...existing,
    ...derived,
  } satisfies OnboardingState & JsonObject;
  const { updatedAt: _candidateUpdatedAt, ...candidateState } = candidate;
  const { updatedAt: existingUpdatedAt, ...existingState } = existing;
  candidate.updatedAt =
    jsonEqual(candidateState, existingState) && typeof existingUpdatedAt === "string"
      ? existingUpdatedAt
      : generatedAt;
  return candidate;
}

function preferenceDefaults(onboarding: OnboardingState, onboarded: unknown): JsonObject {
  return {
    onboarded: onboarded === true,
    onboarding,
    externalPlanReview: {
      enabled: false,
      backend: "claude",
      autoRemediate: false,
      offerOnExhausted: true,
      mode: "paste",
      midBatchAudits: false,
      preflight: "off",
    },
    autoHandoff: false,
    agentPersona: {
      default: "autopilot",
      modes: {
        "continue-plan": "autopilot",
        "run-plan": "night-shift",
        "cli-run-plan": "ghost-runner",
      },
    },
  };
}

function mergeSecretIgnores(existing: string): string {
  const activeLines = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  const missing = REQUIRED_SECRET_PATTERNS.filter((pattern) => !activeLines.has(pattern));
  if (missing.length === 0) return existing;
  const prefix = existing.length === 0 ? "" : existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${prefix}${missing.join("\n")}\n`;
}

function recordChange(
  changes: SafeReadinessChange[],
  id: string,
  relativePath: string,
  changed: boolean,
  dryRun: boolean,
  evidence: string[],
): void {
  changes.push({
    id,
    path: relativePath,
    status: changed ? (dryRun ? "planned" : "applied") : "skipped",
    evidence,
  });
}

function appliedActions(changes: SafeReadinessChange[]): ReadinessAction[] {
  return changes
    .filter((change) => change.status === "applied")
    .map((change) => ({
      id: change.id,
      status: "ready",
      recommendation: `Applied safe local change to ${change.path}`,
      owner: "system",
    }));
}

export async function executeSafeReadinessFixes(
  rootDir: string,
  options: SafeReadinessOptions,
): Promise<SafeReadinessExecution> {
  const dryRun = options.dryRun ?? false;
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const beforeScan = await runScanner(rootDir);
  const before = createReadinessReport(beforeScan, {
    generatorVersion: options.generatorVersion,
    generatedAt,
  });
  const changes: SafeReadinessChange[] = [];

  for (const relativePath of ESSENTIAL_DIRECTORIES) {
    const absolutePath = path.join(beforeScan.rootDir, relativePath);
    const exists = await fileExists(absolutePath);
    if (!exists && !dryRun) await ensureDir(absolutePath);
    recordChange(
      changes,
      "ensure-agent-kit-directory",
      relativePath,
      !exists,
      dryRun,
      relativeEvidence(relativePath, exists ? "already exists" : "missing directory"),
    );
  }

  const gitignoreRelativePath = ".gitignore";
  const gitignorePath = path.join(beforeScan.rootDir, gitignoreRelativePath);
  const existingGitignore = (await fileExists(gitignorePath))
    ? await readFile(gitignorePath, "utf8")
    : "";
  const mergedGitignore = mergeSecretIgnores(existingGitignore);
  const gitignoreChanged = mergedGitignore !== existingGitignore;
  if (gitignoreChanged && !dryRun) await writeFile(gitignorePath, mergedGitignore, "utf8");
  recordChange(
    changes,
    "merge-secret-ignores",
    gitignoreRelativePath,
    gitignoreChanged,
    dryRun,
    relativeEvidence(
      gitignoreRelativePath,
      gitignoreChanged ? "required secret patterns are missing" : "required patterns are present",
    ),
  );

  const profilePath = path.join(beforeScan.rootDir, PROFILE_RELATIVE_PATH);
  const existingProfile = (await readJson<JsonObject>(profilePath)) ?? {};
  const desiredProfile = createProfile(beforeScan, before, generatedAt);
  const mergedProfile = mergeMissing(existingProfile, desiredProfile) as JsonObject;
  const profileChanged = !jsonEqual(existingProfile, mergedProfile);
  if (profileChanged && !dryRun) await writeJson(profilePath, mergedProfile);
  recordChange(
    changes,
    "merge-repository-profile",
    PROFILE_RELATIVE_PATH,
    profileChanged,
    dryRun,
    relativeEvidence(
      PROFILE_RELATIVE_PATH,
      profileChanged ? "missing scanner-derived facts" : "existing facts preserved",
    ),
  );

  const evidenceScan = dryRun ? beforeScan : await runScanner(beforeScan.rootDir);
  const evidenceReport = createReadinessReport(evidenceScan, {
    generatorVersion: options.generatorVersion,
    generatedAt,
  });
  const contextConfigPath = path.join(beforeScan.rootDir, CONTEXT_CONFIG_RELATIVE_PATH);
  const existingContextConfig = (await readJson<JsonObject>(contextConfigPath)) ?? {};
  const onboarding = reconcileOnboardingState(evidenceReport, existingContextConfig, generatedAt);
  const defaults = preferenceDefaults(onboarding, existingContextConfig.onboarded);
  const mergedContextConfig = mergeMissing(existingContextConfig, defaults) as JsonObject;
  mergedContextConfig.onboarding = onboarding;
  const contextConfigChanged = !jsonEqual(existingContextConfig, mergedContextConfig);
  if (contextConfigChanged && !dryRun) await writeJson(contextConfigPath, mergedContextConfig);
  recordChange(
    changes,
    "merge-onboarding-state",
    CONTEXT_CONFIG_RELATIVE_PATH,
    contextConfigChanged,
    dryRun,
    relativeEvidence(
      CONTEXT_CONFIG_RELATIVE_PATH,
      contextConfigChanged ? "missing preferences or onboarding state" : "state already merged",
    ),
  );

  const afterScan = dryRun ? beforeScan : await runScanner(beforeScan.rootDir);
  const after = createReadinessReport(afterScan, {
    generatorVersion: options.generatorVersion,
    generatedAt,
  });
  after.appliedSafeFixes = appliedActions(changes);

  return { dryRun, changes, before, after };
}
