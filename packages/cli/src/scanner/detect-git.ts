import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type {
  DetectionEvidence,
  EvidenceConfidence,
  GitDetection,
  GitProvider,
  GitProviderKind,
  GitWorkflow,
} from "../types.js";
import { fileExists, readJson } from "../utils/fs.js";

const exec = promisify(execFile);

interface ProviderResult {
  provider?: GitProvider;
  providerKind: GitProviderKind;
  confidence: EvidenceConfidence;
  evidence: DetectionEvidence[];
}

interface ProviderConfiguration {
  git?: {
    provider?: GitProvider;
    providerKind?: GitProviderKind;
  };
}

function remoteHostname(remoteUrl: string): string | undefined {
  const scpMatch = remoteUrl.match(/^[^@]+@([^:]+):/);
  if (scpMatch?.[1]) return scpMatch[1].toLowerCase();
  try {
    return new URL(remoteUrl).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function sanitizeRemoteUrl(remoteUrl: string): string {
  try {
    const parsed = new URL(remoteUrl);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return remoteUrl;
  }
}

export async function detectProvider(rootDir: string, remoteUrl?: string): Promise<ProviderResult> {
  const configuration = await readJson<ProviderConfiguration>(
    path.join(rootDir, ".cursor", "agent-kit.config.json"),
  );
  const configuredProvider = configuration?.git?.provider;
  if (configuredProvider) {
    const configuredKind =
      configuration.git?.providerKind ??
      (configuredProvider === "github"
        ? "github"
        : configuredProvider === "gitlab"
          ? remoteUrl && remoteHostname(remoteUrl) === "gitlab.com"
            ? "gitlab-saas"
            : "gitlab-self-hosted"
          : configuredProvider === "other"
            ? "custom"
            : "known-other");
    return {
      provider: configuredProvider,
      providerKind: configuredKind,
      confidence: "high",
      evidence: [{ source: "configuration", value: ".cursor/agent-kit.config.json#git.provider" }],
    };
  }
  if (!remoteUrl) {
    return { providerKind: "unknown", confidence: "low", evidence: [] };
  }

  const hostname = remoteHostname(remoteUrl);
  const remoteEvidence: DetectionEvidence[] = [{ source: "git", value: `remote:${remoteUrl}` }];
  if (hostname === "github.com") {
    return {
      provider: "github",
      providerKind: "github",
      confidence: "high",
      evidence: remoteEvidence,
    };
  }
  if (hostname === "gitlab.com") {
    return {
      provider: "gitlab",
      providerKind: "gitlab-saas",
      confidence: "high",
      evidence: remoteEvidence,
    };
  }
  if (hostname === "bitbucket.org") {
    return {
      provider: "bitbucket",
      providerKind: "known-other",
      confidence: "high",
      evidence: remoteEvidence,
    };
  }
  if (hostname === "dev.azure.com" || hostname?.endsWith(".visualstudio.com")) {
    return {
      provider: "azure-devops",
      providerKind: "known-other",
      confidence: "high",
      evidence: remoteEvidence,
    };
  }
  if (hostname === "codeberg.org") {
    return {
      provider: "gitea",
      providerKind: "known-other",
      confidence: "high",
      evidence: remoteEvidence,
    };
  }

  if (await fileExists(path.join(rootDir, ".gitlab-ci.yml"))) {
    return {
      provider: "gitlab",
      providerKind: "gitlab-self-hosted",
      confidence: "medium",
      evidence: [...remoteEvidence, { source: "file", value: ".gitlab-ci.yml" }],
    };
  }
  return {
    provider: "other",
    providerKind: hostname ? "custom" : "unknown",
    confidence: "low",
    evidence: remoteEvidence,
  };
}

function inferWorkflow(currentBranch?: string): GitWorkflow {
  if (!currentBranch) return "unknown";
  if (currentBranch === "main" || currentBranch === "master") return "feature-pr";
  if (currentBranch.includes("develop") || currentBranch.includes("release")) return "gitflow";
  if (currentBranch.includes("staging") || currentBranch.includes("homolog")) return "homolog-prod";
  return "feature-pr";
}

async function runGit(args: string[], rootDir: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", args, { cwd: rootDir });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

export async function listTrackedFiles(rootDir: string): Promise<string[]> {
  return (await runGit(["ls-files"], rootDir))?.split("\n").filter(Boolean) ?? [];
}

export async function detectGit(rootDir: string): Promise<GitDetection> {
  const isGit = (await runGit(["rev-parse", "--is-inside-work-tree"], rootDir)) === "true";
  if (!isGit) {
    return {
      providerKind: "unknown",
      providerConfidence: "low",
      providerEvidence: [],
      remotes: [],
      mode: "none",
      workflow: "unknown",
      isDirty: false,
      hasLocalStaging: false,
      hasRemoteStaging: false,
    };
  }

  const remoteNames = (await runGit(["remote"], rootDir))?.split("\n").filter(Boolean) ?? [];
  const remotes = (
    await Promise.all(
      remoteNames.map(async (name) => {
        const url = await runGit(["remote", "get-url", name], rootDir);
        return url ? { name, url: sanitizeRemoteUrl(url) } : undefined;
      }),
    )
  ).filter((remote): remote is { name: string; url: string } => remote !== undefined);
  const primary = remotes.find((remote) => remote.name === "origin") ?? remotes[0];
  const remoteUrl = primary?.url;
  const [currentBranch, remoteHead, localBranchOutput, remoteBranchOutput, status, provider] =
    await Promise.all([
      runGit(["branch", "--show-current"], rootDir),
      primary
        ? runGit(["symbolic-ref", "--short", `refs/remotes/${primary.name}/HEAD`], rootDir)
        : Promise.resolve(undefined),
      runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], rootDir),
      runGit(["for-each-ref", "--format=%(refname:short)", "refs/remotes"], rootDir),
      runGit(["status", "--porcelain"], rootDir),
      detectProvider(rootDir, remoteUrl),
    ]);
  const localBranches = localBranchOutput?.split("\n").filter(Boolean);
  const remoteBranches = remoteBranchOutput?.split("\n").filter(Boolean);
  const defaultBranch =
    remoteHead?.split("/").slice(1).join("/") ||
    (localBranches?.includes("main")
      ? "main"
      : localBranches?.includes("master")
        ? "master"
        : undefined);

  return {
    provider: provider.provider,
    providerKind: provider.providerKind,
    providerConfidence: provider.confidence,
    providerEvidence: provider.evidence,
    remoteUrl,
    remoteName: primary?.name,
    remotes,
    mode: remotes.length > 0 ? "remote-hosted" : "local-only",
    currentBranch,
    defaultBranch,
    isDirty: Boolean(status),
    hasLocalStaging: localBranches?.includes("staging") ?? false,
    hasRemoteStaging:
      remoteBranches?.some(
        (branch) => branch === "origin/staging" || branch.endsWith("/staging"),
      ) ?? false,
    workflow: inferWorkflow(currentBranch),
  };
}
