# Git prod

Follow the **git prod** routine to promote `origin/staging` to `origin/main` (production):

**Runs in the main window by default.** Do not dispatch this command to a Task subagent by default; Task isolation is opt-in and used only when the kit repo wants it.

1. **Read** the "Prompt: git prod" section in `autogit/gitupdate.md` (when it exists in the project).
2. Critical validation: no uncommitted local changes; never commit directly to main.
3. Close the release in the CHANGELOG (move `[Unreleased]` to a dated version) before merging.
4. Show a summary of the changes (diff/log) between staging and main and **ask for explicit confirmation using Ask questions tool** before merging and pushing to main.
   
   Options: `Proceed with production deploy` / `Review changes first` / `Cancel`
   
   **Fallback:** if Ask questions tool unavailable, ask for explicit confirmation in chat.
5. Run merge to main, push main, create/push annotated vX.Y.Z tag (when absent), confirm production.
6. Update `.cursor/HANDOFF.md` ("promoted to production") and memory-loop WRITE if it applies.
7. In this monorepo: annotated tags trigger `publish-npm` + `sync-public` CI; `pnpm git:trigger-public-sync` fallback when needed per `autogit/gitupdate.md`.
8. **Post-prod verification (mandatory in this monorepo):** before ending, check tag CI jobs (`publish-npm`, `sync-public`), `npm view @dadado/agent-kit-cli version`, public `main` sync commit, and public GitHub Release Latest. Report each row. Silent npm success with a stale public Releases badge is a kit failure mode — see `autogit/gitupdate.md` step 12.5.
