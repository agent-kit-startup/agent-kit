/**
 * Shared citty args for commands that confirm the project root before writing.
 * Keep descriptions identical across install / init / update.
 */
export const NON_INTERACTIVE_ROOT_ARGS = {
  yes: {
    type: "boolean" as const,
    alias: "y" as const,
    description: "Skip interactive prompts; use defaults (IDE-agnostic non-interactive mode)",
    default: false,
  },
  "force-root": {
    type: "boolean" as const,
    description: "Bypass the ambiguous-root guard (use with caution)",
    default: false,
  },
};
