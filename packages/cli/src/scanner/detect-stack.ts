import path from "node:path";
import type { StackDetection } from "../types.js";
import { fileExists } from "../utils/fs.js";

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
];

export async function detectStack(rootDir: string): Promise<StackDetection> {
  const hasAnyProjectMarker = (
    await Promise.all(PROJECT_MARKERS.map((item) => fileExists(path.join(rootDir, item))))
  ).some(Boolean);

  const hasPackageJson = await fileExists(path.join(rootDir, "package.json"));
  if (hasPackageJson) {
    const hasNextConfig =
      (await fileExists(path.join(rootDir, "next.config.js"))) ||
      (await fileExists(path.join(rootDir, "next.config.mjs"))) ||
      (await fileExists(path.join(rootDir, "next.config.ts")));
    const hasNestConfig = await fileExists(path.join(rootDir, "nest-cli.json"));
    return {
      language: "node",
      framework: hasNextConfig ? "nextjs" : hasNestConfig ? "nestjs" : "node",
      packageManager: "pnpm",
      hasProjectFiles: hasAnyProjectMarker,
    };
  }

  if (await fileExists(path.join(rootDir, "pyproject.toml"))) {
    return { language: "python", framework: "python", hasProjectFiles: hasAnyProjectMarker };
  }
  if (await fileExists(path.join(rootDir, "go.mod"))) {
    return { language: "go", framework: "go", hasProjectFiles: hasAnyProjectMarker };
  }
  if (await fileExists(path.join(rootDir, "Cargo.toml"))) {
    return { language: "rust", framework: "rust", hasProjectFiles: hasAnyProjectMarker };
  }
  if (await fileExists(path.join(rootDir, "composer.json"))) {
    return { language: "php", framework: "php", hasProjectFiles: hasAnyProjectMarker };
  }

  return { language: "unknown", hasProjectFiles: hasAnyProjectMarker };
}
