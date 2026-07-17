import { defineCommand } from "citty";
import { buildManifest, saveManifest, upsertIdList } from "../lifecycle/apply.js";
import { resolveProtectedGlobs } from "../lifecycle/protected.js";
import { logApplyStats } from "../lifecycle/report.js";
import { REGISTRY_CLI_ARGS, resolveRegistryFromCli } from "../lifecycle/resolve-cli.js";
import { KIT_VERSION } from "../lifecycle/version.js";
import { loadAgentKitManifest } from "../manifest/index.js";
import { allPacks, allSkills, findPack, findSkill, loadRegistry } from "../registry/client.js";
import { installPack, installSkill } from "../registry/install.js";
import { logger } from "../utils/logger.js";

export const addCommand = defineCommand({
  meta: {
    name: "add",
    description: "Install a skill or L1 pack from the registry into the project.",
  },
  args: {
    id: {
      type: "positional",
      description: "Skill id or pack id from registry",
    },
    skill: {
      type: "boolean",
      description: "Force treat id as a skill (when pack shares the same id)",
      default: false,
    },
    pack: {
      type: "boolean",
      description: "Force treat id as a pack (when skill shares the same id)",
      default: false,
    },
    cwd: {
      type: "string",
      default: process.cwd(),
    },
    ...REGISTRY_CLI_ARGS,
  },
  async run({ args }) {
    if (!args.id) throw new Error("Provide an id: agent-kit add <skill|pack>");
    if (args.skill && args.pack) {
      throw new Error("Use only one of --skill or --pack");
    }

    const existing = await loadAgentKitManifest(args.cwd);
    const registry = await resolveRegistryFromCli({
      cwd: args.cwd,
      registry: args.registry,
      url: args.url,
      ref: args.ref,
      refresh: args.refresh,
      manifest: existing,
    });

    const protectedGlobs = resolveProtectedGlobs(existing);
    const index = await loadRegistry(registry.root);
    const asSkill = allSkills(index).find((s) => s.id === args.id);
    const asPack = allPacks(index).find((p) => p.id === args.id);

    const base = existing
      ? { ...existing }
      : buildManifest({
          version: KIT_VERSION,
          profile: "default",
          registryUrl: registry.url,
          registryRef: registry.ref,
        });

    const finish = async (kind: "skill" | "pack", id: string) => {
      if (kind === "skill") base.skills = upsertIdList(base.skills, id);
      else base.packs = upsertIdList(base.packs, id);
      if (registry.url || registry.ref) {
        base.registry = {
          url: registry.url ?? base.registry?.url,
          ref: registry.ref ?? base.registry?.ref,
        };
      }
      base.version = KIT_VERSION;
      await saveManifest(args.cwd, base);
    };

    if (args.skill) {
      const skill = await findSkill(registry.root, args.id);
      const stats = await installSkill(registry.root, args.cwd, skill, { protectedGlobs });
      logApplyStats(stats);
      await finish("skill", skill.id);
      logger.success(`Skill '${skill.id}' added.`);
      return;
    }
    if (args.pack) {
      const pack = await findPack(registry.root, args.id);
      const stats = await installPack(registry.root, args.cwd, pack.id, { protectedGlobs });
      logApplyStats(stats);
      await finish("pack", pack.id);
      logger.success(`Pack '${pack.id}' added.`);
      return;
    }

    if (asSkill && asPack) {
      throw new Error(
        `'${args.id}' is both a skill and a pack. Disambiguate: agent-kit add --skill ${args.id} | agent-kit add --pack ${args.id}`,
      );
    }
    if (asSkill) {
      const stats = await installSkill(registry.root, args.cwd, asSkill, { protectedGlobs });
      logApplyStats(stats);
      await finish("skill", asSkill.id);
      logger.success(`Skill '${asSkill.id}' added.`);
      return;
    }
    if (asPack) {
      const stats = await installPack(registry.root, args.cwd, asPack.id, { protectedGlobs });
      logApplyStats(stats);
      await finish("pack", asPack.id);
      logger.success(`Pack '${asPack.id}' added.`);
      return;
    }
    throw new Error(`'${args.id}' not found as skill or pack in registry.`);
  },
});
