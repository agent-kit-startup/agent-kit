import { createHash } from "node:crypto";
import type {
  DetectionEvidence,
  ReadinessAction,
  ReadinessCheck,
  ReadinessPillar,
  ReadinessPillarReport,
  ReadinessReport,
  ReadinessStatus,
  ScanResult,
} from "../types.js";

interface ReadinessReportOptions {
  generatorVersion: string;
  generatedAt?: string;
}

function action(
  id: string,
  status: ReadinessStatus,
  recommendation: string,
  owner: ReadinessAction["owner"],
): ReadinessAction {
  return { id, status, recommendation, owner };
}

function check(
  id: string,
  title: string,
  status: ReadinessStatus,
  essential: boolean,
  evidence: DetectionEvidence[],
  actions: ReadinessAction[] = [],
): ReadinessCheck {
  return { id, title, status, essential, evidence, actions };
}

function pillar(pillarName: ReadinessPillar, checks: ReadinessCheck[]): ReadinessPillarReport {
  return { pillar: pillarName, checks };
}

function repositoryFingerprint(scan: ScanResult): string {
  const fingerprintInput = {
    purpose: scan.purpose,
    stack: {
      language: scan.stack.language,
      framework: scan.stack.framework,
      packageManager: scan.stack.packageManager,
      workspaces: scan.stack.workspaces,
    },
    git: {
      mode: scan.git.mode,
      remoteUrl: scan.git.remoteUrl,
      currentBranch: scan.git.currentBranch,
      defaultBranch: scan.git.defaultBranch,
    },
    context: scan.context.sources,
    agentKitVersion: scan.agentKit.version,
  };
  return createHash("sha256").update(JSON.stringify(fingerprintInput)).digest("hex");
}

