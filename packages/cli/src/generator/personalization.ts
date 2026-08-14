import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import { allPacks, allSkills } from "../registry/client.js";
import {
  installPack,
  installSkill,
  loadPackManifest,
  packMemberTargets,
} from "../registry/install.js";
import type { RegistryIndex } from "../registry/types.js";
import { detectIde } from "../scanner/detect-ide.js";
import type {
  DetectionEvidence,
  GitDetection,
  ProjectProfile,
  ReadinessReport,
  RepositoryProfile,
  RepositoryPurpose,
} from "../types.js";
import { ensureDir, fileExists, writeJson } from "../utils/fs.js";
import { generateClaudeKitLoadArtifacts } from "./claude-kit-load.js";
import { generateVSCodeArtifacts } from "./vscode.js";

export const PERSONALIZATION_CONTRACT_VERSION = 1 as const;

export type PersonalizationStatus =
  | "applied"
  | "skipped-customized"
  | "recommended-confirmation"
  | "unavailable";

export type PersonalizationKind = "command" | "pack" | "skill" | "agent" | "file";

export interface PersonalizationItem {
  kind: PersonalizationKind;
  id: string;
  status: PersonalizationStatus;
  evidence: DetectionEvidence[];
  path?: string;
}

export interface PersonalizationResult {
  contractVersion: typeof PERSONALIZATION_CONTRACT_VERSION;
  generatorVersion: string;
  repositoryFingerprint: string;
  items: PersonalizationItem[];
  protectedPaths: string[];
}

const CONTEXT_PATH = ".cursor/project-context.md";
const AGENTS_PATH = "AGENTS.md";
const RESULT_PATH = ".cursor/context/personalization.json";

