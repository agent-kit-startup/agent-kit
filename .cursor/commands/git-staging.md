# Git staging

Follow the **git staging** routine to bring local changes to the pre-production branch (`origin/staging` in this repo, or the name configured for the project).

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git staging" section in `autogit/gitupdate.md` (when it exists).
2. Run in order: validation (not on `main`), CHANGELOG (`[Unreleased]`), checkout staging, pull, working branch, Conventional Commits, push, MR/PR, merge, cleanup.
3. **Never** commit directly to `main`.
4. On completion: update `.cursor/HANDOFF.md` (phase in staging); memory-loop WRITE if it applies.
5. Optional: update the project's PM tool (ClickUp, Jira, ...) if MCP is configured.