function buildPillars(scan: ScanResult): ReadinessPillarReport[] {
  const agentKitStatus: ReadinessStatus = scan.agentKit.installed ? "ready" : "auto_fix";
  const purposeStatus: ReadinessStatus =
    scan.purpose.value === "unknown" ? "needs_choice" : "ready";
  const gitStatus: ReadinessStatus = scan.git.mode === "none" ? "needs_choice" : "ready";
  const secretsStatus: ReadinessStatus =
    scan.safety.trackedSensitiveFiles.length > 0
      ? "blocked"
      : scan.safety.missingSecretPatterns.length > 0
        ? "auto_fix"
        : "ready";
  const contextStatus: ReadinessStatus = scan.context.sources.length > 0 ? "ready" : "needs_choice";
  const providerStatus: ReadinessStatus =
    scan.git.mode === "none"
      ? "needs_choice"
      : scan.git.mode === "local-only"
        ? "ready"
        : scan.git.providerKind === "unknown" ||
            (scan.git.providerKind === "custom" && scan.git.providerConfidence === "low")
          ? "needs_choice"
          : "ready";

  return [
    pillar("workspace", [
      check(
        "workspace.agent-kit",
        "Agent Kit installation",
        agentKitStatus,
        true,
        scan.agentKit.manifestPath ? [{ source: "file", value: scan.agentKit.manifestPath }] : [],
        agentKitStatus === "ready"
          ? []
          : [action("install-agent-kit", "auto_fix", "Install the managed L0 inventory", "system")],
      ),
    ]),
    pillar("purpose-context", [
      check(
        "purpose.classification",
        "Repository purpose",
        purposeStatus,
        true,
        scan.purpose.evidence,
        purposeStatus === "ready"
          ? []
          : [
              action(
                "confirm-repository-purpose",
                "needs_choice",
                "Confirm the stable repository purpose",
                "user",
              ),
            ],
      ),
      check(
        "context.sources",
        "Project context sources",
        contextStatus,
        true,
        scan.context.sources,
        contextStatus === "ready"
          ? []
          : [
              action(
                "identify-context-source",
                "needs_choice",
                "Identify the repository source of truth",
                "user",
              ),
            ],
      ),
    ]),
    pillar("source-control", [
      check(
        "git.repository",
        "Git repository",
        gitStatus,
        true,
        scan.git.currentBranch
          ? [{ source: "git", value: `branch:${scan.git.currentBranch}` }]
          : [],
        gitStatus === "ready"
          ? []
          : [
              action(
                "choose-source-control",
                "needs_choice",
                "Choose whether to initialize Git",
                "user",
              ),
            ],
      ),
      check(
        "git.staging-branch",
        "Staging branch",
        scan.git.hasLocalStaging || scan.git.hasRemoteStaging ? "ready" : "needs_choice",
        false,
        [
          ...(scan.git.hasLocalStaging
            ? [{ source: "git" as const, value: "local branch:staging" }]
            : []),
          ...(scan.git.hasRemoteStaging
            ? [{ source: "git" as const, value: "remote branch:staging" }]
            : []),
        ],
        scan.git.hasLocalStaging || scan.git.hasRemoteStaging
          ? []
          : [
              action(
                "choose-branch-strategy",
                "needs_choice",
                "Confirm the repository promotion strategy",
                "user",
              ),
            ],
      ),
    ]),
    pillar("safety", [
      check(
        "safety.secrets",
        "Secrets hygiene",
        secretsStatus,
        true,
        [
          ...scan.safety.ignoredSecretPatterns.map((value) => ({
            source: "file" as const,
            value: `.gitignore:${value}`,
          })),
          ...scan.safety.trackedSensitiveFiles.map((value) => ({
            source: "git" as const,
            value: `tracked:${value}`,
          })),
        ],
        secretsStatus === "ready"
          ? []
          : secretsStatus === "blocked"
            ? [
                action(
                  "remove-tracked-secrets",
                  "blocked",
                  "Remove tracked sensitive files and rotate exposed values",
                  "user",
                ),
              ]
            : [
                action(
                  "merge-secret-ignores",
                  "auto_fix",
                  "Merge required secret patterns into .gitignore",
                  "system",
                ),
              ],
      ),
    ]),
    pillar("stack-tooling", [
      check(
        "stack.detected",
        "Stack and package manager",
        scan.stack.language !== "unknown" || scan.purpose.value !== "unknown"
          ? "ready"
          : "needs_choice",
        true,
        scan.stack.packageManagerEvidence ?? scan.purpose.evidence,
      ),
    ]),
    pillar("quality-ci", [
      check(
        "quality.validation",
        "Tests and validation",
        scan.quality.hasTests || scan.quality.validationCommands.length > 0 ? "ready" : "manual",
        false,
        scan.infra.ciFiles.map((value) => ({ source: "file", value })),
        scan.quality.hasTests || scan.quality.validationCommands.length > 0
          ? []
          : [
              action(
                "document-validation",
                "manual",
                "Document a repeatable repository validation command",
                "user",
              ),
            ],
      ),
    ]),
    pillar("deploy-infrastructure", [
      check(
        "infrastructure.detected",
        "Deployment and infrastructure evidence",
        "ready",
        false,
        [...scan.infra.infrastructureFiles, ...scan.infra.deploymentFiles].map((value) => ({
          source: "file",
          value,
        })),
      ),
    ]),
    pillar("collaboration", [
      check(
        "collaboration.provider",
        "Repository provider",
        providerStatus,
        false,
        scan.git.providerEvidence,
        providerStatus === "ready"
          ? []
          : [
              action(
                "confirm-provider",
                "needs_choice",
                "Confirm the remote provider or local-only model",
                "user",
              ),
            ],
      ),
    ]),
    pillar("agent-kit-personalization", [
      check(
        "agent-kit.context",
        "Agent guidance",
        scan.context.hasAgentGuidance ? "ready" : "auto_fix",
        false,
        scan.context.sources.filter((item) => item.value.includes("guidance")),
        scan.context.hasAgentGuidance
          ? []
          : [
              action(
                "prepare-agent-context",
                "auto_fix",
                "Prepare Agent Kit-owned context from detected evidence",
                "system",
              ),
            ],
      ),
    ]),
  ];
}

export function createReadinessReport(
  scan: ScanResult,
  options: ReadinessReportOptions,
): ReadinessReport {
  const pillars = buildPillars(scan);
  const checks = pillars.flatMap((item) => item.checks);
  const statuses: ReadinessStatus[] = ["ready", "auto_fix", "needs_choice", "manual", "blocked"];
  const summary = Object.fromEntries(
    statuses.map((status) => [status, checks.filter((item) => item.status === status).length]),
  ) as Record<ReadinessStatus, number>;
  const pendingActions = checks
    .flatMap((item) => item.actions)
    .filter((item) => item.status !== "ready");
  const { rootDir: _rootDir, ...portableScan } = scan;

  return {
    schemaVersion: 1,
    generatorVersion: options.generatorVersion,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    repositoryFingerprint: repositoryFingerprint(scan),
    summary,
    scan: portableScan,
    pillars,
    appliedSafeFixes: [],
    pendingActions,
    deferredChecks: [],
  };
}
