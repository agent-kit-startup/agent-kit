import path from "node:path";
import { defineCommand } from "citty";
import { npxPinned, pathCliStatus } from "../lifecycle/path-cli.js";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { MANIFEST_RELATIVE_PATH, loadAgentKitManifest } from "../manifest/index.js";
import { assessEnvironment } from "../readiness/env-checks.js";
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
    const [manifest, rawProfile, scan, env] = await Promise.all([
      loadAgentKitManifest(rootDir),
      readJson<RepositoryProfile | Record<string, unknown>>(
        path.join(rootDir, ".cursor", "agent-kit.config.json"),
      ),
      runScanner(rootDir),
      assessEnvironment(),
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
      if (manifest.version !== KIT_VERSION) {
        console.log(
          `  overlay:    this CLI is v${KIT_VERSION}; apply with the same binary, not a stale PATH hit:`,
        );
        console.log(`              ${npxPinned(KIT_VERSION, "update")}`);
      }
      const pathStatus = pathCliStatus(env, KIT_VERSION);
      if (pathStatus === "behind" || pathStatus === "unknown") {
        console.log(`  PATH bin:   v${env.binVersion ?? "unknown"} at ${env.binPath}`);
        console.log("              bare `agent-kit update` will re-stamp that older version");
      }
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
