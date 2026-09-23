import type { Dirent } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { DetectionEvidence, PackageManager, StackDetection } from "../types.js";
import { fileExists, readJson } from "../utils/fs.js";
import { REPOSITORY_PROFILE_REL } from "./paths.js";

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
  "pubspec.yaml",
];

/**
 * Directory names skipped when scanning one level of subdirectories for
 * markers (dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md,
 * defect 2). Deliberately narrow: this is not a general ignore list, only the
 * names that would otherwise produce a false-positive marker hit or a very
 * large scan (a vendored `node_modules` or `.dart_tool` can itself contain a
 * `package.json` / `pubspec.yaml`).
 */
const SUBDIR_SCAN_SKIP = new Set(["node_modules", ".git", "build", ".dart_tool"]);

interface SubdirMarkerHit {
  /** Directory name, relative to rootDir (one level deep only). */
  dir: string;
  marker: string;
}

async function scanSubdirectoryMarkers(rootDir: string): Promise<SubdirMarkerHit[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !SUBDIR_SCAN_SKIP.has(entry.name))
    .map((entry) => entry.name);

  const candidates = dirs.flatMap((dir) => PROJECT_MARKERS.map((marker) => ({ dir, marker })));
  const found = await Promise.all(
    candidates.map(async (candidate) => {
      const exists = await fileExists(path.join(rootDir, candidate.dir, candidate.marker));
      return exists ? candidate : null;
    }),
  );
  return found.filter((hit): hit is SubdirMarkerHit => hit !== null);
}

function isFlutterPubspec(content: string): boolean {
  return /^\s*flutter:\s*$/m.test(content) || /sdk:\s*flutter\b/.test(content);
}

const DART_VALIDATION_COMMANDS = [
  "dart analyze --fatal-infos",
  "dart format --output=none --set-exit-if-changed .",
];

/** Reads one directory's `pubspec.yaml` and classifies it dart vs flutter. */
async function detectDartFlavor(pubspecDir: string): Promise<{ isFlutter: boolean }> {
  let content = "";
  try {
    content = await readFile(path.join(pubspecDir, "pubspec.yaml"), "utf8");
  } catch {
    // Existence was already confirmed by the caller; an unreadable file
    // degrades to the dart default rather than failing the scan.
  }
  return { isFlutter: isFlutterPubspec(content) };
}

/**
 * Builds a `StackDetection` from one-level-deep subdirectory marker hits
 * (root itself has no marker). Reports `workspaces: true` and lists each
 * member path as evidence so `purpose` stops defaulting to `documentation`
 * on a repo whose packages live under subdirectories with no root manifest.
 */
async function detectStackFromSubdirHits(
  rootDir: string,
  hits: SubdirMarkerHit[],
): Promise<StackDetection> {
  const packageManagerEvidence: DetectionEvidence[] = hits.map((hit) => ({
    source: "file",
    value: `${hit.dir}/${hit.marker}`,
  }));

  const dartHits = hits.filter((hit) => hit.marker === "pubspec.yaml");
  if (dartHits.length > 0) {
    const flavors = await Promise.all(
      dartHits.map((hit) => detectDartFlavor(path.join(rootDir, hit.dir))),
    );
    const testCommands = Array.from(
      new Set(flavors.map((flavor) => (flavor.isFlutter ? "flutter test" : "dart test"))),
    );
    return {
      language: "dart",
      framework: flavors.some((flavor) => flavor.isFlutter) ? "flutter" : "dart",
      workspaces: true,
      testCommands,
      validationCommands: DART_VALIDATION_COMMANDS,
      hasProjectFiles: true,
      packageManagerEvidence,
    };
  }

  const nodeHit = hits.find((hit) => hit.marker === "package.json");
  if (nodeHit) {
    const subRoot = path.join(rootDir, nodeHit.dir);
    const packageJson = (await readJson<PackageJson>(path.join(subRoot, "package.json"))) ?? {};
    const scripts = packageJson.scripts ?? {};
    const packageManager = await detectPackageManager(subRoot, packageJson);
    const commands = commandsForScripts(scripts, packageManager.packageManager);
    return {
      language: "node",
      framework: "node",
      packageManager: packageManager.packageManager,
      packageManagerEvidence: [...packageManagerEvidence, ...packageManager.evidence],
      scripts,
      workspaces: true,
      ...commands,
      hasProjectFiles: true,
    };
  }

  const languageByMarker: Array<{
    marker: string;
    language: string;
    testCommands: string[];
    validationCommands: string[];
  }> = [
    { marker: "pyproject.toml", language: "python", testCommands: [], validationCommands: [] },
    { marker: "requirements.txt", language: "python", testCommands: [], validationCommands: [] },
    { marker: "go.mod", language: "go", testCommands: ["go test ./..."], validationCommands: [] },
    {
      marker: "Cargo.toml",
      language: "rust",
      testCommands: ["cargo test"],
      validationCommands: ["cargo check"],
    },
    { marker: "composer.json", language: "php", testCommands: [], validationCommands: [] },
  ];
  for (const candidate of languageByMarker) {
    if (hits.some((hit) => hit.marker === candidate.marker)) {
      return {
        language: candidate.language,
        framework: candidate.language,
        workspaces: true,
        testCommands: candidate.testCommands,
        validationCommands: candidate.validationCommands,
        hasProjectFiles: true,
        packageManagerEvidence,
      };
    }
  }

  // A marker matched (Gemfile, pom.xml, build.gradle, pnpm-workspace.yaml) with
  // no dedicated language branch at root either; report the hit honestly
  // instead of guessing a language, but still flip hasProjectFiles.
  return {
    language: "unknown",
    workspaces: true,
    testCommands: [],
    validationCommands: [],
    hasProjectFiles: true,
    packageManagerEvidence,
  };
}

