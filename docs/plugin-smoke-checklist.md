# Cursor plugin smoke checklist

Rerunnable smoke procedure for the Agent Kit Cursor plugin (`.cursor-plugin/plugin.json`). Run it (a) before asking the operator to promote/submit, and (b) again after public promotion against the public ref ("Post-promote re-verification" below). Companion to the packaging contract in [marketplace.md](marketplace.md).

**Record evidence:** for each section, capture the command outputs (or an IDE screenshot for observational steps) in the PR description or the plan's tick notes. A checklist run without captured output is not a smoke record.

## 1. Manifest discovery

From the repo root (the plugin root is the parent of `.cursor-plugin/`):

```bash
# Manifest parses and declares explicit component paths
node -e "
const m = require('./.cursor-plugin/plugin.json');
const fs = require('fs');
const missing = ['rules','skills','agents','commands','hooks','logo']
  .filter((k) => !m[k] || !fs.existsSync(m[k]));
if (typeof m.author !== 'object' || !m.author.name) missing.push('author-object');
if (missing.length) { console.error('FAIL', missing); process.exit(1); }
console.log('ok: manifest keys resolve', m.version);
"
```

- [ ] Every declared path exists; `author` is an object; version printed matches the release being smoked.
- [ ] Version alignment: `node -e "console.log(require('./.cursor-plugin/plugin.json').version === require('./packages/cli/package.json').version ? 'ok: versions aligned' : 'FAIL: version drift')"`.

## 2. Component inventories

Counts are expected to drift across releases — the check is **non-empty + shape**, with exact counts recorded as evidence:

```bash
ls .cursor/rules/*.mdc | wc -l              # rules (.mdc with frontmatter)
ls .cursor/commands/*.md | wc -l            # commands (frontmatter: name + description)
ls .cursor/agents/*.md | wc -l              # agents
ls .cursor/skills/core/*/SKILL.md | wc -l   # core skills (direct children with SKILL.md)
```

- [ ] All four inventories are non-empty; record the counts.
- [ ] Skill discovery precondition: every direct child of `.cursor/skills/core/` holds a `SKILL.md` (the manifest points at `core/`, not `skills/`, because discovery matches direct children only).
- [ ] Command frontmatter: spot-check 2-3 files under `.cursor/commands/` for `name` (kebab-case, matches filename slug) + `description`.
- [ ] Overlay hash coverage is current: `pnpm overlay:hashes:check` (append-only helper; exit 0 = every shipped overlay body is a known hash).

## 3. Local install + reload (IDE, observational)

1. Install the plugin from the local checkout (Cursor plugin dev flow), or point a scratch workspace at the repo.
2. Reload Cursor.

- [ ] Rules: structural `alwaysApply` rules are listed in the workspace rules UI.
- [ ] Commands: a known slash command (e.g. `/run-plan`) autocompletes and opens its body.
- [ ] Skills: `clean-code` and `docs-repo` appear as available skills.
- [ ] Agents: subagent definitions are selectable.
- [ ] No error toasts / log entries from plugin load (empty-plugin symptom = manifest paths not declared).

## 4. Hooks

All five hooks (`sessionStart`, `preCompact`, `beforeShellExecution`, `afterFileEdit`, `beforeSubmitPrompt`) are thin fail-open adapters resolved via `.cursor/hooks/agent/resolve-agent-kit.sh`.

```bash
# Hook scripts exist and are executable
for h in session-start pre-compact guard-shell after-edit-schema secrets-prompt; do
  test -x ".cursor/hooks/agent/$h.sh" && echo "ok: $h" || echo "FAIL: $h"
done
# First-run resolution diagnostic (see marketplace.md, hook resolution boundary)
bash .cursor/hooks/agent/session-start.sh </dev/null | head -c 400; echo
# Which agent-kit the IDE's PATH resolves, and whether it runs from this workspace
command -v agent-kit && agent-kit --version
# Resolved but broken: a fake CLI that exits 1 with stderr only, as a mise shim
# with no agent-kit for the active Node does
fake=$(mktemp -d) && printf '#!/bin/sh\necho "not provided by the active node" >&2\nexit 1\n' >"$fake/agent-kit" && chmod +x "$fake/agent-kit"
AGENT_KIT_HOOK_BIN="$fake/agent-kit" sh .cursor/hooks/agent/session-start.sh </dev/null; echo "exit=$?"
echo '{"command":"ls"}' | AGENT_KIT_HOOK_BIN="$fake/agent-kit" sh .cursor/hooks/agent/guard-shell.sh; echo "exit=$?"
rm -rf "$fake"
```

- [ ] All five scripts exist and are executable.
- [ ] `session-start.sh` emits valid JSON (not a shell error) when run from the repo root. When the CLI resolves it is the real session context; when it does not, it is the degraded-mode `additional_context` diagnostic ("Agent Kit hooks are running in degraded fail-open mode…") with exit 0 — the other four hooks stay silent by accepted design.
- [ ] `command -v agent-kit` resolves to the CLI you expect and `agent-kit --version` runs from this workspace. A version-manager shim (mise, asdf) can resolve and still fail here (`mise ERROR agent-kit is not provided by the active node@…`): that is the resolved-but-broken branch below, fixed by installing the CLI for that Node (`npm i -g @dadado/agent-kit-cli`, then `mise reshim`) or in the project.
- [ ] Resolved but broken (fake CLI above): `session-start.sh` prints the degraded `additional_context` naming the fake path and "exited 1 with no output", and `guard-shell.sh` prints `permission: allow` with `agent-kit guard inactive: the resolved CLI … exited 1 with no output`; both `exit=0`.
- [ ] In-IDE: open a fresh session and confirm the sessionStart hook context appears (or, if resolution fails, that the degraded-mode diagnostic above — not a hard error — is what you observe).
- [ ] Automated coverage of the three branches (resolvable, unresolvable, resolved but broken): `node --test scripts/hook-session-start-diagnostic.test.mjs` passes.

## 5. Post-promote re-verification (public ref)

After the operator has run `/git-prod` → tag → public sync (see the promote sequence in [marketplace.md](marketplace.md)):

```bash
git clone --depth 1 https://github.com/agent-kit-startup/agent-kit /tmp/ak-public-smoke
cd /tmp/ak-public-smoke
```

- [ ] Rerun sections 1, 2, and 4 in the public clone (section 3 optionally, installing from the public repo).
- [ ] `.cursor-plugin/plugin.json` version in the public clone equals the released tag.
- [ ] Only after every box above is green does the publisher HITL submission step apply (never performed by an agent).
