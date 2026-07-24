import path from "node:path";
import type { CiPlatform, InfraDetection } from "../types.js";
import { CI_PLATFORM_FILES } from "../types.js";
import { fileExists } from "../utils/fs.js";

export async function detectInfra(rootDir: string): Promise<InfraDetection> {
  const docker =
    (await fileExists(path.join(rootDir, "Dockerfile"))) ||
    (await fileExists(path.join(rootDir, "docker-compose.yml"))) ||
    (await fileExists(path.join(rootDir, "docker-compose.yaml")));
  const kubernetes =
    (await fileExists(path.join(rootDir, "k8s"))) ||
    (await fileExists(path.join(rootDir, "kubernetes")));

  let ci: CiPlatform = "none";
  const ciFiles: string[] = [];
  for (const [platform, filePath] of Object.entries(CI_PLATFORM_FILES)) {
    if (await fileExists(path.join(rootDir, filePath))) {
      if (ci === "none") ci = platform as CiPlatform;
      ciFiles.push(filePath);
    }
  }

  const infrastructureCandidates = [
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    "k8s",
    "kubernetes",
    "terraform",
    "infra",
  ];
  const deploymentCandidates = [
    "vercel.json",
    "netlify.toml",
    "fly.toml",
    "render.yaml",
    "Procfile",
    "deploy",
    "scripts/deploy.sh",
  ];
  const infrastructureFiles = (
    await Promise.all(
      infrastructureCandidates.map(async (file) =>
        (await fileExists(path.join(rootDir, file))) ? file : undefined,
      ),
    )
  ).filter((file): file is string => file !== undefined);
  const deploymentFiles = (
    await Promise.all(
      deploymentCandidates.map(async (file) =>
        (await fileExists(path.join(rootDir, file))) ? file : undefined,
      ),
    )
  ).filter((file): file is string => file !== undefined);

  return { docker, kubernetes, ci, ciFiles, infrastructureFiles, deploymentFiles };
}
