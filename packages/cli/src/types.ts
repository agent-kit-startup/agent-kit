export type GitWorkflow = "trunk-based" | "feature-pr" | "gitflow" | "homolog-prod" | "unknown";

export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "gitea" | "other";

export type EvidenceConfidence = "high" | "medium" | "low";

export interface DetectionEvidence {
  source: "file" | "git" | "configuration" | "derived";
  value: string;
}

export interface DetectedFact<T> {
  value: T;
  confidence: EvidenceConfidence;
  evidence: DetectionEvidence[];
}

export type RepositoryPurpose =
  | "application"
  | "library"
  | "monorepo"
  | "documentation"
  | "knowledge"
  | "operations"
  | "automation"
  | "mixed"
  | "unknown";

export interface RepositoryPurposeDetection extends DetectedFact<RepositoryPurpose> {
  categories: RepositoryPurpose[];
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export type CiPlatform =
  | "github-actions"
  | "gitlab-ci"
  | "azure-pipelines"
  | "bitbucket-pipelines"
  | "jenkins"
  | "circleci"
  | "travis"
  | "none";

export type ProjectManagementTool =
  | "clickup"
  | "jira"
  | "linear"
  | "asana"
  | "github-issues"
  | "github-projects"
  | "azure-boards"
  | "trello"
  | "shortcut"
  | "notion"
  | "youtrack"
  | "none";

export type IdeName = "cursor" | "vscode" | "windsurf" | "other" | "unknown";

export type IdePlan =
  | "cursor-free"
  | "cursor-pro"
  | "vscode-free"
  | "vscode-pro"
  | "windsurf"
  | "default";

export interface StackDetection {
  language: string;
  framework?: string;
  packageManager?: PackageManager;
  packageManagerEvidence?: DetectionEvidence[];
  scripts?: Record<string, string>;
  workspaces: boolean;
  testCommands: string[];
  validationCommands: string[];
  hasProjectFiles: boolean;
}

export type GitRepositoryMode = "none" | "local-only" | "remote-hosted";
export type GitProviderKind =
  | "github"
  | "gitlab-saas"
  | "gitlab-self-hosted"
  | "known-other"
  | "custom"
  | "unknown";

export interface GitDetection {
  provider?: GitProvider;
  providerKind: GitProviderKind;
  providerConfidence: EvidenceConfidence;
  providerEvidence: DetectionEvidence[];
  remoteUrl?: string;
  remoteName?: string;
  remotes: Array<{ name: string; url: string }>;
  mode: GitRepositoryMode;
  workflow: GitWorkflow;
  currentBranch?: string;
  defaultBranch?: string;
  isDirty: boolean;
  hasLocalStaging: boolean;
  hasRemoteStaging: boolean;
}

export interface IdeDetection {
  ide: IdeName;
  plan: IdePlan;
}

export interface InfraDetection {
  docker: boolean;
  kubernetes: boolean;
  ci: CiPlatform;
  ciFiles: string[];
  infrastructureFiles: string[];
  deploymentFiles: string[];
}

export interface ServicesDetection {
  database?: string;
  orm?: string;
  projectManagement?: ProjectManagementTool[];
}

export interface ContextDetection {
  sources: DetectionEvidence[];
  hasReadme: boolean;
  hasArchitecture: boolean;
  hasRunbooks: boolean;
  hasAgentGuidance: boolean;
}

export interface AgentKitDetection {
  installed: boolean;
  manifestPath?: string;
  version?: string;
  hasPlans: boolean;
  hasHandoff: boolean;
  hasMemory: boolean;
}

export interface SafetyDetection {
  hasGitignore: boolean;
  ignoredSecretPatterns: string[];
  missingSecretPatterns: string[];
  trackedSensitiveFiles: string[];
  hasHooks: boolean;
  hasMainBranchGuard: boolean;
}

export interface QualityDetection {
  testCommands: string[];
  validationCommands: string[];
  ci: CiPlatform;
  hasTests: boolean;
}

export interface ScanResult {
  rootDir: string;
  isGreenfield: boolean;
  purpose: RepositoryPurposeDetection;
  stack: StackDetection;
  git: GitDetection;
  ide: IdeDetection;
  infra: InfraDetection;
  services: ServicesDetection;
  context: ContextDetection;
  agentKit: AgentKitDetection;
  safety: SafetyDetection;
  quality: QualityDetection;
}

export type ReadinessStatus = "ready" | "auto_fix" | "needs_choice" | "manual" | "blocked";
export type ReadinessOwner = "system" | "user" | "administrator";
export type ReadinessPillar =
  | "workspace"
  | "purpose-context"
  | "source-control"
  | "safety"
  | "stack-tooling"
  | "quality-ci"
  | "deploy-infrastructure"
  | "collaboration"
  | "agent-kit-personalization";

export interface ReadinessAction {
  id: string;
  status: ReadinessStatus;
  recommendation: string;
  owner: ReadinessOwner;
}

export interface ReadinessCheck {
  id: string;
  title: string;
  status: ReadinessStatus;
  essential: boolean;
  evidence: DetectionEvidence[];
  actions: ReadinessAction[];
}

export interface ReadinessPillarReport {
  pillar: ReadinessPillar;
  checks: ReadinessCheck[];
}

export interface ReadinessReport {
  schemaVersion: 1;
  generatorVersion: string;
  generatedAt: string;
  repositoryFingerprint: string;
  summary: Record<ReadinessStatus, number>;
  scan: Omit<ScanResult, "rootDir">;
  pillars: ReadinessPillarReport[];
  appliedSafeFixes: ReadinessAction[];
  pendingActions: ReadinessAction[];
  deferredChecks: Array<{ checkId: string; reason: string; recoveryCommand?: string }>;
}

export type SafeReadinessChangeStatus = "planned" | "applied" | "skipped";

export interface SafeReadinessChange {
  id: string;
  path: string;
  status: SafeReadinessChangeStatus;
  evidence: string[];
}

export interface RepositoryProfile {
  schemaVersion: 1;
  contractVersion: 1;
  purpose: RepositoryPurposeDetection;
  stack: StackDetection;
  git: Partial<GitDetection>;
  infra: InfraDetection;
  services: ServicesDetection;
  context: ContextDetection;
  detection: {
    generatedAt: string;
    repositoryFingerprint: string;
    providerConfidence: EvidenceConfidence;
    providerEvidence: DetectionEvidence[];
  };
}

export type OnboardingStatus = "not_started" | "in_progress" | "completed";

export interface OnboardingCheckEvidence {
  status: ReadinessStatus;
  essential: boolean;
  evidence: DetectionEvidence[];
}

export interface OnboardingState {
  contractVersion: 1;
  status: OnboardingStatus;
  updatedAt: string;
  checks: Record<string, OnboardingCheckEvidence>;
  deferredItems: Array<{ checkId: string; reason: string; recoveryCommand?: string }>;
}

export interface SafeReadinessExecution {
  dryRun: boolean;
  changes: SafeReadinessChange[];
  before: ReadinessReport;
  after: ReadinessReport;
}

/** Built-in workspace skin ids (`registry/skins/core/`). */
export type WorkspaceSkinId = "autopilot" | "night-shift" | "ghost-runner";

/** Mode → skin map persisted under `.cursor/context/config.json` → `workspaceSkin`. */
export interface WorkspaceSkinConfig {
  default: WorkspaceSkinId;
  modes: {
    "continue-plan": WorkspaceSkinId;
    "run-plan": WorkspaceSkinId;
    "cli-run-plan": WorkspaceSkinId;
  };
}

/** Wizard choice: mode defaults, one skin for all modes, or skip writing. */
export type WorkspaceSkinChoice =
  | { kind: "mode-defaults" }
  | { kind: "skin"; id: WorkspaceSkinId }
  | { kind: "skip" };

export interface ProjectProfile {
  rootDir: string;
  stack: StackDetection;
  git: GitDetection;
  ide: IdeDetection;
  infra: InfraDetection;
  services: ServicesDetection;
  installHooks: boolean;
  selectedCoreComponents: string[];
  /** Optional: from init wizard; written to `.cursor/context/config.json` when not skip. */
  workspaceSkinChoice?: WorkspaceSkinChoice;
}

/**
 * Maps git providers to their CLI tools and PR/MR terminology.
 * Used by generators and autogit to produce platform-specific instructions.
 */
export const GIT_PLATFORM_META: Record<
  Exclude<GitProvider, "other">,
  { cli: string; prTerm: string; prCommand: string; ciDefault: CiPlatform }
> = {
  github: {
    cli: "gh",
    prTerm: "Pull Request",
    prCommand: "gh pr create",
    ciDefault: "github-actions",
  },
  gitlab: {
    cli: "glab",
    prTerm: "Merge Request",
    prCommand: "glab mr create",
    ciDefault: "gitlab-ci",
  },
  bitbucket: {
    cli: "bb",
    prTerm: "Pull Request",
    prCommand: "bb pr create",
    ciDefault: "bitbucket-pipelines",
  },
  "azure-devops": {
    cli: "az repos",
    prTerm: "Pull Request",
    prCommand: "az repos pr create",
    ciDefault: "azure-pipelines",
  },
  gitea: { cli: "tea", prTerm: "Pull Request", prCommand: "tea pr create", ciDefault: "none" },
};

export const CI_PLATFORM_FILES: Record<Exclude<CiPlatform, "none">, string> = {
  "github-actions": ".github/workflows",
  "gitlab-ci": ".gitlab-ci.yml",
  "azure-pipelines": "azure-pipelines.yml",
  "bitbucket-pipelines": "bitbucket-pipelines.yml",
  jenkins: "Jenkinsfile",
  circleci: ".circleci/config.yml",
  travis: ".travis.yml",
};

export const PM_TOOL_LABELS: Record<ProjectManagementTool, string> = {
  clickup: "ClickUp",
  jira: "Jira",
  linear: "Linear",
  asana: "Asana",
  "github-issues": "GitHub Issues",
  "github-projects": "GitHub Projects",
  "azure-boards": "Azure Boards",
  trello: "Trello",
  shortcut: "Shortcut",
  notion: "Notion",
  youtrack: "YouTrack",
  none: "None",
};
