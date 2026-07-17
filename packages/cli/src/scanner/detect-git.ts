import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { GitDetection, GitProvider, GitWorkflow } from "../types.js";
import { fileExists } from "../utils/fs.js";

const exec = promisify(execFile);

function detectProvider(remoteUrl?: string): GitProvider | undefined {
  if (!remoteUrl) return undefined;
  if (remoteUrl.includes("github")) return "github";
  if (remoteUrl.includes("gitlab")) return "gitlab";
  if (remoteUrl.includes("bitbucket")) return "bitbucket";
  if (remoteUrl.includes("dev.azure.com") || remoteUrl.includes("visualstudio.com"))
    return "azure-devops";
  if (remoteUrl.includes("gitea") || remoteUrl.includes("codeberg")) return "gitea";
  return "other";
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

export async function detectGit(rootDir: string): Promise<GitDetection> {
  const hasGit = await fileExists(path.join(rootDir, ".git"));
  if (!hasGit) return { workflow: "unknown" };

  const remoteUrl = await runGit(["remote", "get-url", "origin"], rootDir);
  const currentBranch = await runGit(["branch", "--show-current"], rootDir);

  return {
    provider: detectProvider(remoteUrl),
    remoteUrl,
    currentBranch,
    workflow: inferWorkflow(currentBranch),
  };
}
