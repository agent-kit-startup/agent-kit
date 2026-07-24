import type { ProjectProfile } from "../types.js";
import { generateAgentsMd } from "./agents-md.js";
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
  if (profile.installHooks) await generateGitHooks(profile);
}
