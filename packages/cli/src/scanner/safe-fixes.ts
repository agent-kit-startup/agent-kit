import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CONTEXT_CONFIG_REL, contextConfigPath } from "../lifecycle/context-config.js";
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
import { KIT_OWNED_IGNORE_PATTERNS, REQUIRED_SECRET_PATTERNS } from "./detect-repository.js";
import { REPOSITORY_PROFILE_REL } from "./paths.js";
import { createReadinessReport } from "./readiness.js";
import { runScanner } from "./scan.js";

/** POSIX form for change-record paths (SoT: lifecycle/context-config). */
const CONTEXT_CONFIG_REL_POSIX = CONTEXT_CONFIG_REL.replace(/\\/g, "/");
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
    .some((check) => {
      if (!check.essential || check.status === "ready") return false;
      if (check.status === "blocked") return true;
      if (!validDeferredCheckIds.has(check.id)) return true;
      // Essential + deferred: only a last-resort deferral (the scanner has no
      // concrete action for this check) completes it. An essential check with
      // an actual action must still take that action, never defer around it.
      // ADR decisions/2026-07-28_onboarding-completion-nonessential-deferral.md,
      // Amend 2026-09-20 (dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md, defect 4).
      return check.actions.length > 0;
    });
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

function mergeIgnorePatterns(existing: string, patterns: readonly string[]): string {
  const activeLines = new Set(
    existing
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );
  const missing = patterns.filter((pattern) => !activeLines.has(pattern));
  if (missing.length === 0) return existing;
  const prefix = existing.length === 0 ? "" : existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${prefix}${missing.join("\n")}\n`;
}

function mergeSecretIgnores(existing: string): string {
  return mergeIgnorePatterns(existing, REQUIRED_SECRET_PATTERNS);
}

function mergeKitOwnedIgnores(existing: string): string {
  return mergeIgnorePatterns(existing, KIT_OWNED_IGNORE_PATTERNS);
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

export interface ProfileRefreshOptions {
  generatorVersion: string;
  generatedAt?: string;
}

export interface ProfileRefreshResult {
  /** False when the reconciled profile is identical to the on-disk one (ignoring the timestamp), so nothing was written. */
  changed: boolean;
  profile: RepositoryProfile;
}

function withoutGeneratedAtForComparison(profile: JsonObject): JsonObject {
  const { generatedAt: _generatedAt, ...detection } = isObject(profile.detection)
    ? profile.detection
    : {};
  return { ...profile, detection };
}

/**
 * Deep-merges `desired` (fresh scanner output) over `existing` (the on-disk
 * profile): every key `desired` defines wins outright -- including an
 * `undefined`/cleared value, so a fact that's no longer true (e.g. no
 * current branch) actually clears instead of leaking the stale value back
 * in. `mergeMissing` above can't be reused here with swapped arguments: its
 * `existing ?? defaults` fallback treats a fresh `undefined` as "not set"
 * and resurrects the stale default, which is exactly the staleness this
 * function exists to fix. Keys `existing` has that `desired` doesn't (an
 * operator- or tool-added extra field) are preserved untouched.
 */
function reconcileFreshOverExisting(desired: JsonObject, existing: JsonObject): JsonObject {
  const merged: JsonObject = { ...existing };
  for (const [key, value] of Object.entries(desired)) {
    const existingValue = existing[key];
    merged[key] =
      isObject(value) && isObject(existingValue)
        ? reconcileFreshOverExisting(value, existingValue)
        : value;
  }
  return merged;
}

/**
 * Reconciles `.cursor/agent-kit.config.json` with the scanner's current
 * output: fresh, scanner-owned values win on every key both sides define
 * (so a stale `git.currentBranch`/`stack`/`context` gets corrected), while
 * any extra keys an operator or another tool added to the profile that the
 * scanner doesn't know about (e.g. a hand-added `purpose.confirmed` flag)
 * are preserved. This is the inverse of `executeSafeReadinessFixes`'
 * merge-missing-only profile write, which intentionally never overwrites an
 * already-present value (so install-time facts can otherwise go stale
 * forever).
 *
 * A no-op refresh (nothing besides `detection.generatedAt` would change)
 * skips the write entirely, so repeated refreshes are idempotent rather
 * than only bumping a timestamp.
 */
export async function refreshRepositoryProfile(
  rootDir: string,
  options: ProfileRefreshOptions,
): Promise<ProfileRefreshResult> {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const scan = await runScanner(rootDir);
  const report = createReadinessReport(scan, {
    generatorVersion: options.generatorVersion,
    generatedAt,
  });
  const desiredProfile = createProfile(scan, report, generatedAt) as unknown as JsonObject;
  const profilePath = path.join(scan.rootDir, REPOSITORY_PROFILE_REL);
  const existingProfile = (await readJson<JsonObject>(profilePath)) ?? {};
  // Fresh values win on shared keys (including clearing to undefined);
  // existing-only keys survive.
  const reconciled = reconcileFreshOverExisting(desiredProfile, existingProfile);

  const meaningfulChange = !jsonEqual(
    withoutGeneratedAtForComparison(existingProfile),
    withoutGeneratedAtForComparison(reconciled),
  );
  if (!meaningfulChange) {
    return { changed: false, profile: existingProfile as unknown as RepositoryProfile };
  }

  await writeJson(profilePath, reconciled);
  return { changed: true, profile: reconciled as unknown as RepositoryProfile };
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
  const gitignoreAfterSecrets = mergeSecretIgnores(existingGitignore);
  const secretsChanged = gitignoreAfterSecrets !== existingGitignore;
  const mergedGitignore = mergeKitOwnedIgnores(gitignoreAfterSecrets);
  const gitignoreChanged = mergedGitignore !== existingGitignore;
  const kitOwnedChanged = mergedGitignore !== gitignoreAfterSecrets;
  if (gitignoreChanged && !dryRun) await writeFile(gitignorePath, mergedGitignore, "utf8");
  recordChange(
    changes,
    "merge-secret-ignores",
    gitignoreRelativePath,
    secretsChanged,
    dryRun,
    relativeEvidence(
      gitignoreRelativePath,
      secretsChanged ? "required secret patterns are missing" : "required patterns are present",
    ),
  );
  recordChange(
    changes,
    "merge-kit-owned-ignores",
    gitignoreRelativePath,
    kitOwnedChanged,
    dryRun,
    relativeEvidence(
      gitignoreRelativePath,
      kitOwnedChanged
        ? "kit-owned session/derived paths are missing"
        : "kit-owned session/derived paths are present",
    ),
  );

  const profilePath = path.join(beforeScan.rootDir, REPOSITORY_PROFILE_REL);
  const existingProfile = (await readJson<JsonObject>(profilePath)) ?? {};
  const desiredProfile = createProfile(beforeScan, before, generatedAt);
  const mergedProfile = mergeMissing(existingProfile, desiredProfile) as JsonObject;
  const profileChanged = !jsonEqual(existingProfile, mergedProfile);
  if (profileChanged && !dryRun) await writeJson(profilePath, mergedProfile);
  recordChange(
    changes,
    "merge-repository-profile",
    REPOSITORY_PROFILE_REL,
    profileChanged,
    dryRun,
    relativeEvidence(
      REPOSITORY_PROFILE_REL,
      profileChanged ? "missing scanner-derived facts" : "existing facts preserved",
    ),
  );

  const evidenceScan = dryRun ? beforeScan : await runScanner(beforeScan.rootDir);
  const evidenceReport = createReadinessReport(evidenceScan, {
    generatorVersion: options.generatorVersion,
    generatedAt,
  });
  const configPath = contextConfigPath(beforeScan.rootDir);
  const existingContextConfig = (await readJson<JsonObject>(configPath)) ?? {};
  const onboarding = reconcileOnboardingState(evidenceReport, existingContextConfig, generatedAt);
  const defaults = preferenceDefaults(onboarding, existingContextConfig.onboarded);
  const mergedContextConfig = mergeMissing(existingContextConfig, defaults) as JsonObject;
  mergedContextConfig.onboarding = onboarding;
  const contextConfigChanged = !jsonEqual(existingContextConfig, mergedContextConfig);
  if (contextConfigChanged && !dryRun) await writeJson(configPath, mergedContextConfig);
  recordChange(
    changes,
    "merge-onboarding-state",
    CONTEXT_CONFIG_REL_POSIX,
    contextConfigChanged,
    dryRun,
    relativeEvidence(
      CONTEXT_CONFIG_REL_POSIX,
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
