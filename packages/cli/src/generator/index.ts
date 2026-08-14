import type { ProjectProfile } from "../types.js";
import { generateAgentsMd } from "./agents-md.js";
import { generateClaudeKitLoadArtifacts } from "./claude-kit-load.js";
import { generateGitHooks } from "./git-hooks.js";

export {
  applyPersonalization,
  buildPersonalizationPlan,
  PERSONALIZATION_CONTRACT_VERSION,
  readRepositoryProfile,
} from "./personalization.js";
export type {
  PersonalizationItem,
  PersonalizationResult,
  PersonalizationStatus,
} from "./personalization.js";

/** Compatibility path for legacy callers. Repository readiness uses applyPersonalization. */
export async function generateFromProfile(profile: ProjectProfile): Promise<void> {
  await generateAgentsMd(profile);
  await generateClaudeKitLoadArtifacts(profile.rootDir);
  if (profile.installHooks) await generateGitHooks(profile);
}
