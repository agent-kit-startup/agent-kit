import path from "node:path";
import { defineCommand } from "citty";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { MANIFEST_RELATIVE_PATH, loadAgentKitManifest } from "../manifest/index.js";
import { createReadinessReport } from "../scanner/readiness.js";
import { runScanner } from "../scanner/scan.js";
import type { DetectionEvidence, RepositoryProfile } from "../types.js";
import { readJson } from "../utils/fs.js";
import { logger } from "../utils/logger.js";

interface ProfileStatus {
  origin: "readiness-scanner" | "legacy-wizard" | "none";
  evidence: DetectionEvidence[];
  profile: RepositoryProfile | Record<string, unknown> | null;
}

function profileStatus(profile: RepositoryProfile | Record<string, unknown> | null): ProfileStatus {
  if (!profile) return { origin: "none", evidence: [], profile: null };
  if ("detection" in profile && profile.detection && typeof profile.detection === "object") {
    const detection = profile.detection as RepositoryProfile["detection"];
    return {
      origin: "readiness-scanner",
      evidence: detection.providerEvidence ?? [],
      profile,
    };
  }
  return { origin: "legacy-wizard", evidence: [], profile };
}

export const statusCommand = defineCommand({
  meta: {
    name: "status",
    description: "Show installed kit version, manifest, and optional profile.",
  },
  args: {
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    json: {
      type: "boolean",
      description: "Print raw JSON for manifest and profile",
      default: false,
    },
  },
  async run({ args }) {
    const rootDir = path.resolve(args.cwd);
    const [manifest, rawProfile, scan] = await Promise.all([
      loadAgentKitManifest(rootDir),
      readJson<RepositoryProfile | Record<string, unknown>>(
        path.join(rootDir, ".cursor", "agent-kit.config.json"),
      ),
      runScanner(rootDir),
    ]);
    const readiness = createReadinessReport(scan, { generatorVersion: KIT_VERSION });
    const profile = profileStatus(rawProfile);
    const nextAction = readiness.pendingActions[0];

    if (args.json) {
      console.log(
        JSON.stringify(
          {
            runtimeVersion: KIT_VERSION,
            manifest: manifest ?? null,
            readiness,
            pendingActions: readiness.pendingActions,
            profile,
          },
          null,
          2,
        ),
      );
      return;
    }

    if (!manifest) {
      logger.warn(`No ${MANIFEST_RELATIVE_PATH}: run agent-kit install.`);
    } else {
      const protectedGlobs = resolveProtectedGlobs(manifest);
      console.log("Agent Kit status");
      console.log(`  runtime:    ${KIT_VERSION}`);
      console.log(`  installed:  ${manifest.version}`);
      console.log(`  profile:    ${manifest.profile ?? "(none)"}`);
      console.log(`  packs:      ${(manifest.packs ?? []).join(", ") || "(none)"}`);
      console.log(`  skills:     ${(manifest.skills ?? []).length} listed`);
      console.log(`  protected:  ${protectedGlobs.length} glob(s) (L3 safe on update)`);
      console.log(
        `  registry:   ${manifest.registry?.url ?? "(default)"} @ ${manifest.registry?.ref ?? "(default)"}`,
      );
      if (manifest.installedAt) console.log(`  installed at: ${manifest.installedAt}`);
    }

    console.log("Repository readiness");
    console.log(
      `  ready: ${readiness.summary.ready}, choices: ${readiness.summary.needs_choice}, manual: ${readiness.summary.manual}, blocked: ${readiness.summary.blocked}`,
    );
    console.log(`  pending: ${readiness.pendingActions.length}`);
    console.log(`  profile origin: ${profile.origin}`);
    console.log(
      `  profile evidence: ${profile.evidence.map((item) => item.value).join(", ") || "(none)"}`,
    );
    console.log(
      nextAction
        ? `Next: ${nextAction.recommendation}`
        : "Next: repository readiness checks are complete",
    );
  },
});
