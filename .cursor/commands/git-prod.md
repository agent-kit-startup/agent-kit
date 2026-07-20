# Git prod

Follow the **git prod** routine to promote `origin/staging` to `origin/main` (production):

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git prod" section in `autogit/gitupdate.md` (when it exists in the project).
2. Critical validation: no uncommitted local changes; never commit directly to main.
3. Close the release in the CHANGELOG (move `[Unreleased]` to a dated version) before merging.
4. Show a summary of the changes (diff/log) between staging and main and **ask for explicit confirmation using Ask questions tool** before merging and pushing to main.
   
   Options: `Proceed with production deploy` / `Review changes first` / `Cancel`
   
   **Fallback:** if Ask questions tool unavailable, ask for explicit confirmation in chat.
5. Run merge to main, push main, confirm production.
6. Update `.cursor/HANDOFF.md` ("promoted to production") and memory-loop WRITE if it applies.
7. In this monorepo: after prod, run the public sync per `autogit/gitupdate.md` / `pnpm git:trigger-public-sync` when applicable.
