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
  for (const [platform, filePath] of Object.entries(CI_PLATFORM_FILES)) {
    if (await fileExists(path.join(rootDir, filePath))) {
      ci = platform as CiPlatform;
      break;
    }
  }

  return { docker, kubernetes, ci };
}
