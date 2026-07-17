export type GitWorkflow = "trunk-based" | "feature-pr" | "gitflow" | "homolog-prod" | "unknown";

export type GitProvider = "github" | "gitlab" | "bitbucket" | "azure-devops" | "gitea" | "other";

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
  packageManager?: string;
  hasProjectFiles: boolean;
}

export interface GitDetection {
  provider?: GitProvider;
  remoteUrl?: string;
  workflow: GitWorkflow;
  currentBranch?: string;
}

export interface IdeDetection {
  ide: IdeName;
  plan: IdePlan;
}

export interface InfraDetection {
  docker: boolean;
  kubernetes: boolean;
  ci: CiPlatform;
}

export interface ServicesDetection {
  database?: string;
  orm?: string;
  projectManagement?: ProjectManagementTool[];
}

export interface ScanResult {
  rootDir: string;
  isGreenfield: boolean;
  stack: StackDetection;
  git: GitDetection;
  ide: IdeDetection;
  infra: InfraDetection;
  services: ServicesDetection;
}

export interface ProjectProfile {
  rootDir: string;
  stack: StackDetection;
  git: GitDetection;
  ide: IdeDetection;
  infra: InfraDetection;
  services: ServicesDetection;
  installHooks: boolean;
  selectedCoreComponents: string[];
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
