import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { CiPlatform, InfraDetection } from "../types.js";
import { CI_PLATFORM_FILES } from "../types.js";
import { fileExists } from "../utils/fs.js";

/**
 * Regex-only `run:` step extraction from GitHub Actions workflow YAML (no
 * YAML dependency; ADR 2026-08-27 locks the dep set). Reads a repeatable
 * validation command straight out of CI, so a repo whose CI already runs
 * `dart analyze` / `pytest` / etc. is not forced into a manual
 * `document-validation` action just because the scanner's own
 * language-specific command list came back empty
 * (dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md,
 * defect 5). Evidence only — this never executes a command.
 */
function extractRunCommands(yaml: string): string[] {
  const lines = yaml.split(/\r?\n/);
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, indent = "", inline = ""] = match;
    const trimmedInline = inline.trim();
    if (trimmedInline && !/^[|>][+-]?$/.test(trimmedInline)) {
      // `run: <command>` on one line.
      commands.push(trimmedInline.replace(/^['"]|['"]$/g, ""));
      continue;
    }
    // Block scalar (`run: |` / `run: >`): collect indented lines until dedent.
    const blockIndent = indent.length;
    for (let j = i + 1; j < lines.length; j++) {
      const blockLine = lines[j] ?? "";
      if (!blockLine.trim()) continue;
      const lineIndent = blockLine.length - blockLine.trimStart().length;
      if (lineIndent <= blockIndent) break;
      commands.push(blockLine.trim());
    }
  }
  return Array.from(new Set(commands));
}

async function detectCiRunCommands(rootDir: string): Promise<string[]> {
  const workflowsDir = path.join(rootDir, ".github", "workflows");
  if (!(await fileExists(workflowsDir))) return [];
  let entries: string[];
  try {
    entries = await readdir(workflowsDir);
  } catch {
    return [];
  }
  const workflowFiles = entries.filter((name) => /\.ya?ml$/.test(name));
  const perFile = await Promise.all(
    workflowFiles.map(async (name) => {
      try {
        return extractRunCommands(await readFile(path.join(workflowsDir, name), "utf8"));
      } catch {
        return [];
      }
    }),
  );
  return Array.from(new Set(perFile.flat()));
}

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

  const ciRunCommands = ci === "github-actions" ? await detectCiRunCommands(rootDir) : [];

  return { docker, kubernetes, ci, ciFiles, infrastructureFiles, deploymentFiles, ciRunCommands };
}