function uniqueEvidence(evidence: DetectionEvidence[]): DetectionEvidence[] {
  const seen = new Set<string>();
  return evidence.filter((item) => {
    const key = `${item.source}:${item.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function purposeEvidence(profile: RepositoryProfile): DetectionEvidence[] {
  if (profile.purpose.confidence === "low") return [];
  return profile.purpose.evidence;
}

function contextEvidence(profile: RepositoryProfile, pattern: RegExp): DetectionEvidence[] {
  return profile.context.sources.filter((item) => pattern.test(item.value));
}

function readinessEvidence(report: ReadinessReport, checkId: string): DetectionEvidence[] {
  return report.pillars
    .flatMap((pillar) => pillar.checks)
    .filter((check) => check.id === checkId)
    .flatMap((check) => check.evidence);
}

function hasPurpose(profile: RepositoryProfile, purposes: RepositoryPurpose[]): boolean {
  return purposes.some(
    (purpose) => profile.purpose.value === purpose || profile.purpose.categories.includes(purpose),
  );
}

function candidate(
  kind: PersonalizationKind,
  id: string,
  evidence: DetectionEvidence[],
  status: PersonalizationStatus,
): PersonalizationItem | null {
  const verified = uniqueEvidence(evidence);
  return verified.length > 0 ? { kind, id, status, evidence: verified } : null;
}

function componentAvailable(index: RegistryIndex, item: PersonalizationItem): boolean {
  if (item.kind === "skill") return allSkills(index).some((entry) => entry.id === item.id);
  if (item.kind === "pack") return allPacks(index).some((entry) => entry.id === item.id);
  if (item.kind === "agent" || item.kind === "command") {
    return (index.artifacts ?? []).some(
      (entry) => entry.kind === item.kind && entry.id === item.id,
    );
  }
  return true;
}

export function buildPersonalizationPlan(
  profile: RepositoryProfile,
  report: ReadinessReport,
  registry: RegistryIndex,
): PersonalizationItem[] {
  const items: Array<PersonalizationItem | null> = [];
  const purpose = purposeEvidence(profile);
  const packageEvidence = profile.stack.packageManagerEvidence ?? [];
  const n8nEvidence = [
    ...contextEvidence(profile, /(^|[/.-])n8n([/.-]|$)/i),
    ...purpose.filter((item) => /n8n/i.test(item.value)),
  ];
  const sqlEvidence = [
    ...contextEvidence(profile, /(^|[/.-])(sql|schema|migration)([/.-]|$)/i),
    ...purpose.filter((item) => /\bsql\b/i.test(item.value)),
  ];
  const promptEvidence = contextEvidence(profile, /(^|[/.-])prompts?([/.-]|$)/i);
  const ciEvidence = profile.infra.ciFiles.map((value) => ({ source: "file", value }) as const);
  const infraEvidence = [
    ...ciEvidence,
    ...profile.infra.infrastructureFiles.map((value) => ({ source: "file", value }) as const),
    ...profile.infra.deploymentFiles.map((value) => ({ source: "file", value }) as const),
  ];

  if (hasPurpose(profile, ["documentation", "knowledge"])) {
    items.push(candidate("skill", "docs-repo", purpose, "applied"));
  }
  if (profile.stack.language.toLowerCase() === "node" && packageEvidence.length > 0) {
    items.push(candidate("skill", "cursor-skills-node", packageEvidence, "applied"));
  }
  if (n8nEvidence.length > 0) {
    items.push(candidate("skill", "n8n-workflows", n8nEvidence, "applied"));
  } else if (hasPurpose(profile, ["automation"])) {
    items.push(candidate("skill", "n8n-workflows", purpose, "recommended-confirmation"));
  }
  if (sqlEvidence.length > 0) {
    items.push(candidate("skill", "sql-postgres", sqlEvidence, "applied"));
  } else if (profile.services.database?.toLowerCase().includes("postgres")) {
    items.push(
      candidate(
        "skill",
        "sql-postgres",
        [{ source: "configuration", value: `database:${profile.services.database}` }],
        "recommended-confirmation",
      ),
    );
  }
  if (promptEvidence.length > 0) {
    items.push(candidate("skill", "prompts-markdown", promptEvidence, "applied"));
  }
  if (infraEvidence.length > 0) {
    items.push(candidate("pack", "devops", infraEvidence, "applied"));
  }
  if (profile.stack.testCommands.length > 0 && packageEvidence.length > 0) {
    items.push(candidate("pack", "quality", packageEvidence, "applied"));
    items.push(candidate("agent", "test-suites", packageEvidence, "applied"));
  }

  const pmTools = (profile.services.projectManagement ?? []).filter((tool) => tool !== "none");
  if (pmTools.length > 0) {
    items.push(
      candidate(
        "pack",
        "project-management",
        pmTools.map((tool) => ({ source: "configuration", value: `projectManagement:${tool}` })),
        "recommended-confirmation",
      ),
    );
  }

  const safetyEvidence = readinessEvidence(report, "safety.secrets").filter((item) =>
    item.value.startsWith("tracked:"),
  );
  if (safetyEvidence.length > 0) {
    items.push(candidate("pack", "cybersec", safetyEvidence, "recommended-confirmation"));
  }
  items.push(
    candidate(
      "command",
      "start-project",
      readinessEvidence(report, "agent-kit.context"),
      "applied",
    ),
  );

  const availableItems = items.filter((item): item is PersonalizationItem => item !== null);
  return availableItems
    .map((item) =>
      componentAvailable(registry, item) ? item : { ...item, status: "unavailable" as const },
    )
    .sort((left, right) => `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`));
}

function renderProjectContext(profile: RepositoryProfile): string {
  const sections: string[] = ["# Project Context", "", "Verified repository facts:"];
  const purpose = purposeEvidence(profile);
  if (purpose.length > 0 && profile.purpose.value !== "unknown") {
    sections.push(`- Purpose: ${profile.purpose.value}.`);
  }
  const packageEvidence = profile.stack.packageManagerEvidence ?? [];
  if (packageEvidence.length > 0) {
    sections.push(`- Runtime family: ${profile.stack.language}.`);
    if (profile.stack.packageManager) {
      sections.push(`- Package manager: ${profile.stack.packageManager}.`);
    }
  }
  if (profile.git.provider && (profile.git.providerEvidence?.length ?? 0) > 0) {
    sections.push(`- Git provider: ${profile.git.provider}.`);
  }
  if (profile.infra.ci !== "none" && profile.infra.ciFiles.length > 0) {
    sections.push(`- CI: ${profile.infra.ci}.`);
  }
  sections.push(
    "",
    "## Relevant skills",
    "",
    "Installed and project-owned skills for this repository. Prefer `.cursor/agent-kit.json` `skills[]` as the install index; project-only domain skills may live under `.cursor/skills/domain/`.",
    "",
    "| Skill / path | Role | Evidence |",
    "|--------------|------|----------|",
    "| (none yet) | Add rows when `/agent-kit-onboard` scaffolds domain skills or personalization installs packs | — |",
  );
  if (profile.context.sources.length > 0) {
    sections.push("", "## Sources", ...profile.context.sources.map((item) => `- ${item.value}`));
  }
  return `${sections.join("\n")}\n`;
}

async function createOwnedFile(
  rootDir: string,
  relativePath: string,
  content: string,
  evidence: DetectionEvidence[],
): Promise<PersonalizationItem> {
  const target = path.join(rootDir, relativePath);
  if (await fileExists(target)) {
    return {
      kind: "file",
      id: relativePath,
      path: relativePath,
      status: "skipped-customized",
      evidence,
    };
  }
  await ensureDir(path.dirname(target));
  await writeFile(target, content, "utf8");
  return {
    kind: "file",
    id: relativePath,
    path: relativePath,
    status: "applied",
    evidence,
  };
}

async function packTargets(registryRoot: string, packId: string): Promise<string[]> {
  const manifest = await loadPackManifest(registryRoot, packId);
  return manifest.members.map((member) => packMemberTargets(member).targetRel);
}

async function existingTargets(projectRoot: string, targets: string[]): Promise<string[]> {
  const checks = await Promise.all(
    targets.map(async (target) =>
      (await fileExists(path.join(projectRoot, target))) ? target : null,
    ),
  );
  return checks.filter((target): target is string => target !== null);
}

export async function applyPersonalization(input: {
  rootDir: string;
  registryRoot: string;
  profile: RepositoryProfile;
  report: ReadinessReport;
  registry: RegistryIndex;
  manifest: AgentKitManifest;
  generatorVersion: string;
}): Promise<{ result: PersonalizationResult; manifest: AgentKitManifest }> {
  const planned = buildPersonalizationPlan(input.profile, input.report, input.registry);
  const componentResults: PersonalizationItem[] = [];
  const protectedPaths = new Set(input.manifest.protected ?? []);
  const packs = new Set(input.manifest.packs ?? []);
  const skills = new Set(input.manifest.skills ?? []);

  for (const item of planned) {
    if (item.status !== "applied") {
      componentResults.push(item);
      continue;
    }
    if (item.kind === "skill") {
      const skill = allSkills(input.registry).find((entry) => entry.id === item.id);
      if (!skill) {
        componentResults.push({ ...item, status: "unavailable" });
        continue;
      }
      const target = path.posix.join(
        ".cursor",
        "skills",
        skill.path.includes("/core/") ? "core" : "community",
        skill.id,
        "SKILL.md",
      );
      if (await fileExists(path.join(input.rootDir, target))) {
        componentResults.push({ ...item, status: "skipped-customized", path: target });
        protectedPaths.add(target);
        continue;
      }
      await installSkill(input.registryRoot, input.rootDir, skill);
      skills.add(item.id);
      protectedPaths.add(target);
      componentResults.push({ ...item, path: target });
      continue;
    }
    if (item.kind === "pack") {
      const targets = await packTargets(input.registryRoot, item.id);
      const customizedTargets = await existingTargets(input.rootDir, targets);
      await installPack(input.registryRoot, input.rootDir, item.id, {
        protectedGlobs: customizedTargets,
      });
      for (const target of targets) protectedPaths.add(target);
      packs.add(item.id);
      componentResults.push(
        customizedTargets.length > 0 ? { ...item, status: "skipped-customized" } : item,
      );
      continue;
    }
    componentResults.push(item);
  }

  const profileEvidence = uniqueEvidence([
    ...purposeEvidence(input.profile),
    ...(input.profile.stack.packageManagerEvidence ?? []),
    ...(input.profile.git.providerEvidence ?? []),
    ...input.profile.context.sources,
  ]);
  const fileResults = await Promise.all([
    createOwnedFile(
      input.rootDir,
      CONTEXT_PATH,
      renderProjectContext(input.profile),
      profileEvidence,
    ),
    createOwnedFile(
      input.rootDir,
      AGENTS_PATH,
      "# Repository Agent Guidance\n\nUse `.cursor/project-context.md` for verified repository facts. Preserve existing project-owned guidance and request confirmation before adding optional integrations.\n",
      profileEvidence,
    ),
  ]);
  protectedPaths.add(CONTEXT_PATH);
  protectedPaths.add(AGENTS_PATH);

  const claudeResults = await generateClaudeKitLoadArtifacts(input.rootDir);
  const claudeItems = claudeResults.map((artifact) => {
    protectedPaths.add(artifact.relativePath);
    return {
      kind: "file" as const,
      id: artifact.relativePath,
      path: artifact.relativePath,
      status: artifact.status,
      evidence: profileEvidence,
    };
  });

  const ideDetection = await detectIde(input.rootDir);
  if (ideDetection.ide === "vscode" || ideDetection.ide === "other") {
    const git: GitDetection = {
      providerKind: input.profile.git.providerKind ?? "unknown",
      providerConfidence: input.profile.git.providerConfidence ?? "low",
      providerEvidence: input.profile.git.providerEvidence ?? [],
      remotes: input.profile.git.remotes ?? [],
      mode: input.profile.git.mode ?? "none",
      workflow: input.profile.git.workflow ?? "unknown",
      isDirty: input.profile.git.isDirty ?? false,
      hasLocalStaging: input.profile.git.hasLocalStaging ?? false,
      hasRemoteStaging: input.profile.git.hasRemoteStaging ?? false,
      provider: input.profile.git.provider,
      remoteUrl: input.profile.git.remoteUrl,
      remoteName: input.profile.git.remoteName,
      currentBranch: input.profile.git.currentBranch,
      defaultBranch: input.profile.git.defaultBranch,
    };
    const projectProfile: ProjectProfile = {
      rootDir: input.rootDir,
      stack: input.profile.stack,
      git,
      ide: ideDetection,
      infra: input.profile.infra,
      services: input.profile.services,
      installHooks: false,
      selectedCoreComponents: [],
    };
    const vscodeResults = await generateVSCodeArtifacts(projectProfile);
    const ideEvidence: DetectionEvidence[] = [
      { source: "derived", value: `ide:${ideDetection.ide}` },
    ];
    for (const artifact of vscodeResults) {
      protectedPaths.add(artifact.relativePath);
      componentResults.push({
        kind: "file",
        id: artifact.relativePath,
        path: artifact.relativePath,
        status: artifact.status,
        evidence: ideEvidence,
      });
    }
  }

  const result: PersonalizationResult = {
    contractVersion: PERSONALIZATION_CONTRACT_VERSION,
    generatorVersion: input.generatorVersion,
    repositoryFingerprint: input.report.repositoryFingerprint,
    items: [...fileResults, ...claudeItems, ...componentResults],
    protectedPaths: [...protectedPaths].sort(),
  };
  await writeJson(path.join(input.rootDir, RESULT_PATH), result);

  return {
    result,
    manifest: {
      ...input.manifest,
      packs: [...packs].sort(),
      skills: [...skills].sort(),
      protected: result.protectedPaths,
      personalization: {
        contractVersion: PERSONALIZATION_CONTRACT_VERSION,
        generatorVersion: input.generatorVersion,
        origin: "repository-profile",
        resultPath: RESULT_PATH,
      },
    },
  };
}

export async function readRepositoryProfile(rootDir: string): Promise<RepositoryProfile | null> {
  const target = path.join(rootDir, ".cursor/agent-kit.config.json");
  if (!(await fileExists(target))) return null;
  return JSON.parse(await readFile(target, "utf8")) as RepositoryProfile;
}
