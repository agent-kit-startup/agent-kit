import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentKitManifest } from "../manifest/types.js";
import { allSkills, loadRegistry } from "../registry/client.js";
import { loadPackManifest, packMemberTargets } from "../registry/install.js";
import { type GateIssue, gateContributeContent, gateContributePath } from "./contribute-gate.js";
import { L0_ARTIFACTS } from "./l0.js";
import { resolveContained } from "./paths.js";

export type ContributeKind = "drift" | "path";

export interface ContributeCandidate {
  kind: ContributeKind;
  projectPath: string;
  registryPath: string;
  gateOk: boolean;
  issues: GateIssue[];
}

export interface ContributePlan {
  candidates: ContributeCandidate[];
  accepted: ContributeCandidate[];
  rejected: ContributeCandidate[];
}

async function readLocal(projectRoot: string, rel: string): Promise<string | null> {
  try {
    return await readFile(resolveContained(projectRoot, rel), "utf8");
  } catch {
    return null;
  }
}

/** Build project-relative → registry-relative map for installed kit surfaces. */
export async function buildRegistryPathMap(
  registryRoot: string,
  manifest: AgentKitManifest,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  for (const a of L0_ARTIFACTS) {
    map.set(a.target.split(path.sep).join("/"), a.source.split(path.sep).join("/"));
  }

  for (const packId of manifest.packs ?? []) {
    const pack = await loadPackManifest(registryRoot, packId);
    for (const member of pack.members) {
      const { sourceRel, targetRel } = packMemberTargets(member);
      map.set(targetRel.split(path.sep).join("/"), sourceRel.split(path.sep).join("/"));
    }
  }

  if ((manifest.skills ?? []).length > 0) {
    const index = await loadRegistry(registryRoot);
    const pool = allSkills(index);
    for (const id of manifest.skills ?? []) {
      const skill = pool.find((s) => s.id === id);
      if (!skill) continue;
      const category = skill.path.includes("/core/") ? "core" : "community";
      const sourceRel = path.posix.join(skill.path, "SKILL.md");
      const targetRel = path.posix.join(".cursor", "skills", category, skill.id, "SKILL.md");
      map.set(targetRel, sourceRel);
    }
  }

  return map;
}

function guessRegistryPath(projectRel: string): string | null {
  const p = projectRel.split(path.sep).join("/");
  if (p.startsWith(".cursor/skills/") && p.endsWith("/SKILL.md")) {
    const rest = p.slice(".cursor/skills/".length);
    const parts = rest.split("/");
    // .cursor/skills/<cat>/<id>/SKILL.md → registry/skills/<cat>/<id>/SKILL.md
    if (parts.length === 3 && (parts[0] === "core" || parts[0] === "community")) {
      return path.posix.join("registry/skills", rest);
    }
    // Legacy flat: .cursor/skills/<id>/SKILL.md → community by default
    const skillId = parts[0];
    if (parts.length === 2 && skillId) {
      return path.posix.join("registry/skills", "community", skillId, "SKILL.md");
    }
  }
  if (p.startsWith(".cursor/rules/")) {
    return p;
  }
  if (p.startsWith(".cursor/commands/")) {
    return p;
  }
  if (p.startsWith(".cursor/agents/")) {
    return p;
  }
  if (p.startsWith(".cursor/hooks/")) {
    return p;
  }
  if (p.startsWith("autogit/")) {
    return p;
  }
  return null;
}

export async function planContribute(options: {
  registryRoot: string;
  projectRoot: string;
  manifest: AgentKitManifest;
  /** Extra project-relative paths (new artifacts). */
  extraPaths?: readonly string[];
  /** When true, include drifted installed artifacts from the registry map. */
  includeDrift?: boolean;
}): Promise<ContributePlan> {
  const includeDrift = options.includeDrift !== false;
  const pathMap = await buildRegistryPathMap(options.registryRoot, options.manifest);
  const candidates: ContributeCandidate[] = [];
  const seen = new Set<string>();

  const push = async (kind: ContributeKind, projectPath: string, registryPath: string) => {
    const key = projectPath.split(path.sep).join("/");
    if (seen.has(key)) return;
    seen.add(key);
    const content = await readLocal(options.projectRoot, projectPath);
    if (content === null) {
      // Not installed locally — nothing to push upstream.
      return;
    }
    if (kind === "drift") {
      try {
        const upstream = await readFile(
          resolveContained(options.registryRoot, registryPath),
          "utf8",
        );
        if (upstream === content) return; // no real drift
      } catch {
        // registry missing — still a candidate (local newer / new mapping)
      }
    }
    const gate = gateContributeContent(content, key);
    candidates.push({
      kind,
      projectPath: key,
      registryPath,
      gateOk: gate.ok,
      issues: gate.issues,
    });
  };

  if (includeDrift) {
    for (const [projectPath, registryPath] of pathMap) {
      await push("drift", projectPath, registryPath);
    }
  }

  for (const raw of options.extraPaths ?? []) {
    const projectPath = raw.split(path.sep).join("/");
    const blocked = gateContributePath(projectPath);
    if (blocked.length > 0) {
      if (!seen.has(projectPath)) {
        seen.add(projectPath);
        candidates.push({
          kind: "path",
          projectPath,
          registryPath: "",
          gateOk: false,
          issues: blocked,
        });
      }
      continue;
    }
    const mapped = pathMap.get(projectPath) ?? guessRegistryPath(projectPath);
    if (!mapped) {
      candidates.push({
        kind: "path",
        projectPath,
        registryPath: "",
        gateOk: false,
        issues: [
          {
            code: "unmapped",
            message:
              "Cannot map to a registry path — pass an installed kit artifact or .cursor/{rules,commands,skills,agents,hooks}/*",
          },
        ],
      });
      continue;
    }
    await push("path", projectPath, mapped);
  }

  return {
    candidates,
    accepted: candidates.filter((c) => c.gateOk),
    rejected: candidates.filter((c) => !c.gateOk),
  };
}

/** Copy accepted candidates into a local kit/registry checkout. */
export async function writeContributeToRegistry(
  projectRoot: string,
  registryRoot: string,
  accepted: readonly ContributeCandidate[],
): Promise<string[]> {
  const written: string[] = [];
  for (const c of accepted) {
    if (!c.registryPath) continue;
    const content = await readFile(resolveContained(projectRoot, c.projectPath), "utf8");
    const dest = resolveContained(registryRoot, c.registryPath);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, content, "utf8");
    written.push(c.registryPath);
  }
  return written;
}

export function formatPrBody(accepted: readonly ContributeCandidate[]): string {
  const bullets = accepted.map((c) => `- \`${c.projectPath}\` → \`${c.registryPath}\``).join("\n");
  return [
    "## Summary",
    "Upstream contribution from a consumer project via `agent-kit contribute`.",
    "",
    "### Files",
    bullets || "- (none)",
    "",
    "## Checklist",
    "- [ ] Anti-slop / hygiene gate passed locally",
    "- [ ] No secrets or session state (HANDOFF/plans/memory)",
    "- [ ] Docs / registry index updated if this adds a skill or pack member",
    "",
  ].join("\n");
}
