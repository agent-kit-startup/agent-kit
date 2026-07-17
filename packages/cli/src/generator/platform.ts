import type { ProjectProfile } from "../types.js";
import { GIT_PLATFORM_META, PM_TOOL_LABELS } from "../types.js";

export function gitProviderLabel(profile: ProjectProfile): string {
  const p = profile.git.provider;
  if (!p || p === "other") return "Git";
  const labels: Record<string, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    bitbucket: "Bitbucket",
    "azure-devops": "Azure DevOps",
    gitea: "Gitea",
  };
  return labels[p] ?? "Git";
}

export function gitCliTool(profile: ProjectProfile): string {
  const p = profile.git.provider;
  if (!p || p === "other") return "git";
  return GIT_PLATFORM_META[p]?.cli ?? "git";
}

export function prTerminology(profile: ProjectProfile): string {
  const p = profile.git.provider;
  if (!p || p === "other") return "PR/MR";
  return GIT_PLATFORM_META[p]?.prTerm ?? "PR/MR";
}

export function prCreateCommand(profile: ProjectProfile): string {
  const p = profile.git.provider;
  if (!p || p === "other") return "# use your platform CLI to create a PR/MR";
  return GIT_PLATFORM_META[p]?.prCommand ?? "# create PR/MR via your platform CLI";
}

export function pmToolsList(profile: ProjectProfile): string {
  const tools = profile.services.projectManagement;
  if (!tools || tools.length === 0) return "";
  return tools.map((t) => PM_TOOL_LABELS[t]).join(", ");
}

export function pmRoutineLine(profile: ProjectProfile): string {
  const label = pmToolsList(profile);
  if (!label) return "";
  return `- Update tasks in ${label} (if applicable)`;
}

export function ciLabel(profile: ProjectProfile): string {
  const labels: Record<string, string> = {
    "github-actions": "GitHub Actions",
    "gitlab-ci": "GitLab CI",
    "azure-pipelines": "Azure Pipelines",
    "bitbucket-pipelines": "Bitbucket Pipelines",
    jenkins: "Jenkins",
    circleci: "CircleCI",
    travis: "Travis CI",
  };
  return labels[profile.infra.ci] ?? "";
}

export function devopsFlowSummary(profile: ProjectProfile): string {
  const parts: string[] = [];

  const provider = gitProviderLabel(profile);
  parts.push(`Git: ${provider}`);

  if (profile.git.workflow !== "unknown") {
    const workflowLabels: Record<string, string> = {
      "trunk-based": "trunk-based",
      "feature-pr": `feature branch → ${prTerminology(profile)} → main`,
      gitflow: "gitflow (develop/release/main)",
      "homolog-prod": "staging → production",
    };
    parts.push(`Workflow: ${workflowLabels[profile.git.workflow] ?? profile.git.workflow}`);
  }

  const ci = ciLabel(profile);
  if (ci) parts.push(`CI/CD: ${ci}`);

  const pm = pmToolsList(profile);
  if (pm) parts.push(`Project mgmt: ${pm}`);

  return parts.join(" | ");
}
