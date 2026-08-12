<!--
Thanks for contributing. Keep PRs small and focused.
Base branch: follow docs/CONTRIBUTING.md for the repository you are opening this against.
-->

## What and why

<!-- What changes, and the problem it solves.
     Same-repo issue: Closes #123
     Factory PR closing a public issue: Closes agent-kit-startup/agent-kit#123
     (bare Closes #N in agent-kit-dev targets the private repo, not the public one) -->

## How to verify

<!-- Commands a reviewer can run, and what they should see. -->

```bash
pnpm install && pnpm lint && pnpm test
```

## Checklist

- [ ] Conventional Commits title (`feat:`, `fix:`, `docs:`, `chore:`, …)
- [ ] Small and focused — one topic per PR
- [ ] `pnpm install && pnpm lint && pnpm test` pass locally
- [ ] Docs updated when behavior changed
- [ ] No `HANDOFF.md`, no `.cursor/plans/*.plan.md`, no `.cursor/memory/`, no `.env`, no credentials
- [ ] No secrets and no agent metalanguage (same gate as `agent-kit contribute`)
- [ ] Prefer Cursor-native tooling — no parallel agent gateway added or documented

## Registry contributions only

Skip this block if you did not touch `registry/`.

- [ ] Dedupe: listed the closest existing skills and why this is not an overlap (or targeted the existing skill instead)
- [ ] `version` and `category` present in frontmatter; semver bumped if behavior changed
- [ ] Community contributions stay under `community/`; no product PM/n8n added as a Core Pack `alwaysApply` rule
- [ ] `node scripts/build-registry.mjs` run, and `registry/registry.json` committed
- [ ] `pnpm --filter @dadado/agent-kit-cli test` run if the CLI was touched
- [ ] New category linked from `docs/marketplace.md`

<!--
By opening this PR you agree to the Code of Conduct (.github/CODE_OF_CONDUCT.md).
Security issue? Do not open a PR or an issue — see .github/SECURITY.md.
-->
