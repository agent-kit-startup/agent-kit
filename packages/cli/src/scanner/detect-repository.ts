import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AgentKitDetection,
  ContextDetection,
  DetectionEvidence,
  RepositoryPurpose,
  RepositoryPurposeDetection,
  SafetyDetection,
  StackDetection,
} from "../types.js";
import { fileExists, listDirectory, readJson } from "../utils/fs.js";

const CONTEXT_PATHS: Array<[string, string]> = [
  ["README.md", "README"],
  ["README", "README"],
  ["AGENTS.md", "agent guidance"],
  ["CLAUDE.md", "agent guidance"],
  [".cursor/rules", "Cursor rules"],
  ["docs/architecture.md", "architecture"],
  ["docs/adr", "architecture decisions"],
  ["docs/runbooks", "runbooks"],
  ["runbooks", "runbooks"],
  ["prompts", "prompts"],
  ["schemas", "schemas"],
  ["sql", "SQL"],
  ["knowledge", "knowledge base"],
];

async function existingEvidence(
  rootDir: string,
  candidates: Array<[string, string]>,
): Promise<DetectionEvidence[]> {
  const evidence = await Promise.all(
    candidates.map(async ([relativePath, label]) =>
      (await fileExists(path.join(rootDir, relativePath)))
        ? ({ source: "file", value: `${relativePath}:${label}` } satisfies DetectionEvidence)
        : undefined,
    ),
  );
  return evidence.flatMap((item) => (item ? [item] : []));
}

export async function detectContext(rootDir: string): Promise<ContextDetection> {
  const sources = await existingEvidence(rootDir, CONTEXT_PATHS);
  const paths = sources.map((item) => item.value.split(":")[0]);
  return {
    sources,
    hasReadme: paths.some((item) => item === "README" || item === "README.md"),
    hasArchitecture: sources.some((item) => item.value.includes("architecture")),
    hasRunbooks: sources.some((item) => item.value.includes("runbooks")),
    hasAgentGuidance: sources.some(
      (item) => item.value.includes("agent guidance") || item.value.includes("Cursor rules"),
    ),
  };
}

export async function detectPurpose(
  rootDir: string,
  stack: StackDetection,
): Promise<RepositoryPurposeDetection> {
  const entries = await listDirectory(rootDir);
  const lowerEntries = entries.map((entry) => entry.toLowerCase());
  const packageJson = await readJson<{
    private?: boolean;
    main?: string;
    types?: string;
    exports?: unknown;
  }>(path.join(rootDir, "package.json"));
  const categories: RepositoryPurpose[] = [];
  const evidence: DetectionEvidence[] = [];
  const add = (category: RepositoryPurpose, value: string) => {
    if (!categories.includes(category)) categories.push(category);
    evidence.push({ source: "file", value });
  };

  if (stack.workspaces) add("monorepo", "workspace configuration");
  else if (
    stack.language === "node" &&
    packageJson?.private !== true &&
    (packageJson?.exports !== undefined || packageJson?.main || packageJson?.types)
  ) {
    add("library", "package export configuration");
  } else if (stack.hasProjectFiles) add("application", "application package marker");
  if (lowerEntries.some((entry) => ["docs", "documentation", "mkdocs.yml"].includes(entry))) {
    add("documentation", "documentation structure");
  }
  if (
    lowerEntries.some((entry) =>
      ["knowledge", "content", "wiki", "playbooks", "handbook"].includes(entry),
    )
  ) {
    add("knowledge", "knowledge structure");
  }
  if (
    lowerEntries.some((entry) =>
      ["runbooks", "infra", "terraform", "ansible", "k8s", "kubernetes"].includes(entry),
    )
  ) {
    add("operations", "operations structure");
  }
  if (
    lowerEntries.some((entry) =>
      ["n8n", "workflows", "automations", "prompts", "sql", "schemas"].includes(entry),
    ) ||
    lowerEntries.some((entry) => entry.endsWith(".sql"))
  ) {
    add("automation", "automation or data artifact");
  }

  const meaningfulCategories = categories.filter((category) => category !== "unknown");
  const value =
    meaningfulCategories.length === 0
      ? "unknown"
      : meaningfulCategories.length === 1
        ? (meaningfulCategories[0] ?? "unknown")
        : "mixed";
  return {
    value,
    categories: meaningfulCategories.length > 0 ? meaningfulCategories : ["unknown"],
    confidence: evidence.length > 0 ? "high" : "low",
    evidence,
  };
}

interface AgentKitManifest {
  version?: string;
}

export async function detectAgentKit(rootDir: string): Promise<AgentKitDetection> {
  const manifestRelativePath = ".cursor/agent-kit.json";
  const manifestPath = path.join(rootDir, manifestRelativePath);
  const installed = await fileExists(manifestPath);
  const manifest = installed ? await readJson<AgentKitManifest>(manifestPath) : null;
  return {
    installed,
    manifestPath: installed ? manifestRelativePath : undefined,
    version: manifest?.version,
    hasPlans: await fileExists(path.join(rootDir, ".cursor/plans")),
    hasHandoff: await fileExists(path.join(rootDir, ".cursor/HANDOFF.md")),
    hasMemory: await fileExists(path.join(rootDir, ".cursor/memory")),
  };
}

export const REQUIRED_SECRET_PATTERNS = [
  ".env",
  ".env.*",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "*credentials*.json",
  "*service-account*.json",
] as const;

export async function detectSafety(
  rootDir: string,
  trackedFiles: string[],
): Promise<SafetyDetection> {
  const gitignorePath = path.join(rootDir, ".gitignore");
  const hasGitignore = await fileExists(gitignorePath);
  const gitignore = hasGitignore ? await readFile(gitignorePath, "utf8") : "";
  const lines = gitignore
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const ignoredSecretPatterns = REQUIRED_SECRET_PATTERNS.filter((pattern) =>
    lines.includes(pattern),
  );
  const trackedSensitiveFiles = trackedFiles.filter((file) =>
    /(^|\/)(\.env(\..+)?|.*\.(key|pem|p12|pfx)|.*credentials.*\.json)$/i.test(file),
  );
  const hookPaths = [".husky", ".git/hooks/pre-commit", "git-hooks/pre-commit"];
  const hasHooks = (
    await Promise.all(hookPaths.map((item) => fileExists(path.join(rootDir, item))))
  ).some(Boolean);
  const guardCandidates = [
    ".husky/pre-commit",
    ".husky/pre-push",
    "git-hooks/pre-commit",
    "git-hooks/pre-push",
  ];
  const guardContents = await Promise.all(
    guardCandidates.map(async (item) =>
      (await fileExists(path.join(rootDir, item)))
        ? readFile(path.join(rootDir, item), "utf8")
        : "",
    ),
  );

  return {
    hasGitignore,
    ignoredSecretPatterns,
    missingSecretPatterns: REQUIRED_SECRET_PATTERNS.filter(
      (pattern) => !ignoredSecretPatterns.includes(pattern),
    ),
    trackedSensitiveFiles,
    hasHooks,
    hasMainBranchGuard: guardContents.some(
      (content) => content.includes("main") || content.includes("master"),
    ),
  };
}