const KNOWN_PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

interface StackOverrideConfiguration {
  stack?: {
    language?: unknown;
    framework?: unknown;
    testCommands?: unknown;
    validationCommands?: unknown;
    workspaces?: unknown;
    packageManager?: unknown;
    scripts?: unknown;
    packageManagerEvidence?: unknown;
  };
}

function isDetectionEvidenceArray(value: unknown): value is DetectionEvidence[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof (item as { value?: unknown }).value === "string" &&
        typeof (item as { source?: unknown }).source === "string",
    )
  );
}

/**
 * An operator can confirm a repository's stack (parity with `purpose` in
 * detect-repository.ts and `git.provider` in detect-git.ts) via
 * `.cursor/agent-kit.config.json#stack`. Once confirmed with a language and
 * at least one command, that value is the source of truth: it must not be
 * silently overwritten by the fresh scan on every `doctor` run, or the
 * operator's "this is Dart, test with `dart test`" override has no effect
 * (dogfood/cursor_stack_detection_no_dart_flutter_subdir_override_2026_09_15.md,
 * defect 3).
 *
 * The confirmed value is a full `StackDetection`, not just language and
 * commands: it must carry `packageManager`, `scripts` and any recorded
 * `packageManagerEvidence` straight through, or a scanner-populated profile
 * (e.g. `createProfile` in safe-fixes.ts writes the full `scan.stack` back to
 * this same file) silently drops `packageManager` on its very next
 * `--refresh-profile`, the same class of loss `readConfirmedPurpose` avoids
 * by round-tripping `categories`/`evidence`.
 */
async function readConfirmedStack(rootDir: string): Promise<StackDetection | undefined> {
  const configuration = await readJson<StackOverrideConfiguration>(
    path.join(rootDir, REPOSITORY_PROFILE_REL),
  );
  const configured = configuration?.stack;
  const language = configured?.language;
  if (!configured || typeof language !== "string" || !language || language === "unknown") {
    return undefined;
  }
  const testCommands = Array.isArray(configured.testCommands)
    ? configured.testCommands.filter((item): item is string => typeof item === "string")
    : [];
  const validationCommands = Array.isArray(configured.validationCommands)
    ? configured.validationCommands.filter((item): item is string => typeof item === "string")
    : [];
  if (testCommands.length === 0 && validationCommands.length === 0) return undefined;

  const packageManager =
    typeof configured.packageManager === "string" &&
    (KNOWN_PACKAGE_MANAGERS as readonly string[]).includes(configured.packageManager)
      ? (configured.packageManager as PackageManager)
      : undefined;
  const scripts =
    configured.scripts &&
    typeof configured.scripts === "object" &&
    !Array.isArray(configured.scripts)
      ? (configured.scripts as Record<string, string>)
      : undefined;
  const packageManagerEvidence: DetectionEvidence[] = isDetectionEvidenceArray(
    configured.packageManagerEvidence,
  )
    ? configured.packageManagerEvidence
    : [{ source: "configuration", value: `${REPOSITORY_PROFILE_REL}#stack.language` }];

  return {
    language,
    framework: typeof configured.framework === "string" ? configured.framework : undefined,
    packageManager,
    scripts,
    workspaces: configured.workspaces === true,
    testCommands,
    validationCommands,
    hasProjectFiles: true,
    packageManagerEvidence,
  };
}

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
  const confirmed = await readConfirmedStack(rootDir);
  if (confirmed) return confirmed;

  const hasAnyProjectMarker = (
    await Promise.all(PROJECT_MARKERS.map((item) => fileExists(path.join(rootDir, item))))
  ).some(Boolean);

  if (!hasAnyProjectMarker) {
    const subdirHits = await scanSubdirectoryMarkers(rootDir);
    if (subdirHits.length > 0) {
      return detectStackFromSubdirHits(rootDir, subdirHits);
    }
  }

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
  if (await fileExists(path.join(rootDir, "pubspec.yaml"))) {
    const { isFlutter } = await detectDartFlavor(rootDir);
    return {
      language: "dart",
      framework: isFlutter ? "flutter" : "dart",
      workspaces: false,
      testCommands: [isFlutter ? "flutter test" : "dart test"],
      validationCommands: DART_VALIDATION_COMMANDS,
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
