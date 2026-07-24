import path from "node:path";
import type { DetectionEvidence, PackageManager, StackDetection } from "../types.js";
import { fileExists, readJson } from "../utils/fs.js";

const PROJECT_MARKERS = [
  "package.json",
  "requirements.txt",
  "pyproject.toml",
  "go.mod",
  "Gemfile",
  "pom.xml",
  "build.gradle",
  "composer.json",
  "Cargo.toml",
  "pnpm-workspace.yaml",
];

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  workspaces?: unknown;
}

const LOCKFILES: Array<[string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

async function detectPackageManager(
  rootDir: string,
  packageJson: PackageJson,
): Promise<{ packageManager?: PackageManager; evidence: DetectionEvidence[] }> {
  const configured = packageJson.packageManager?.split("@")[0];
  if (configured && ["npm", "pnpm", "yarn", "bun"].includes(configured)) {
    return {
      packageManager: configured as PackageManager,
      evidence: [{ source: "configuration", value: `package.json#packageManager=${configured}` }],
    };
  }

  for (const [lockfile, packageManager] of LOCKFILES) {
    if (await fileExists(path.join(rootDir, lockfile))) {
      return {
        packageManager,
        evidence: [{ source: "file", value: lockfile }],
      };
    }
  }
  return { evidence: [] };
}

function commandsForScripts(scripts: Record<string, string>, packageManager?: PackageManager) {
  const runner = packageManager ?? "npm";
  const command = (name: string) => (runner === "npm" ? `npm run ${name}` : `${runner} ${name}`);
  const testCommands = Object.keys(scripts)
    .filter((name) => name === "test" || name.startsWith("test:"))
    .map(command);
  const validationCommands = ["lint", "typecheck", "check", "build"]
    .filter((name) => scripts[name])
    .map(command);
  return { testCommands, validationCommands };
}

export async function detectStack(rootDir: string): Promise<StackDetection> {
  const hasAnyProjectMarker = (
    await Promise.all(PROJECT_MARKERS.map((item) => fileExists(path.join(rootDir, item))))
  ).some(Boolean);

  const hasPackageJson = await fileExists(path.join(rootDir, "package.json"));
  if (hasPackageJson) {
    const packageJson = (await readJson<PackageJson>(path.join(rootDir, "package.json"))) ?? {};
    const scripts = packageJson.scripts ?? {};
    const packageManager = await detectPackageManager(rootDir, packageJson);
    const commands = commandsForScripts(scripts, packageManager.packageManager);
    const hasNextConfig =
      (await fileExists(path.join(rootDir, "next.config.js"))) ||
      (await fileExists(path.join(rootDir, "next.config.mjs"))) ||
      (await fileExists(path.join(rootDir, "next.config.ts")));
    const hasNestConfig = await fileExists(path.join(rootDir, "nest-cli.json"));
    return {
      language: "node",
      framework: hasNextConfig ? "nextjs" : hasNestConfig ? "nestjs" : "node",
      packageManager: packageManager.packageManager,
      packageManagerEvidence: packageManager.evidence,
      scripts,
      workspaces:
        packageJson.workspaces !== undefined ||
        (await fileExists(path.join(rootDir, "pnpm-workspace.yaml"))),
      ...commands,
      hasProjectFiles: hasAnyProjectMarker,
    };
  }

  if (await fileExists(path.join(rootDir, "pyproject.toml"))) {
    return {
      language: "python",
      framework: "python",
      workspaces: false,
      testCommands: [],
      validationCommands: [],
      hasProjectFiles: hasAnyProjectMarker,
    };
  }
  if (await fileExists(path.join(rootDir, "go.mod"))) {
    return {
      language: "go",
      framework: "go",
      workspaces: false,
      testCommands: ["go test ./..."],
      validationCommands: [],
      hasProjectFiles: hasAnyProjectMarker,
    };
  }
  if (await fileExists(path.join(rootDir, "Cargo.toml"))) {
    return {
      language: "rust",
      framework: "rust",
      workspaces: false,
      testCommands: ["cargo test"],
      validationCommands: ["cargo check"],
      hasProjectFiles: hasAnyProjectMarker,
    };
  }
  if (await fileExists(path.join(rootDir, "composer.json"))) {
    return {
      language: "php",
      framework: "php",
      workspaces: false,
      testCommands: [],
      validationCommands: [],
      hasProjectFiles: hasAnyProjectMarker,
    };
  }

  return {
    language: "unknown",
    workspaces: false,
    testCommands: [],
    validationCommands: [],
    hasProjectFiles: hasAnyProjectMarker,
  };
}
