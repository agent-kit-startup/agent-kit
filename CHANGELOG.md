# Changelog - Agent Kit

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

## [4.8.8] - 2026-08-01

### Fixed

- Regenerate `docs/evidence/knowledge-classification.json` (`summary.totalObjectCount` 682→715) so tag CI `evidence:knowledge-classification:check` passes (v4.8.5–v4.8.7 tags retained)

## [4.8.7] - 2026-08-01

### Fixed

- Public docs index: drop relative link from `docs/README.md` to denied `docs/evidence/config-tab-write-verification.md` so `pnpm check:public-deny-links` passes on tag CI (v4.8.5/v4.8.6 tags retained)

## [4.8.6] - 2026-08-01

### Fixed

- Biome import order in `session-start.test.ts` so tag CI lint passes after the 4.8.5 typecheck unblock (v4.8.5 tag retained; do not force-move)

## [4.8.5] - 2026-08-01

### Added

- Landing page redesign & consumer copy rewrite (plan `agentkit-landing-redesign-copy`): STK design system identity, Mission Control mockup tokens, consumer feature copy, and deployment config for `agent.startupkit.com.br` (`.cursor/context/landing-agentkit/`, `docs/agentkit-landing.md`)

- Public Agent Kit landing page note (`docs/agentkit-landing.md`) pointing at live `https://startupkit.com.br/agentkit` (WP page id 3001); design inventory and HTML source under `.cursor/context/landing-agentkit/` (plan `agentkit-landing-startupkit`)
- Crew / Team Member framework (plan `crew-monitor-profession-masking`): ADRs for Team Member composition (`2026-08-01_crew-team-member-framework`), core vs specialist gap inventory (`2026-08-01_crew-core-specialist-gap-inventory`), and Crew-tab composition contract (`2026-08-01_crew-tab-composition-contract`); glossary ADR amended with default software lexicon display-mask contract (kind ids unchanged); Crew Monitor chip glosses and actor fallbacks use profession masks (Tech Lead / Scrum Master / Full-Stack Developer / Product Owner / DevOps Engineer; Squad / Engineering Manager / Platform Engineer); `crewTeam` config shape documented as contract-only in `docs/consumer-configuration.md` (not wired; heavy UI follow-up)
- Cursor update awareness (plan `cursor-update-awareness-auto-dogfood`): ADR for changelog-primary detection (`2026-08-01_cursor-update-detection-source`); CLI `agent-kit cursor-awareness --check` (opt-in `cursorUpdateCheck.*`, never apply / never Field Reports); L0 slash `/cursor-update-awareness` routes confirmed gaps via Ask → `/backlog-add` or `/dogfood`; sessionStart nudge when enabled; docs `docs/cursor-update-awareness.md`
- Consumer configuration inventory (`docs/consumer-configuration.md`): every consumer-configurable knob in one doc (session config keys, dashboard skin, install-time choices, repo profile, CLI flags and env vars) with where-defined / read-by evidence, a writable-via-tab column, and a copy-paste snippet per knob; pointer added from getting-started (plan `consumer-config-inventory-copy-crud`)
- Mission Control Config tab copy-CRUD fallback: per-fieldset Copy config.json snippet buttons (Session, Update check, Audits, Agent Personas) that build the fragment from current form values via a shared `collectMissionConfigPayload` and copy to clipboard only (no new write surface); dead-control hints (backend is claude-only; `updateApply.auto` never writable); actions bar names the manual paste path for server-down / non-loopback / read-only deploys
- Mission Control responsive grid (plan `mc-grid-responsive-ui-design-tokens`, Phase 1): mid-width 2-column overview grid (701-1023px) with row-major IA collapse, very-thin sidebar mode (max 339px) with tighter ladder values, and a fullscreen zen toggle (header enter button, floating exit, Escape restore); grid extends the locked Current mission → Flight Log → Checklist → Crew monitor IA without reopening it (ADR `2026-07-29_mc-main-tabs-order`)
- Crew Monitor row wording contract (plan `crew-monitor-wording-readability`): natural-voice verbs (`running` / `awaiting` / `done` / `parked` / `shipped`) replace robotic `· tick ·` / `· step ·` / `· handoff ·` separators; todo id / gate / progress count leads the label and the plan filename moves last; actor fallback is a short human `crew` label instead of the full plan filename; `.feed-label` renders structured spans so the low-signal plan filename ellipsises first, with the full label on a `title` tooltip (ADR `2026-07-27_crew-monitor-vs-plan-monitor-glossary` amend, `2026-07-27_mc-flight-log-panel` decision 17 amend)
- Mission Control icon design-system sweep (Phase 2): 16px / stroke-1.5 / currentColor / round caps-joins contract enforced across `spaceIconSvg` at all render sizes; four sub-stroke glyphs (radar, gear, rocket window, chip) redrawn above the legibility floor, `more-sections` dots respaced to positive clearance, header home icon door widened; legibility floor documented and pinned by a new UX test suite
- Mission Control card and empty-state unification (Phase 3): card surfaces on the overview / health / config families consolidated onto the `--mc-card-padding` / `--mc-radius-*` / `--mc-space-*` density ladder (new documented `--mc-card-padding-dense` token); denser list rows (terminals/memory) and pill badges may keep tighter radii off the 4/8/12 ladder; healthcenter severity chrome unified into one `{tone, label, token}` mapping with presence-pulse halo and fallback-hex hygiene (presentation only, check semantics unchanged); empty states scale with card density across every viewport mode; both skins verified skin-neutral
- Mission Control "busy outside the plan" live state (Phase 4): text-only busy chip on Current mission and Flight Log headers when terminals show fresh run-loop activity while the mission is not executing; derivation shares the Crew feed run-loop evidence with a 10-minute freshness window (`BUSY_OUTSIDE_PLAN_FRESH_MS`), rides the existing advice-family blue tokens on both skins, and leaves Flight Log kinds, Gaps voice, and locked labels untouched
- Mission Control UX overhaul (plan `mc-flight-log-dynamic-action-command`): dot semantics table (colored dots signal good / important / attention / neutral-idle, always paired with a label or icon) applied across all tabs, URL-hash deep-linkable tabs, and a uniform copy-only CTA pattern
- Flight Log one-command contract: every entry kind (Gaps NOW/Earlier, operator Warnings, quiet open-triage) renders one dynamically-labeled action button (`Copy fix prompt` / `Copy recovery prompt` / `Copy follow-up prompt` / `Copy triage command`); Gaps/Warnings compose prompt + path, quiet open-triage copies `/plan-review-triage <path>` only (ADR `2026-07-27_mc-flight-log-panel` decisions 11/13)
- Mission Control tab redesigns: Config grid form with Save pinned on top; Memory live recent-errors panel with green/red icon panels and error-o-meter KPIs from `.cursor/memory/errors/`; Git promotion flow lanes + readable commit graph + staging-hygiene hints; Health vitals diagnosis dashboard with per-problem Copy fix prompt CTAs; Commands / Skills / Agents card grids with copy-only CRUD CTAs and registry-driven lock badges; Crew Monitor timestamped feed with agent initials + action; Plans v2 actionable rows with live progress bar from frontmatter to-do counts; Processes live narrated list via deterministic `describeProcess` heuristics (no LLM; accepted design for local dashboard)
- Design evidence: nine catalogued UX prints under `.cursor/context/mc-ux-prints/` with per-print analysis and per-tab issue inventory
- `/dogfood` slash command ships as an L0 artifact (`packages/cli/src/lifecycle/l0.ts` + Port B install table), closing the packaging gap that left consumers without the command file (EXT-201)
- `.cursor/context/config.example.json` documents the advisory `dogfood.factoryRoot` key referenced by the `/dogfood` cross-repo bridge (EXT-208)
- `/dogfood` slash command for filing private dogfood notes into factory `dogfood/` or consumer `.cursor/dogfood/`, with optional public-issue HITL path (never auto-creates issues or Field Reports)
- Factory self-consumer local apply loop: `agent-kit update --seed-overlay` seeds the managed-hash ledger on first update; docs in `docs/CONTRIBUTING.md`, `docs/bootstrap.md`, and `docs/getting-started.md`
- ADRs for dogfood factory/consumer lanes, ingest contract, and factory-as-pseudo-consumer local apply loop

### Fixed

- Landing G/H closeout (`close-queue-end-t-r-landing-residuals`): annotate curated PNG byte-identical copies in INVENTORY; reconcile COPY.md CTA hierarchy to shipped GitHub-primary buttons; R15 Closed-by on T/R + landing monitors
- Landing A–E (`close-queue-end-t-r-landing-residuals`): publish page 3001 as Custom HTML (wpautop brs cleared); WCAG AA contrast tokens (`--blue-cta` / `--blue-pill` / secondary muted); `:focus-visible` on `.ak-btn`; demote landing hero to `h2`; document page excerpt vs theme meta description
- U4 terminal snapshot (`close-queue-end-t-r-landing-residuals`): trim partial first body line on windowed over-cap path; document 4KB head-meta contract (U5 note)
- U2/U3 test hygiene (`close-queue-end-t-r-landing-residuals`): ENOENT fallback spawn test emits `close` after `error` so the settled guard is exercised; remove tautological actor-mask length pins from `plugin-ux-validation.test.ts`
- U1 / T6 honesty (`close-queue-end-t-r-landing-residuals`): live `agent-kit cursor-awareness --check --json` recorded under `docs/evidence/runtime/cursor-awareness-u1-2026-08-01/`; append-only T6 Closed-by correction on `plan-monitor-close-two-monitor-still-open-residuals.md`; R14 stage of mid-batch T/R + landing plan monitors with `_index.md`
- Residuals T1–T8 + R1/R2/R4/R5/R7 (`close-queue-end-two-monitor-t-r-residuals`): Positioning inventory counts 25/89; cursor-awareness stamp-guard reachability test + one-shot advise/stamp docs; sessionStart changelog-ahead / single-fallback hook tests; terminal snapshot head+tail window via `TERMINAL_HEAD_META_BYTES`; Crew actor-mask noshrink acceptance + Squad outside core slots; composition ADR `registry/schemas/` deferral; R14 monitor+_index same-commit staging; `update.test.ts` timeout 15s under parallel load
- Residuals A–E + R1–R8 (`close-two-monitor-still-open-residuals`): Biome format on `plugin-ux-validation.test.ts`; terminal head-meta + tail-body (`dashboard/lib/terminal-snapshot.mjs`) so over-cap files keep pid/cwd/exit; restore `updateApply.auto` silent L0 overwrite risk copy; dogfood monitor Closed-by count 660→682; glossary ADR plan-segment wording; Cursor changelog extract anchors to release labels + plausibility bound (stops `49.511` stamp poison); sessionStart nudge gated on `changelog-ahead`; spawn timeout above fetch + double-fallback guard; capability-inventory 27/18 counts; conveyor reverse pointers; staging R14 reinforce; network closeout expectation doc
- Knowledge ledger CHANGELOG object count matches `summary.totalObjectCount` (682) in `docs/evidence/knowledge-classification.json` (EXT-210; refreshed after queue-end monitor land)
- `DOGFOOD_INBOX_HINT` resolution documented: hint stays unconditional because `/dogfood` ships as L0 (EXT-201); no lane-conditional guard required (EXT-212)
- Crew Monitor tooltips use pre-truncation `labelFull` (plan filename restored on `handoff` / `agent_step` titles); plan segment marked from `refs.plan`; feed separators include spaces for readable row copy; quiet open-triage copy drops the duplicated path line; Activity tab stays on plain `.activity-label` (residuals plan Phase 1)
- Mission Control grid residuals: fullscreen exit clears top-tabs; layered Escape dismisses menus before exiting zen; header transport consumes `healthSeverityChrome` (degraded stays orange); terminal lastOutput tail-slices capped files; very-thin sidebar lets Crew feed actor/verb ellipsis; legibility-floor pins raised (residuals plan Phase 2)
- Consumer configuration inventory adds an `implemented?` column; Config tab gains copy-only snippets for never-writable `updateApply.auto` / `dogfood.factoryRoot` (allowlist unchanged); clipboard-failure toast truncates long snippets; durable write-path matrix at `docs/evidence/config-tab-write-verification.md` (residuals plan Phase 3)
- Knowledge classification fixture lane: generate and check both use `--handoff-fixture`; artifact stamps fixture path; `update.test.ts` fixture imports `KIT_VERSION`; npm publish checklist requires `sync-cli-dashboard.mjs` before Path C promote; five queue-end monitors carry `## Closed by residuals plan` (residuals plan Phase 4)
- Risk-hotspot scorer is a pure function of committed ledgers: churn derives from `delivery-reconciliation.json` rows only (no live `git diff` on frozen SHAs), so `docs/evidence/codebase-risk-hotspots.json` reproduces in shallow CI clones (EXT-203)
- Knowledge classification corpus is git-index (tracked) files only; gitignored `.cursor/plans/**` no longer leaks into `docs/evidence/knowledge-classification.json`; HANDOFF-listed gitignored plans are reported as `missingPlans`; the `--check` staleness comparison normalizes commit provenance so the artifact is no longer stale-by-construction after any commit (EXT-203)
- `agent-kit update` preserves `installedAt` when no version change occurs and `update.test.ts` asserts the preserved value (ADR factory-pseudo-consumer decision 4, EXT-205)
- CHANGELOG hotspot counts match the committed artifact tally (90 pending:audit-risk-hotspots, deferred:census 1820, 91 reviewed) (EXT-204)
- `dogfood-command-pseudo-consumer.plan.md` marks `phase3-fix-personalization-preserve` completed, matching the shipped personalization preserve fix (EXT-206)
- `agent-kit update` preserves `manifest.personalization` and `overrides` instead of dropping them during no-op L0 syncs
- `sessionStart` dogfood inbox hint now recognizes both factory `dogfood/` and consumer `.cursor/dogfood/` unprocessed files and mentions `/dogfood`
- Public storefront: add sync-allowed `docs/five-layer-claim-matrix.md` and `pnpm check:public-deny-links` to prevent README→denied-path regressions
- Capability inventory: positioning table row count 87→89; CHANGELOG no longer claims every cell is verbatim
- Authority graph: registry publicationRoute is public-PR Phase B SoT, not private sync-public (AUDIT-004)
- Public sync: replace remaining `forEach` with `for...of` so `biome check scripts/sync-public.mjs` is clean (AUDIT-006)
- Knowledge classification focused tests: assert current HANDOFF active/parked counts and archive storefront path (AUDIT-003)
- Evidence ledgers: `batchId` is the full `contentHash` (no scheme-prefix truncation); disposition rows de-duped; hotspot/findings coverage counts sum to unique batches
- Evidence scripts: `evidence:codebase-findings:check` and `evidence:risk-hotspots:check` no longer regenerate ledgers (prevents wiping consolidated hotspot reviews; AUDIT-001)
- Install/docs Path C honesty: consumer guidance names the published floor (`4.8.2` onward) instead of relative "until that publish" hedges; Port B registry fetch prefers Port A and requires Ask before alternate URLs (RC-001, INSTALL_MD_MISSING_VALIDATION)
- Drift/capability inventories: replace stale ahead-count and closed surface-census claims with lane-qualified freshness metadata (RC-003, RC-006)
- Public sync: exclude `docs/evidence/**` from the allowlist and hard-prohibit it so generated ledgers no longer trip the denylist (closes SYNC_DENYLIST_EVIDENCE)
- Public sync: reject path traversal / escaping symlinks, allowlist GitHub remotes only, and redact tokens in sync errors (closes SYNC_PUBLIC_* / PUBLIC_SYNC_MANIFEST_* hotspot findings)
- CLI: `agent-kit --version` reports package version via citty `meta.version` (closes CLI_VERSION_FLAG)
- Mission Control: soft wall-clock budget skips optional collectors so `dashboard-data.mjs` fails soft under load (closes MC_DASHBOARD_DATA_SLOW)
- Git pre-push: refuse unsafe remote ref names and warn that `--no-verify` skips tag immutability (closes GIT_HOOKS_*)
- Authority graph: CLI dashboard copy is a generated output (not a writable mirror); CI runs `evidence:authority-graph:check` and refuses a tracked `packages/cli/dashboard/`
- npm storefront README: `packages/cli/README.md` ships in the packed tarball; `scripts/verify-cli-dashboard-pack.mjs` asserts non-empty `package/README.md` (closes PLUGIN_README_ABSENT for the CLI package)
- Queue consolidate helper: `--rewrite-queue` validates/normalizes `--outcomes` (including multiline) before any HANDOFF write and applies Plan/Mode/queue/cursor/status/outcomes as one atomic temp+replace rewrite (closes QUEUE_REWRITE_NONATOMIC)
- Audit launcher sessions: names are `agent-kit-audit-<ws8>-<pid>` with an 8-hex workspace token; cap/warn/reap only count or dispose strict workspace-owned sessions (closes AUDIT_SESSION_UNSCOPED); macOS Terminal spawn writes a temp runner instead of embedding shell_cmd in AppleScript

### Added

- Five-layer README claim matrix: `docs/evidence/five-layer-claim-matrix.md` classifies prompt/HITL, context/memory, safeguards, iterative review, and workflow coordination as shipped core, optional pack, planned, or unsupported with lane-qualified evidence
- Independent final audit matrix: `docs/evidence/independent-final-audit.json` plus operator `docs/evidence/release-gate-checklist.md` (BIGFIX Phase 10)
- Cross-repo parity matrix: `docs/evidence/cross-repo-parity.json` records private/public/npm/release/registry/Marketplace lane verdicts and clean-room evidence (BIGFIX Phase 9)
- Guidance claim matrix and stale-claim gate: `docs/evidence/guidance-claim-matrix.md` plus `scripts/check-guidance-stale-claims.mjs` (blocks revived Path C / drift hedges)
- Memory index gate: `scripts/validate-memory-index.mjs` requires every `decisions/` and `errors/` file to be linked from `_index.md`; supersession Status applied for BIGFIX proposal links (`docs/evidence/memory-adr-reconciliation.md`)
- Plan review audit `plan-review-repo-wide-evidence-functionality-bigfix`: Phase 5 consolidation verified against the committed artifact (90 pending:audit-risk-hotspots, deferred:census 1820, zero-unassigned partition, ownership map intact)
- Finding-to-remediation ownership map: all 64 ledger findings (6 inherited + 58 hotspot) carry `ownerRemediation` Phase 6 owners (`fix-confirmed-orchestration-defects`, `fix-package-storefront`, `remediate-code-findings`, docs rebuilds, or `none-required`); `CLI_VERSION_FLAG` restored into inheritedFindings from runtime evidence
- Hotspot audit evidence (tick 5 / complete): 90 risk hotspots pending:audit-risk-hotspots; coverage 91 reviewed batches (58 newFindings preserved); deferred:census 1820
- Hotspot audit evidence (tick 4): findings ledger to 58 newFindings / 81 reviewed batches; hotspot set 80 reviewed + 10 pending (deferred:census 1820)
- Hotspot audit evidence (tick 3): expands findings ledger to 46 newFindings / 56 reviewed batches; hotspot set now 55 reviewed + 35 pending (deferred:census 1820); dispositions reconciled by contentHash
- Hotspot audit evidence (tick 2): expands `docs/evidence/codebase-findings.json` with nine additional findings (AppleScript/tmux session issues in plan-external-review, git-hooks bypass/injection, sync-public path traversal and command exec, manifest inclusion bypass); coverage 31 reviewed batches; hotspot dispositions reconciled by contentHash (60 pending, deferred:census 1820)
- Hotspot audit evidence (tick 1): `docs/evidence/codebase-findings.json` adds seven findings from the top risk batches (high: plan-external-review background launch sanitization; medium: audit session lifecycle, install.md registry validation, shell-guard `ALLOW_MAIN_PUSH` bypass breadth; plus positives for resolve.ts and the risk scorer); `docs/evidence/codebase-risk-hotspots.json` marks five hotspot batches reviewed (85 remain pending)
- Deterministic codebase risk-hotspot scorer: `scripts/score-codebase-risk-surface.mjs` ranks unique content batches from authority criticality, missing tests, publication route, inherited findings, security path globs, and delivery churn; emits `docs/evidence/codebase-risk-hotspots.json` (top-15 per domain + global top; non-hotspots `deferred:census`); `pnpm evidence:risk-hotspots` / `:check`; ADR `2026-07-30_bigfix-phase5-risk-hotspots-not-census`
- ADR `2026-07-30_evidence-policy-lane-qualified-hierarchy`: lane-qualified evidence classes, conflict hierarchies, anti-circularity and supersession rules validated against the three BIGFIX ledger fixtures
- Authority graph generator: `docs/evidence/authority-graph.json` maps 15 artifact families from authority through generators, mirrors, consumers, and publication routes; validates zero cycles, zero undeclared multiple authorities; generator `scripts/generate-authority-graph.mjs` with `pnpm evidence:authority-graph` and focused tests
- Runtime evidence for Phase 3 CLI/install packaging audit: `docs/evidence/runtime/audit-cli-install-packaging-2026-07-30/` (matrix, command logs, three code-confirmed findings: broken `--version`, public-sync denylist hits in evidence ledgers, missing plugin README)
- Runtime evidence for Phase 3 orchestration audit: `docs/evidence/runtime/audit-orchestration-runtime-2026-07-30/` (behavior matrix, failure injection, 59 + 233 focused tests, and findings for non-atomic multiline queue rewrite, unscoped audit sessions, and slow Mission Control data generation)
- Delivery reconciliation artifact: `docs/evidence/delivery-reconciliation.json` classifies eight cross-lane states, eight contradicted claims, and eight remediation items against frozen file, history, artifact, authority, and runtime evidence
- Deterministic knowledge classification ledger: `docs/evidence/knowledge-classification.json` covers 682 plans, memory, ADR, monitor, context, project-context, and index-row objects with zero unclassified; generate and check share the `--handoff-fixture` lane and stamp the real handoff input path (EXT-211); the census corpus is git-index (tracked) files only, so the artifact is reproducible in a clean clone; separates epistemic labels from HANDOFF active/backlog/parked state and records reproducible working-tree freshness identities
- Audit launcher post-spawn progress gate: after an autonomous background spawn, `plan-external-review.sh` samples PTY scrollback (tmux `capture-pane`, screen `hardcopy` with an explicit window target) for a grace window (`AGENT_KIT_AUDIT_PROGRESS_TIMEOUT`, default 60s, `0` disables) before entering the monitor wait; a silent PTY is reported as a failed launch, disposes only the session it spawned, prints the paste fallback, and soft-fails instead of burning the full `--wait-timeout`; channels without a scrollback API degrade to advisory
- Audit session cap and dispose policy: the launcher counts detached `agent-kit-audit-*` sessions before spawning, warns at `AGENT_KIT_AUDIT_SESSION_WARN` (default 5) and refuses to spawn at `AGENT_KIT_AUDIT_SESSION_CAP` (default 20); reaping is opt-in (`--reap-audit-sessions` / `AGENT_KIT_AUDIT_REAP`), covers detached kit-owned sessions past `AGENT_KIT_AUDIT_REAP_MIN_AGE` (default 3600s) only, never touches attached sessions, and previews under `--dry-run`
- ADR `2026-07-30_audits-pty-progress-gate-zombie-policy`: PTY progress gate, zombie session lifecycle, and exit 3 as timeout-only; follow-on to wait-freshness and headless-terminal honesty
- `docs/capability-inventory.md`: per-capability catalog of every shipped surface (25 slash commands, 25 rules, 13 named subagents, 9 skills, 5 Cursor-native hooks, 3 Git hooks, 17 CLI commands plus 5 subsystems, 12 Mission Control sections, 7 registry packs, 3 personas, root and kit scripts, templates), with counts verified against the filesystem; inventory only, no positioning prose
- README: demo YouTube link at the top (after H1) for the public storefront and private factory README
- Docs-contract test pinning staging lint-evidence clause across git-staging / run-plan / gitupdate; ADR for dashboard-CSS `none applicable` + plugin-ux-validation coverage
- `agent-kit doctor` / hooks-health: soft advisory when versioned `git-hooks/*` differs from or is missing under `.git/hooks/*` (install remains operator `cp`; see `git-hooks/README.md`); does not flip hooks status alone
- Consumer L0 overlay: managed-content hash ledger (`.cursor/agent-kit.managed-hashes.json`) preserves customized agents/skills/commands on update while unedited kit files still refresh; ADR `2026-07-29_consumer-l0-overlay-agents-optional`
- Shell-guard R3: documentation and `agent-kit doctor` warning when `ALLOW_MAIN_PUSH=1` is session-exported (disables main-push protection for all agent Shell commands until unset)

### Changed

- README / CLI storefront: five-layer production-agent positioning with explicit non-claims (no autonomous self-improvement, no general graph runtime, no hosted control plane); Mission Control called out as a local workspace cockpit; `packages/cli/README.md` clarifies HITL operating-layer install scope
- Audits exit-code honesty in L0 and docs: `/run-plan`, `/run-plan-all`, `/plan-external-review`, and `docs/external-plan-review.md` state that exit `3` is timeout-only, that a monitor appearing later (or from a different arm or queue position) never upgrades it to success, and that exit `4` now also covers a silent-PTY early abort and a session-cap refusal
- `docs/capability-inventory.md`: positioning-surface table recording every identity-bearing string with its real line number, current text (quoted literally where short; elided or paraphrased for long blocks), and publication route (`allowlist-synced`, `public-repo-PR-only`, or `private`), each route citing the deciding `scripts/public-sync.manifest` rule; confirms `_legacy/**` is allowlist-synced, so its stale descriptions ship today, while `registry/**` is excluded and routes through a public-repo PR
- `docs/capability-inventory.md`: themed delta section narrating what shipped since the 4.4.0 anchor across 11 themes (Mission Control, multi-plan queue orchestration, autonomous external review, backlog CRUD, agent personas, quota hard-stop contract, `/hotfix`, consumer autoupdate check, Path C packaging, repository readiness, consumer overlay protection)
- CHANGELOG `[4.8.0]`: re-file entries that were Added in substance (Flight Log panel, opt-in LAN broadcast, audit launcher wait/freshness flags, related ADRs) out of `### Fixed` into `### Added`; entries moved verbatim
- Staging-ready lint gate: `/run-plan` documents dashboard-CSS `none applicable` + plugin-ux-validation clause (parity with `/git-staging`); `autogit/gitupdate.md` no longer lists `dashboard/` as Biome/ESLint scope (`dashboard.html` is outside Biome)
- Handoff template + plan-handoff rule: Flight Log Gaps-voice writer guidance Live → NOW (matches shipped UI); quiet Flight Log placeholder NOW + `aria-label="No Gaps now"` pinned in plugin-ux-validation; ADR `2026-07-27_mc-flight-log-panel` Earlier `:hover` muted / `:focus-visible` full kind token
- Docs: `agent-kit-manifest` lists three `.cursor/` kit files (adds `agent-kit.managed-hashes.json` with commit recommendation); `layers-spec` scopes the golden rule to agents/skills/commands overlay trees (rules still clobber); `migrate-consumer` notes committing the ledger
- Mission Control Healthcenter: agents check `autofix: null` (No Autofix mapped) because `ok` is constant-true; failDetail marked intentionally unreachable
- Dogfood / local `agent-kit` (PATH link to `packages/cli/dist`): after the guard-shell `ALLOW_MAIN_PUSH` fix, run `pnpm --filter @dadado/agent-kit-cli build` so the resolved binary honors the env gate; `packages/cli/dist` is gitignored, so the rebuilt bin ships to other machines only on the next npm publish / promote
- Mission Control Doctor Agents check: L0-optional (empty `.cursor/agents/` is not a hard fail; check id `agents` retained)
- Mission Control Flight Log: current Gaps card label **Live** → **NOW** (Earlier / All clear unchanged; header SSE `#statusLabel` Live unchanged); ADR amend `2026-07-27_mc-flight-log-panel.md`
- Mission Control Flight Log: Earlier `:hover` stays muted `color-mix`; `:focus-visible` uses full kind token for keyboard contrast; base ring uses `--border-active`
- Mission Control Flight Log UX pins: NOW hover `border-color` per kind, Earlier hover `color-mix`, whitespace-tolerant `--accent` anti-regression
- Mission Control Flight Log: behavioural `new Function` tests for quiet-gate helpers (`isFlightLogQuiet` / `resolveFlightLogCurrent` and siblings)
- Close triage batch residuals: Closed-by appends on flight-log hover, close-audit, and git-prod-promote monitors (R14/R15); plan `close-triage-batch-residuals` exhausted
- Docs: layers-spec / agent-kit-manifest / migrate-consumer / bootstrap describe overlay protect without blanket `agents/**` globs

### Fixed

- Consumer overlay tests: pack-installed agent (clean-code → `cleancode-refactor`) customize then reinstall asserts `preserved-customized`; L0 user-agent check restated as non-membership evidence
- Consumer overlay: ledger-absent first `update` no longer clobbers customized kit-owned agents/skills/commands; compare local content to known shipped hashes (Option A) so unedited kit files still refresh and seed the managed-hash ledger
- Docs-contract staging lint-evidence ADR pin: `existsSync` skip when `.cursor/memory/**` is absent so public mirror CI does not ENOENT after `v*` sync
- Guard shell tests: `afterEach` uses `delete process.env.ALLOW_MAIN_PUSH` (not `= undefined`); explicit deny asserts for unset and `ALLOW_MAIN_PUSH=0`; thin-adapter ADR amend documents authorized `/git-prod` env exception
- Guard shell: narrow `ALLOW_MAIN_PUSH=1` to documented `/git-prod` forms (`git push <remote> main` / `HEAD:main`); still deny `--force` / `-f` / `--force-with-lease` / `--no-verify` / `prod` / `master` / `--all` / `--tags` (and force refspecs) even when the env is set; bare push without env stays denied
- Guard shell: honor `ALLOW_MAIN_PUSH=1` (inline before env strip, or process env) so authorized `/git-prod` `git push origin main` is allowed; bare pushes stay denied (parity with `git-hooks/pre-push`)
- Guard shell: strip all quote characters in push refspec normalization so prefixed/embedded forms (`+'main'`, `ma'in'`, …) deny like surrounding quotes; non-regression allows for staging/mainline hold
- Guard shell: strip backslashes in push refspec normalization so shell-collapse forms (`\main`, `ma\in`, `mai\n`) deny like quotes; staging/mainline-like branches still allow
- `git-hooks/pre-push`: block force-update/delete of `refs/tags/v*` unless `ALLOW_TAG_FORCE=1` (new tag creates still allowed; aligns with gitupdate §9.5)
- Close queue-end five-monitor residuals batch: queue-end triage Write residuals closed remaining items from five mid-batch monitors (PRs #519–#529) without emptying Still open tables per R15 hygiene; ready for promote
- Close queue-end BIGFIX five-layer residuals: nine to-dos shipped as five direct commits on `staging` rather than through PR-per-phase; PR-per-phase remains the intended delivery contract and this deviation is documented for the parent plan

## [4.8.4] - 2026-07-29

### Fixed

- Public storefront tag CI: skip `sync-public` and `publish-npm` when `github.repository` is `agent-kit-startup/agent-kit` so mirrored workflows do not fail on missing private-only secrets
- Mission Control Flight Log: hover/focus border+outline follow typed kind palette tokens (ok green, advice/prompt blue, residual yellow, warning orange); Earlier stays muted; remove unset `--accent` yellow double ring

### Changed

- Mission Control Health (More → Health): Healthcenter UI for the same seven checks with live severity, expand/detail, and copy-only Autofix CTAs on both Interface Skins; snapshot error distinct from per-check fail
- Mission Control chrome icons: align `spaceIconSvg` shell to refresh/`nowMetaIconSvg` (stroke 1.5); redraw Home house as one coherent glyph; add Skins palette affordance on More menu group label; leave logo assets untouched
- Mission Control: main nav, mobile stack, and desktop 2x2 grid order is Current mission → Flight Log → Checklist → Crew Monitor (first nav label matches Current mission)
- Docs: public-launch + repository-boundaries state mirror skip and private-only `PUBLIC_REPO_TOKEN`; verify checklist for next public `v*` tag

## [4.8.3] - 2026-07-29

### Fixed

- Guard shell: strip surrounding quotes in push refspec normalize so `git push origin 'main'` and `"+main"` deny
- Biome format: compact quiet-cap / classifier parity asserts in `plugin-ux-validation.test.ts` after PR #496
- Flight Log quiet-cap: drop hardcoded fallback `5`; use SoT field only (missing → 0) and widen UX assertion (residual E)
- Flight Log classifier parity: scope shared-literal asserts to `classifyFlightLogMessageKind` / `flightLogMessageKind` bodies so `normalizeHandoffGaps` copies cannot satisfy them (residual F)
- Secrets scan: mask `json-secret-kv` (`"apiKey": "…"`) values in excerpts the same way as env assignments
- Guard shell: normalize push refspecs (`+` / `refs/heads/`) before protected-branch deny so `git push origin +main` and `refs/heads/main` are blocked
- Flight Log: shared `isFlightLogQuiet(d)` / `resolveFlightLogCurrent(d)` so fingerprint and renderer agree when Plan is none and Gaps come from handoff fallback
- Biome format: split two statements on one line in `plugin-ux-validation.test.ts` (unblocks `pnpm lint` / tag CI)
- Session-start hook: tests for readiness parsing + HANDOFF excerpt assembly (`buildSessionStartAdditionalContext`)
- `/git-prod` pre-tag gate requires `pnpm typecheck` + `pnpm test`; §12.5 documents post-tag `main` exception, scoped Path C smoke, and npm-publish-checklist gains durable cross-lens matrix + partial-row convention
- Doctor hooks health: adapters must exist, be executable, and CLI must resolve; guard shell covers `HEAD --` / `checkout .` / bare push on protected branch; secrets scan masks excerpts (hook omits raw spans); hand-install chmod +x in install.md + bootstrap
- Broad Intake Write-residuals invariant pinned in external-reports doc contract; Flight Log classifier parity covers all shared regex groups; classify pre-truncation (F4)
- Flight Log quiet open-triages: gate `flightLogFingerprint` on quiet Gaps+Warnings; derive cap/kind from SoT; build quiet lane from external reports (not starved attention)
- `TRIAGE_HEADING_RE` / `isReportTriaged`: match only durable headings (`Triage note` / `Follow-up plan` / `Residuals plan`); stop treating tick headings that name `triage-*` to-do ids as triaged (shared SoT in `dashboard/lib/triage-heading.mjs` + CLI parity)
- Path C Mission Control on macOS: escape `@` / `$` in Perl detach-start paths so `node_modules/@dadado/agent-kit-cli/dashboard/serve.mjs` is not stripped by array interpolation (`escapePerlDoubleQuoted`)
- Public sync content guard: avoid denylist/secret-pattern false positives in CLI test fixtures (`field-report-prompts` path; split GitHub PAT sample) so `sync-public` can advance the storefront after npm 4.8.2
- Public sync push protection: split Stripe live-key sample in `secrets-scan.test.ts` so GitHub secret scanning does not reject the sync PR branch

### Changed

- Close audit residuals A–E (`close-audit-residuals-ae`): staging lint-evidence process (#499); quoted push deny (#498); C deferred (quiet helpers still in `dashboard.html`); D–E accepted on monitor Closed-by; monitor + `_index` staged add-by-name (R14)
- `/git-staging` + `autogit/gitupdate.md`: staging-ready requires recorded lint command + result (not the contract string alone); GitHub PRs must use `--base staging`
- Memory Audits index: document curated (not exhaustive) policy for `_index.md` plan-monitor rows (ADR R14/R15 §3); stage five-monitor audit with index row (R14)

## [4.8.2] - 2026-07-29

### Fixed

- CLI typecheck: narrow citty `args` to string for `guard`/`hook`/`validate` subcommands; loosen `readStdinJson` generic so `SessionStartPayload` typechecks (unblocks tag CI after hooks CLI adapters landed on `v4.8.1`)

## [4.8.1] - 2026-07-29

### Added

- CLI invariants + thin Cursor hooks: `agent-kit hook session-start|pre-compact`, `guard shell|prompt`, `monitors --untriaged --json`, `validate handoff|plan|after-edit`; `doctor` reports `hooks: active|degraded`; deny-list for destructive git / push-main (ADR `2026-07-29_cli-invariants-thin-hook-adapters.md`)

### Changed

- Path C publish harden: allowlist `scripts/sync-cli-dashboard.mjs` + `scripts/verify-cli-dashboard-pack.mjs` for public sync; turbo `globalDependencies` includes `dashboard/**`; tag CI + `prepublishOnly` run pack verify; CLI package.json script refs guarded in public-sync manifest test
- `/git-prod` routine: four-manifest SemVer bump at close-release; immutable `v*` tag retry (no force-move); Step 12.5 requires public sync PR **merged** (not CI-green alone)
- Native hooks: Node thin adapters under `.cursor/hooks/agent/*.sh` (no `python3` for session/preCompact); drop unwired `pre-edit`/`post-edit` scripts; docs honesty on VS Code/Windsurf parity
- Mission Control Flight Log: when Gaps and Warnings are empty, surface bounded untriaged external-review rows (per-row Copy triage / path only); keep All clear when truly clear; no Review all / Resolve all on the card (ADR `2026-07-27_mc-flight-log-panel.md`)
- `/plan-review-triage` Write residuals: required Broad Intake (same buckets/labels as `/backlog-add`) before propose + write-confirm; batch uniform path uses one intake + one combined backlog plan (ADR `2026-07-28_triage-write-residuals-via-backlog.md`)
- Mission Control Flight Log: typed notification chrome (kind → palette tokens); broaden `normalizeHandoffGaps` so `none.` / empty OK placeholders do not render as yellow Live Gaps; writer guidance + ADR amend `2026-07-27_mc-flight-log-panel.md`
- Flight Log OK normalize: case-insensitive `none.` / `N/A` prefixes; widen OK separators `(;/)`; muted Earlier `ok`/`warning` CSS; parity + CSS-rule pins (ADR amend)
- Plan-monitor staging hygiene: intentional monitors add-by-name (prefer separate docs commit); residuals executors append Closed-by only (ADR `2026-07-29_plan-monitor-staging-hygiene-r14-r15.md`)

### Fixed

- Path C broadcast hermetic test: assert exact injected `start-broadcast.mjs` path (parity with `start.mjs` sibling)
- CLI lint: Biome format on `packages/cli/src/dashboard/guards.test.ts` (unblocks CI Lint inherited from multi-workspace isolation)
- Path C discovery tests: hermetic `moduleUrl`/tmpdir fixtures so CI Test before Build does not depend on gitignored `packages/cli/dashboard/`; restored missing-asset null cases
- Mission Control `/dashboard` from a consumer workspace: snapshot `MISSION_CONTROL_REPO_ROOT` (plans/HANDOFF/git) while serving UI from the kit host; CLI discovers kit via env, sibling `../agent-kit`, or bundled package assets (Path C)

### Changed

- `turbo.json` build outputs include `dashboard/**` so cache hits restore the Path C sync copy
- Docs: CONTRIBUTING / repository-boundaries / npm-publish-checklist note that the CLI pack includes `dashboard/**` after Path C publish (not claimed for current npm `4.8.0`); pack verify script `scripts/verify-cli-dashboard-pack.mjs` (version bump remains `/git-prod`)
- Public positioning: README / getting-started / install.md / L0 `/dashboard` tell the truth that L0 does not copy `dashboard/` into the app; Path C ships the panel with the CLI after the next publish (not claimed for npm `4.8.0`)
- Personal-local-only success criteria amended for Path C; snapshot-root ADR notes CLI package as allowed kit host
- `/dashboard` / `agent-kit dashboard`: verify `system.repoRoot` before reuse; do not assume `:3333`; document kit discovery (`MISSION_CONTROL_KIT_ROOT` / `AGENT_KIT_HOME` / sibling / bundled); L0 command rewritten as start.mjs-first quick path (no cross-workspace kill)

### Added

- Mission Control Path C packaging: `@dadado/agent-kit-cli` publishes `dashboard/**` (build/`prepack` sync from repo-root SoT); `agent-kit dashboard` / `dashboard-broadcast` resolve bundled `start.mjs` when cwd/env/sibling lack a kit host (ADR `2026-07-28_mission-control-ship-dashboard-with-cli.md`)
- Mission Control multi-workspace isolation: stable listen port per `MISSION_CONTROL_REPO_ROOT` (hash in `3333–3588`); concurrent instances; never kill another workspace's listener; `system.port` + header workspace basename
- `scripts/verify-cli-dashboard-pack.mjs`: blank-folder / `npm pack` acceptance for Path C dashboard assets (no live npm tag required)

## [4.8.0] - 2026-07-28

### Fixed

- CLI lint: Biome format on `external-review.ts` headless args and non-null assertion in cadence batch test (unblocks tag CI `publish-npm` / `sync-public`)
- Version parity: bump `.cursor/agent-kit.json` and `.cursor-plugin/plugin.json` to 4.8.0 (L0 inventory test)

### Changed

- Mission Control Current mission: operator-friendly Mode labels (`auto mode`, `run all (batch auto mode)`, `human-in-the-loop (manual)`; STOPPED cues preserved) and looping Mode meta icon while executing (display-only; HANDOFF Mode tokens unchanged)
- Mission Control Flight Log: wipe `.cursor/context/flight-log.json` Earlier history on flight boundary (new plan / queue start / Plan none); keep within-flight cap 15; Gaps natural-voice guidance (handoff template + L0); softer idle/support/warning chrome (**Quota pause** / **Heads up**); ADR amend `2026-07-27_mc-flight-log-panel.md`
- Mission Control Checklist: display order is role-priority (`executing` → `next_up` → `queued` → `completed_in_queue` → others), not approved-queue index; ADR amend `2026-07-26_cockpit-run-plan-all-queue-awareness.md`
- Mission Control Crew Monitor: `MONITOR_FEED_CAP` single source of truth in `semantic-model.mjs`, exposed as `missionControl.monitorFeedCap` (dashboard.html no longer duplicates the literal)
- CLI: NodeNext sibling type shim `dashboard/lib/semantic-model.d.mts` so `tsc --noEmit -p packages/cli` accepts the orchestrator test `.mjs` import
- Plan audits launcher: remove dead `launch_visible_terminal()` alias (`launch_background_terminal` remains)
- Plan audits autonomous arm: prefer inspectable background/headless PTY (tmux/screen, then macOS Terminal without `activate`) instead of OS Terminal focus; `--focus-terminal` / `AGENT_KIT_AUDIT_FOCUS_TERMINAL=1` rollback; honesty ban on silent agent-shell `claude -p` unchanged (`2026-07-28_audits-headless-terminal-honesty.md`)
- `/plan-review-triage` Write residuals plan: enqueue via `/backlog-add` contract in-session (write-confirm Ask → plan file + HANDOFF Backlog; no Gate B / clipboard `/start-project` happy path); batch uniform Write residuals may enqueue one combined plan (`2026-07-28_triage-write-residuals-via-backlog.md`)
- Mission Control Flight Log: clipboard icon (replaces PTT radio); operator labels **Live** / **Earlier** (not Current/Past Gaps); operator Warnings lane (API/usage limit, orchestrator heads-up; no cadence/Review CTAs); ADR amend (`2026-07-27_mc-flight-log-panel.md`)
- Mission Control Crew Monitor: denser `agent_step` feed for active-plan completed/running to-dos (kinds `run_plan` / `handoff` / `delivery` / `agent_step`; display cap 20); glossary amend (`2026-07-27_crew-monitor-vs-plan-monitor-glossary.md`)
- README Cockpit + getting-started / external-plan-review: Flight Log Live/Earlier + Warnings; Crew Monitor denser step feed

### Added

- Mission Control **Flight Log** (ex-Field Report card): HANDOFF Gaps only as current (large) + past (smaller) clickable cards; gitignored `.cursor/context/flight-log.json` history ledger (cap 15); ADR `2026-07-27_mc-flight-log-panel.md`
- Opt-in Mission Control LAN broadcast: `/dashboard-broadcast`, `agent-kit dashboard-broadcast`, `npm run dashboard:broadcast`; non-loopback bind requires `MISSION_CONTROL_TOKEN`; static/snapshot/SSE gated; config writes stay loopback-only (`2026-07-27_mission-control-opt-in-lan-broadcast.md`)
- ADR: Mission Control opt-in personal LAN broadcast (`/dashboard-broadcast` + token gate); narrowly supersedes personal-local-only for trusted LAN only; `/dashboard` stays loopback-first (`2026-07-27_mission-control-opt-in-lan-broadcast.md`)
- ADR: `/plan-review-triage` batch HITL when multi-path outcomes are uniform (one Ask; durable heading on every target; sequential fallback when mixed); Field Report **Review all** paste target unchanged (`2026-07-27_plan-review-triage-batch-uniform-hitl.md`)
- Plan audits launcher: `--wait-monitor` freshness (`mtime >= arm-epoch` or `<!-- audits-wait-fresh: created|updated -->`); dry-run prints arm-epoch and stale/missing; exit `3` on stale timeout
- ADR: mandatory chat `--wait-monitor` with freshness gate and same-session triage Ask; ban Final HANDOFF "after monitor lands" as happy-path continue (`2026-07-27_audits-wait-freshness-enforce.md`)
- Plan audits launcher: optional `--wait-monitor` / `--wait-timeout` (default 900s) to poll for `plan-monitor-<slug>.md` after visible arm or standalone; exit `0` created/ok, `3` timeout, `4` soft-fail while waiting; dry-run prints wait path/timeout (ADR `2026-07-27_audits-post-spawn-monitor-watch-continue.md`)
- ADR: post-spawn monitor watch then continue to `/plan-review-triage` Ask after visible autonomous audit arm (honesty until monitor file exists; triage and `/git-prod` HITL intact) (`2026-07-27_audits-post-spawn-monitor-watch-continue.md`)
- `externalPlanReview` config keys for autonomous audits: `mode` (`paste` | `autonomous`), `midBatchAudits`, `preflight` (`off` | `warn` | `block`); Mission Control Config allowlist + UI; example + docs + guards tests
- L0 audits pre-flight on `/continue-plan`, `/run-plan`, `/run-plan-all`, `/hotfix` (`preflight` off/warn/block); exhaustion and `/run-plan-all` mid-batch arming prefer visible autonomous launch when `mode: autonomous`

### Fixed

- Mission Control: delete orphaned Field Report attention-stack render helpers + CSS from `dashboard.html` (Flight Log Gaps-only); retarget pinning tests; rewrite `/field-report-resolve` and getting-started so they no longer describe Resolve all / Review all MC UI
- Dogfood memory: wait-monitor false-ready on pre-existing `plan-monitor-*.md` (existence-only poll); freshness gate + mandatory chat `--wait-monitor` (`errors/2026-07-27_audits-wait-monitor-stale-preexisting.md`; ADR `2026-07-27_audits-wait-freshness-enforce.md`)
- Dogfood memory: cadence WARNING already-clear claim-check is a no-op close (empty ledger + dismissed window id = `subject_resolved`; cancel triage/product-fix when owed set empty) (`decisions/2026-07-27_cadence-warning-already-clear-claim-check.md`)
- Dogfood memory: autonomous launch then manual `done` continuation dual-fence (`errors/2026-07-27_audits-autonomous-launch-manual-done-continuation.md`); docs Troubleshooting row for wait-then-triage
- Dogfood memory: paste dual-fence, invisible agent-shell `claude -p`, and bare `/plan-review-triage` footguns (`errors/2026-07-27_audits-*`); prefer-autonomous decision note
- Audits ADR: autonomous plan review contract (visible auto-launch, mid-batch + queue-end audits, audits pre-flight on plan-run commands; paste-only demoted to fallback) (`2026-07-27_audits-autonomous-plan-review-contract.md`)
- Plan audits launcher: visible auto-launch (`--autonomous` / config `mode: "autonomous"`) via macOS Terminal.app or Linux emulator; `--paste-only` fallback; `--dry-run`; mid-batch `--batch` arms; soft-fail if `claude` missing; headless CLI always passes `--print`
- Glossary ADR: Crew Monitor (Mission Control live-activity UI) vs `plan-monitor-*.md` / Field Report external-review evidence; file/DOM/CSS conventions unchanged (`2026-07-27_crew-monitor-vs-plan-monitor-glossary.md`)
- `/hotfix`: L0 command for narrow urgent work (confirm → mini plan ≤4 to-dos → `/run-plan` tick contract); ADR `2026-07-27_hotfix-command-mini-plan.md`
- Mission Control product posture ADR: personal local-only (loopback-first); remote/shared multi-user auth/CSRF rejected as product goal (`2026-07-27_mission-control-personal-local-only-posture.md`)

### Changed

- Mission Control: Field Report card/nav renamed **Flight Log**; Gaps move off Current mission into Flight Log; attention-stack Review all / Resolve all / cadence rows leave that panel (autonomous audits remain the review path) (`2026-07-27_mc-flight-log-panel.md`)
- Mission Control Checklist: plan Actions **Start** → **Run (manual)** (`/continue-plan`) + **Run (auto)** (`/run-plan`); header **Add all** → **Run all** (still copies `/run-plan-all`); copy-only paste unchanged (`data-focus-key="checklist-add-all"` stable). ADR `2026-07-27_mc-checklist-run-manual-auto-labels.md`
- L0 `/plan-review-triage` Step 6 + HITL table: multi-path uniform batch Ask (durable heading per file); mixed sequential fallback; external-review / **Review all** / queue-end copy prefer one paste + one Ask when uniform (does not reopen wait-freshness or cadence-clear owners)
- L0 chat audits: always `--force --autonomous --wait-monitor` on autonomous arm; AwaitShell until exit `0|3|4`; mid-batch one arm+wait (or one `--batch` + wait_all); queue-end triage with explicit path list (`/run-plan`, `/run-plan-all`, `/plan-external-review`, HITL gate table; ADR `2026-07-27_audits-wait-freshness-enforce.md`)
- L0 audits post-arm: after visible autonomous (or paste-then-running) audit arm, wait for `plan-monitor-<slug>.md` then continue into `/plan-review-triage` Ask (`/run-plan`, `/plan-external-review`, `/run-plan-all` queue-end); mid-batch waits for file only (no mid-queue triage Ask); never claim finished without the file; `/git-prod` stays separate (ADR `2026-07-27_audits-post-spawn-monitor-watch-continue.md`)
- Mission Control Current Mission card (`#now-execution-panel`): Spotlight stack — Gaps alert above the stepper when present; Current step remains the sole full body; Previous/Next compact muted one-liners; meta + copy actions as a quiet footer (CSS/markup order only; ADR `2026-07-27_mc-current-mission-spotlight-stack.md`)
- `/run-plan` Auto no-regression hygiene: never co-pack Task with staging AwaitShell / parallel heavies; first-tick Auto cooldown recommend (15000) when `interTickCooldownMs` is `0` without changing the global default; plan authoring splits docs-only vs product ticks for more inline-first (ADR `2026-07-27_auto-run-no-regression-invariants.md`)
- Mission Control: Per-plan queue-role Checklist pills (NEXT UP / QUEUED / executing / queue done) use transparent backgrounds (color + mark cue only); lifecycle and attention pills stay solid fills
- Mission Control: operator-facing Cockpit nav/card label is **Crew Monitor** (README Cockpit table + plugin-ux assertions); distinguishes live-activity UI from Field Report `plan-monitor-*.md` evidence (DOM `#hero-activity`, CSS `.monitor-row*`, icon kind `monitor` unchanged)
- Docs honesty: consumer `npx` / `install.md` installs kit L0 only; Mission Control `dashboard/` runs from an agent-kit tree that ships `dashboard/start.mjs` (README, getting-started, install.md prerequisites Node 20+)
- Getting started: short After install checklist (personal path); `/agent-kit-onboard` notes Mission Control as optional post-essentials (not a blocking readiness check)
- Mission Control Monitor delivery subtype chip glyphs (BMP): feat✦ fix⚙ docs✎ chore⚒ pr⑂ ship✈ (colors unchanged; PR no longer shares plan_progress ⚑)
- Mission Control Monitor: solid resting chips only (no inset kind ring) with distinct delivery subtypes by Conventional Commit / PR shape (`feat` / `fix` / `docs` / `chore` / `pr` via `refs.commitType`; cyan ✔ fallback); live-actions-only allowlist unchanged (`run_plan` / `handoff` / `delivery`)

### Fixed

- Mission Control Field Report cadence WARNING: hairline separator on `.attention-actions-per-plan` so bulk CTAs and the per-plan Copy review list read as two visual tiers (copy-only behavior and button order unchanged)
- Mission Control Field Report cadence: bulk CTAs (Copy batch external review + Copy resolve) sit apart from the per-plan Copy review list; long `--batch` shell targets copy via `data-copy-*` (not onclick JS literals) with paste-only toast/title honesty
- Mission Control: primary scroll regions (`.content`, `.panel-scroll-body`, `.live-activity-feed`) use `--mc-scroll-gutter` so inner cards clear the 6px scrollbar thumb; panel scroll-offset preserve unchanged
- `/run-plan` `inline_first`: clarify ignore-unless-lightweight (not force-inline); failed worker_type / product `read_scope` / findings checks ignore the flag and stay Task; no silent inline after Task API-limit abort (`context-guardian` + stop table); ADR `2026-07-27_run-plan-inline-first-qualification-gap.md`
- `/plan-review-triage` bare (no paths): select **untriaged** monitors (git-fresh → HANDOFF-aligned → scan), never "newest mtime wins" alone; external-review launcher + prompt print explicit `/plan-review-triage` path lists after review so batch monitors are not missed behind bulk-touched older files
- Port B `install.md`: include `.cursor/scripts/field-report-cadence-bump.sh` so the drag-install table matches `L0_ARTIFACTS` / registry (canonical-inventory test)
- Mission Control Field Report: `listUnreviewedReviewTargets` records every External-report slug before the triage gate so terminal plans with an already-triaged monitor are not counted as owed (cadence ADR §4)
- Mission Control header: inset Home / Refresh / More hitboxes (`--mc-header-control-size: 24px`) so hover fill no longer flushes the 32px header borders; tighter trailing pad (`--mc-header-pad-x-end`) so More sits closer to the IDE ellipsis; HANDOFF health treats present idle Plan (`none` / null) as ok (missing/unparsable HANDOFF still warns)

### Added

- Mission Control Current mission: mode-aware copy-only **Copy `/continue-plan`** plus a short new-chat hint when HANDOFF Mode is manual / continue-plan (idle Quiet cockpit still **Copy `/start-project`** only; continuous/queue keep plan path + staging CTAs). ADR `2026-07-27_mc-manual-mode-next-step-ctas.md`
- Mission Control: harness regression for `#navMoreBtn` / `.nav-more-menu` overflow escape (`position: fixed` + `positionNavMore` / trigger-rect / resize); locks the 2026-07-25 clip fix so header chrome edits cannot silently regress (mirrors Checklist Actions overflow test)
- Mission Control Checklist: **Copy path** in plan Actions menu (clipboard path / filePicker; Start/Edit/Cancel stay chat paste)
- Mission Control: surface HANDOFF `- **Gaps:**` in the Current mission panel (`parseHandoffMarkdown` + `now.gaps`; hide when absent/`none`); closes deferred residual R-06
- Field Report activity review cadence: warning after N `/run-plan` ticks (default 3) or `/run-plan-all` queue complete when unreviewed work remains; gitignored cadence ledger + `fieldReportReviewCadence` config; batch `--batch` paste-only launcher + per-plan CTAs; `/field-report-resolve` accepts `attention:cadence:<windowId>` (ADR `2026-07-27_field-report-activity-review-cadence.md`)

### Changed

- Docs: denser manual plan-mode operator playbook in `docs/getting-started.md` (Ask before unit, one phase per chat, suggest `/git-staging`, new chat → `/continue-plan`) plus an all-modes which-command-next chooser; cross-links from `autogit/plan-routine.md` §5 and README (no Gate A/B or tick-contract rewrite)
- Plan template + `autogit/plan-routine.md`: authoring notes for `inline_first` (opt-in only; ignore-unless-lightweight; good/bad YAML; ADR/docs ticks use `docs-repo` + allowlisted `read_scope`) so false opt-in does not burn Task quota (ADR `2026-07-27_run-plan-inline-first-qualification-gap.md`)
- Docs: Mission Control production-ship constraints (loopback-first, warn-only `HOST`, no remote hosting without a separate auth plan, resource vs Agent-quota boundary) in `docs/getting-started.md`; README Dashboard links to the section
- Mission Control: painted-clip for open `#navMoreMenu` stays an explicit **manual dogfood gate** (DevTools rect / screenshot vs overflow ancestors); CI keeps the PR #403 string/regex lock only (ADR `2026-07-26_mission-control-plugin-ux-validation-depth` — no JSDOM/Playwright). Operator steps live on the `escapes nav More menu…` harness comment.
- `/run-plan` tick-close, worker Rules, `autogit/gitupdate.md` staging Prompt, and command-worker template: reinforce add-by-name staging for `.cursor/memory/plan-monitor-*.md` (no broad `git add` of memory WIP)
- Mission Control Field Report: Copy chat id `title`/`aria-label` uses a documented HTML mirror of `PROMPT_RESUME_GUIDANCE` (ESM cannot load in the inline script); tests lock the two strings together
- Plan-monitor consumer awareness: Broad Intake (`/start-project`, `/backlog-add`), `/continue-plan`, memory-loop CHECK, `/git-staging` hygiene, and named agent prompts consult theme-matched `.cursor/memory/plan-monitor-*.md` (and `plan-review-*` audits); Field Report detection and external-review arming unchanged (ADR `2026-07-27_plan-monitor-consumer-awareness.md`)
- Mission Control Field Report: header **Triage all** renamed **Review all**; bulk copy is gap-filtered (open residuals / Still open / standing findings only); `/plan-review-triage` multi-path skips already-triaged and no-open-residual paths; per-row Copy triage unchanged
- Mission Control: live refresh preserves `.panel-scroll-body` scroll offsets (and re-opens Checklist Actions when the plan key still exists); still yields to in-flight `pendingAnchorScroll`
- Mission Control Field Report: resume guidance for unanswered prompts is tooltip/aria-only on **Copy chat id** (no repeated `.attention-guidance` card body); toast unchanged; copy-only past-chat picker contract preserved
- `/run-plan` + external plan review: enforce `externalPlanReview.autoRemediate` (default false) as a findings-only remediation gate (fix-agent Task vs residuals backlog plan); review workers must not auto-fix product code; launcher injects `autoRemediate` into the Claude prompt; `/run-plan-all` subagent template carries the rule (ADR `2026-07-27_review-workers-findings-only-autoremediate.md`)
- `/field-report-resolve`: prompt claim-check returns `answered` and `subject_resolved` (path/plan evidence basenames only); dismiss when either is true. Dashboard `isPromptClearedByPlanLifecycle` stays exact-`*.plan.md`-refs-only (intentional divergence). ADRs `2026-07-25_mission-control-field-report-source-contract` / `…-dismissals` amended 2026-07-27.
- `/run-plan-all`: external plan review Ask/paste runs **once at queue end** only; mid-queue advances without review pause (non-stop after confirm); Field Report owed covers skipped monitors; supersedes per-plan pause ADR (`2026-07-27_run-plan-all-external-review-queue-end.md`)
- Mission Control: press/scale click animation (`:active` → `scale(0.98)`) applies only to interactive controls (`.health-item`, `.empty-state-btn`); removed from static `.card` panels and dead `.plan-card:active`; `prefers-reduced-motion` overrides stay in sync
- API limit enforcement audit (Phase 4c): HANDOFF template and plan-handoff rule add `- **Gaps:**` machine field and single-plan `- **Mode:**` vocabulary; quota-stop Mode pattern (`— STOPPED: API/usage limit`); `/continue-plan` API-limit pre-flight mirrors `/run-plan`; Ask-questions numbered-list fallback cross-link after Auto→Grok

### Added

- Mission Control: primary Home return outside the More menu (clickable header brand + `#headerHomeBtn` beside refresh, section-title Home back on secondary views); overflow Home kept as secondary
- API limit enforcement (audit Phase 2): `/run-plan` / `/run-plan-all` pre-flight refuse after an API/usage-limit HANDOFF stop until operator confirms recovery; Auto continuous runs recommend `interTickCooldownMs` **15000** (default stays `0`); Mission Control Config hint; ADR amend + decision `2026-07-27_api-limit-enforcement-levers.md`; getting-started model/quota tip; no Mission Control SSE/poll throttle as Agent quota fix
- API limit enforcement audit (Phase 3 close-out): durable plan-review audit Phases 0–3; dogfood checklist verified (limit hit → clean stop → HANDOFF → operator recovery on 2026-07-27, including consecutive Task aborts)

- `/run-plan-all` consolidation apply helper: `.cursor/scripts/run-plan-all-consolidate.sh` registered as L0 (install / `l0.ts` / registry; dry-run default, `--apply --approved`, drop/archive, HANDOFF queue rewrite, merge checklist; backlog CRUD must not rewrite in-flight queue); also aligns `run-plan-all.md` and backlog CRUD commands into `l0.ts` / Port B with the registry
- CLI plan-loop harness: `run-plan-all-orchestrator` decision helpers + vitest guards (confirm Ask blocks dispatch, malformed summary does not advance cursor, HANDOFF queue field round-trip, in-window implement forbid for transcript 606a14a5)
- `docs/getting-started.md`: `/run-plan-all` operator path (when to use, six-way confirm Ask table, resume mid-queue, named-model tip, Checklist Add all); cross-link from `autogit/plan-routine.md` References
- Consumer autoupdate **check** (opt-in, notify-only): `agent-kit update --check [--json] [--respect-prefs] [--stamp]`; config prefs `updateCheck.enabled` / `intervalDays` (default off) and `updateApply.auto` (default `false`); sessionStart advisory via `session-plan-guard.py`; Mission Control Config toggles check prefs only; factory/dev registry skip; apply remains `/update` Ask HITL (never silent L0 write)
- Mission Control Checklist: **Add all** header button (empty and populated) copies `/run-plan-all` for chat paste (`chatInput`); copy-only, no Run queue / HANDOFF writes
- `/update` slash command: consumer-mode Agent Kit layer update from the public registry (version compare, diff, Ask confirm, protected paths respected; distinct from public sync)
- Cursor theme: replace filled astronaut-helmet SVG with stroke helmet mark (matching `agent-kit-cursor-theme.svg`). Normalized viewBox for 16px chrome, `currentColor` stroke. Remove root staging file.
- Cursor theme: redraw spaceIconSvg kinds (current-mission, monitor, field-report, checklist, more-sections) in the thin stroke language (0.5px, matching logo-cursor). Update stroke-width assertion in plugin-ux-validation test.
- Cursor theme: extend spaceIconSvg with section icons for More menu (overview, plans, activity, agents, skills, commands, health, git, memory, terminals, processes, config). Replace decorative colored dots in #navMoreMenu with section icons. Keep live status dots (health, git, terminals, processes) intact.

- Mission Control Field Report: restore unanswered agent-prompt rows (transcript scan → `buildAgentPromptItems`) with copy-only **Copy chat id** (`pastChatPicker`) and **Copy resolve** (`/field-report-resolve attention:prompt:<chatId>`); Resolve all includes visible prompt ids with report ids
- Mission Control design tokens: `--mc-radius-pill` (999px) for slash-command-style status capsules
- Backlog CRUD slash commands (already released via #358; not re-authored here): `/backlog-add`, `/backlog-edit`, `/backlog-delete`, `/backlog-cancel`
- Mission Control Config tab: More-menu Config section edits allowlisted `.cursor/context/config.json` prefs (`autoHandoff`, `interTickCooldownMs`, `externalPlanReview.*`, `agentPersona`) via loopback `PUT`/`PATCH /api/config` (merge-safe; ADR `2026-07-26_mission-control-config-write-allowlist.md`)
- Agent Personas: chat/CLI character packs under `registry/personas/` (`persona.json`, schema `persona-pack.json`) with config key `agentPersona`; bounded compatibility reads for legacy `workspaceSkin`
- Mission Control Cursor Interface Skin: compact astronaut-helmet mark (`dashboard/logo-cursor.svg`) for header and favicon when `data-dashboard-skin="cursor"`; Legacy keeps `dashboard/logo.svg`
- Mission Control Current mission execution timers: discreet total and per-stage (to-do) elapsed in `now-meta`, gitignored local observation ledger (`.cursor/context/mission-timing.json`), freeze on completed, omit on idle; live text tick while executing (ADR `2026-07-26_mission-control-execution-timers.md`)
- Cursor Auto API hit-limit remediation: ADR-lite with symptom matrix (7 rows), hard-stop decision tree, and operator playbook (Phase 0-1)
- `/run-plan` and `/run-plan-all` stop tables: API / usage hit limit stop condition, revert to-do to `pending`, HANDOFF with stop reason, recommended model switch (Phase 1)
- Context-guardian: quota-blocked session section — hard stop with HANDOFF, not "keep coding"; operator message to switch off Auto or wait for quota reset (Phase 1)
- Optional inter-tick cooldown (`interTickCooldownMs`) in `.cursor/context/config.json` for long `/run-plan` Loop and `/run-plan-all` queues (Phase 2)
- Model guidance for long runs: prefer named model (Claude Opus, Sonnet 4.6, Composer 2.5 Fast) over Auto; parallel heavy Tasks discouraged (Phase 2)
- Field Report owed unreviewed plans: `buildOwedReviewItems` detects terminal-lifecycle plans (completed/parked/archived) with no matching `plan-monitor-<slug>.md`; emits `owed` items (capped at 8) with copy-only external review command (`pasteDestination: terminal`); dismissable via ID-only dismissals store; source-contract ADR amended
- Field Report dashboard renders boxed Unreviewed plans group with plan name + copy external review command (`pasteDestination: terminal`); empty states distinguish "no monitors", "no unreviewed plans", and "both clear"; existing Blocking/Debt monitor rows unchanged
- Mission Control cockpit understands the `/run-plan-all` queue: `parseHandoffMarkdown` parses `Run queue`, `Queue cursor`, `Queue status`, and `Queue outcomes` (false-negative policy on backtick noise); the semantic model exposes `missionControl.runQueue`, `now.nextUpPlan`, and per-plan `queueRole` / `queueIndex`; a completed Current mission names the next-up plan on the Next row instead of `None: mission complete` when the queue has more work; Checklist sorts by approved queue order with additive Next up / Queued / Executing role pills (lifecycle pills and executing-only shimmer unchanged; copy-only, no dashboard queue writes; ADR `2026-07-26_cockpit-run-plan-all-queue-awareness.md`)
- Checklist plan lifecycle: HANDOFF Backlog parser accepts both `Backlog plans` (canonical) and `Backlog` (short alias) field labels
- Checklist plan lifecycle: never-started plans (`completed: 0, inProgress: 0`) classify as Backlog instead of Incomplete — fixes `0 of N` false positives for Gate-A queued plans
- `/start-project` Gate A: single composite question merges active-plan disposition and write confirmation — four options with active plan (backlog+write, park+write, modify, cancel), four without (write, write+backlog, modify, cancel); Gate B always offers `Add to backlog` (Mode STOPPED) distinct from `Stop here` (plan stays active); fallback rule: one numbered list per message
- `/update` registered as L0 in `registry/registry.json` and listed in `docs/coherence-inventory.md` so consumer installs receive the slash command
- Mission Control More menu: Home item at the top returns to Overview (`showSection('overview')`) while keeping keyboard roving and Skins radios

### Fixed

- Mission Control Cursor skin: `dashboard/logo-cursor.svg` header/favicon strokes use hardcoded `#e4e4e4` (Cursor `--text-primary`) instead of `currentColor`, which resolves to black under the `<img>` tag (same class of bug as the Legacy logo fill fix)

### Changed

- `/run-plan` inline-first: lightweight docs-only to-dos (CHANGELOG, memory index, L0 markdown close-out) implement in-session during orchestrated runs when `read_scope` is docs-only and there is no findings contract; `inline_first` / `force_task` plan frontmatter; ADR `2026-07-27_run-plan-inline-first-lightweight-todos.md` (quota mitigation after delegation enforcement)

- `/run-plan-all` external plan review: **queue-end only** (non-stop mid-queue); mid-queue skips stay Field Report owed; ADR `2026-07-27_run-plan-all-external-review-queue-end.md` (supersedes per-plan pause)
- `/run-plan-all` PO synthesis: mandatory Task(`explore`) via `command-worker-prompt.md` (main window reviews report + confirm Ask only; inline fallback if Task unavailable); `autogit/plan-routine.md` delegation table row
- Mission Control Checklist pills (lifecycle + queue-role) and Current Mission badge: character mark + UPPERCASE label (CSS `text-transform: uppercase`; JS maps stay Title Case) replaces colored `.dot`; queue-role pill joins the stroke-free solid-fill family (`border: none`, `--mc-radius-pill`, solid `*-bg` surface); next-up mark uses inline SVG monochrome fallback (⏩︎ never renders as colorful emoji); non-color cue tests updated for the frozen mark table; ADRs `2026-07-27_mc-queue-role-pill-stroke-free-marks`, `2026-07-27_mc-pills-uppercase-labels`

- Mission Control Field Report section icon: redraw `paths['field-report']` in `spaceIconSvg()` as a handheld radio with antenna, speaker grille, and side PTT paddle so the glyph reads as radio PTT (not a person) in Cockpit nav, card title, and empty-state hero; remains distinct from More-menu `agents`
- Mission Control live refresh: watch `~/.cursor/projects/<slug>/agent-transcripts/` so Field Report prompt Action rows refresh after transcript flush within `WATCH_DEBOUNCE_MS` (400ms), not only on the 15s periodic; periodic remains fallback when watch is unavailable (source-contract ADR amended)
- Mission Control Monitor section icon: redraw `paths.monitor` in `spaceIconSvg()` as concentric rings + sweep wedge so the glyph reads as radar (not a gauge) in Cockpit nav, card title, and empty-state hero
- Mission Control Legacy skin: `dashboard/logo.svg` outline fills use `#e2e8f0` (header text color) instead of near-black `#3C3C3B` so the astronaut mark stays visible on the dark header; highlight layers and blue-cyan gradient unchanged. Cursor skin still uses `logo-cursor.svg`
- Mission Control Checklist: recent-plan cards replace whole-card **Copy path** with an **Actions** dropdown that copies chat commands (`/continue-plan`, `/backlog-edit`, `/archive-plan`) for Start / Edit / Cancel; copy-only to `chatInput`; Plans accordion and Field Report path copy unchanged
- Mission Control More menu: inject the 12 section icons via `injectCockpitNavIcons()` + `spaceIconSvg()` and remove duplicated inline SVG markup from `#navMoreMenu`; live status dots and item aria/onclick attributes unchanged; a11y name-loop covers all 12 section kinds
- Mission Control Field Report: drop portfolio plan-state NOTE kinds (`backlog` / `parked` / `incomplete`) from the attention stack; Checklist plan cards remain the portfolio surface; empty-state copy covers readiness, unanswered prompts, and External reviews only (source + dismissals ADRs amended; supersedes `field-report-attention-not-portfolio`)
- `/field-report-resolve` and `FIELD_REPORT_ATTENTION_ID_RE` accept `attention:prompt:<chatId>` beside `attention:report:<slug>`
- Mission Control chrome icons: header refresh joins the 16px / stroke-1.5 workbench shell with `spaceIconSvg` and `nowMetaIconSvg`; empty-state heroes scale via `--mc-chrome-icon-size` multiples (no hard-coded 32/28px)
- Mission Control lifecycle, attention-severity, and queue-role pills: use `--mc-radius-pill` capsule geometry (Cursor slash-command style) instead of `--mc-radius-sm` chrome squares; idle monitor chips remain at 999px
- Mission Control Cursor Interface Skin: `dashboard/logo-cursor.svg` swaps stroke line-art for the filled astronaut helmet path (header + favicon at 16px); Legacy `logo.svg` unchanged
- Mission Control dashboard: remove dead `.attention-group-label` CSS (and two dependent selectors) left after Checklist notes UI removal; no markup emitters remained
- Mission Control empty states: Cockpit section empties (Quiet cockpit, Listening, All clear, Empty board / Empty hangar) show the matching `spaceIconSvg` fineline tab icon centered above the headline via optional `iconKind` on `renderEmptyStateCta` (decorative; secondary panels unchanged)
- Mission Control Cursor Interface Skin: replace robot-outline mark with compact astronaut-helmet line art (`dashboard/logo-cursor.svg`, path unchanged); global chrome density via `--mc-header-height: 32px`, header logo on `--mc-chrome-icon-size`, and shared `--mc-status-dot-size: 7px` for `.dot` / `#statusDot` (Legacy `logo.svg` unchanged)
- Monitor return-brief hierarchy: icon-only status chips (kind gloss on hover/aria), colors aligned with Current mission / lifecycle solid tokens (`run_plan` uses executing green), row order chip → structured action line → trailing time, and producer labels as `{actor} · action · …` for tick/handoff/plan/delivery
- Mission Control serve: raise `dashboard-data.mjs` `execFile` timeout from 15s to 60s (override via `AGENT_KIT_DASHBOARD_DATA_TIMEOUT_MS`) so cold snapshots on large dogfood repos no longer flip the badge to Degraded with empty cockpit panels; timeout errors now name the limit explicitly
- Mission Control empty states: shared `renderEmptyStateCta` (headline + support + optional copy-only CTA); cockpit and secondary panels use kit-voice copy; Field Report empty reflects the unified attention inbox (plan-state + readiness + External reviews); CTAs name paste destinations only (no Open)
- Rename chat/CLI character packs from workspace skins to Agent Personas (`agentPersona`, `registry/personas/`, docs `personas-contract.md` / `creating-personas.md`); Mission Control Interface Skins (`legacy` / `cursor`) unchanged
- Field Report unifies plan-state and readiness cards with External reviews in one attention stack (kind + severity pills; severity-first sort); Checklist drops the "Plan states and readiness needing a decision" notes group and keeps plan cards only
- Monitor hero identity: prefer kit agent, else `orchestrator` for delivery rows without an agent, else plan name from `refs.plan`, else System; missing timestamps leave the time column empty (no kind-tag duplicate)
- Monitor classification chips show icon and kind tag at rest (no hover/focus width or opacity expand)
- Monitor feed layout polish: calmer row spacing, clearer chip icons/tags, and stronger identity vs label hierarchy (resting-chip and single-roll contracts unchanged)
- Monitor delivery labels include a brief ship subject (squash title or first absorbed commit) plus PR # and sha, instead of count-only Shipped/Merged strings
- `/plan-review-triage` Write residuals plan copies a ready-to-paste `/start-project with this goal: …` prompt to the clipboard (pbcopy/xclip/clip)
- Mission Control Checklist cards and Plans rows now show ratio progress bars; executing plans shimmer when motion is allowed, while other lifecycle states remain static
- `/run-plan-all` is now a pure orchestrator: after queue confirmation it dispatches one Task subagent per plan (command, L0 mirrors, ADR) instead of implementing plan to-dos in the orchestrator window
- Checklist plan lifecycle: `classifyPlan` fall-through checks `completed > 0 || inProgress > 0` before returning `incomplete`; `0 of 0` plans return `backlog` (implicit queue)
- HANDOFF template now includes `Backlog plans` and `Parked plans` fields in Work Status section
- Monitor hero feed flattened from agent-grouped headers-and-sub-rows to a single flat newest-first list with inline classification chips (icon + kind tag), identity from agent / orchestrator / plan / System (consecutive identical collapsed), and preserved copy-only keyboard affordance; dead stagger classes replaced with per-row `.monitor-row.stagger-fade`

### Changed

- Monitor hero refocused from git-tree display to agent-activity stream: rows group by agent identity with plan context (plans without a declared `agent:` group under `system`)

### Removed

- Mission Control semantic-model: removed stale-group helpers (`FIELD_REPORT_STALE_MS`, `isFieldReportItemStale`, `partitionFieldReportByStaleness`) — no remaining callers after Phase 1 flatten of blocking section; browser bulk-resolve mirror already dead
- Mission Control Field Report tests: removed stale-group and browser-bulk mirror tests that expected the old nest chrome; kept all contract tests for `fieldReportResolveAction` and per-row CTAs (113 tests pass)

### Added

- Mission Control Field Report: header bulk CTAs — **Triage all** copies `/plan-review-triage` with every visible report path (blocking first, then debt); **Resolve all** copies `/field-report-resolve` with every visible attention id; both hidden when empty; new `fieldReportTriageAllAction()` helper in semantic model (202 tests pass)

- Mission Control plugin UX validation: assert dashboard HTML never embeds `vscode://` or `cursor://` protocol URIs (locks the copy-only paste-destinations contract after residual A close)
- Mission Control plugin UX validation: assert all six plan lifecycle keys stay distinguishable without color alone (unique labels, marks, pill text, and aria)
- Mission Control: the semantic model emits durable inventory events (`agent`, `skill`, `command`, `memory` added/removed/changed) with stable ids and previous-baseline dedupe, feeding the upcoming unified Activity feed; the Monitor hero keeps its curated kind allowlist so inventory events never appear there
- Mission Control: the Activity tab renders a unified newest-first feed merging the full semantic stream (including inventory events) with client diagnostic events, deduped and capped, with type accents, per-source labels, and preserved copy-only targets; per-refresh "Data refreshed" rows are replaced by a summarized last-refreshed heartbeat
- Mission Control: the Activity feed gains per-source filter chips (All / Plans / Git / Agents / Skills / Commands / Memory / Terminals / Processes) as a keyboard-navigable radiogroup with focus rings and reduced-motion support, filter-aware empty states, and a `navActivityBadge` that reflects the full unified feed count
- `/archive-plan <plan-file>`: copy-only command that removes a plan from the HANDOFF parked list and moves it into `.cursor/plans/archive/`, confirmed with Ask questions; Mission Control may only copy the command, never mutate in-panel
- `/field-report-resolve <attention-id>`: copy-only command that appends a Field Report attention id to local gitignored `.cursor/context/field-report-dismissals.json` (IDs only, no transcript body); Mission Control Field Report rows expose **Copy resolve command**
- `/field-report-resolve`: per-id claim-check contract — agent must locate, verify, and decide dismiss eligibility for each attention id before appending to the dismissals store; skip when the claim is still open (HITL or triage still required)
- Mission Control: Skins group in the More menu with Legacy (current palette, default) and Cursor (Cursor-like base chrome with Agent Kit semantic highlights); applied without reload, persisted under the `agent-kit:dashboard-skin` browser preference, keyboard accessible with `menuitemradio` selected state

### Changed

- Mission Control Field Report: each External review card shows a short, HTML-escaped findings summary under the label (numbered Residual items, else the Standing finding, else the Full-review Outcome, else `No structured findings extracted`), capped at ~240 characters so a human can triage from the card without opening the monitor file; triage, dismissal, and lifecycle classification are unchanged (ADR amendment `2026-07-25_mission-control-field-report-source-contract.md`)
- Mission Control Field Report: untriaged External reviews stay visible after plan lifecycle demotion; blocking and debt items render in one flat list (blocking first, orange highlight on blockers; no Review debt / Older waits nests or bulk resolve chrome); surfaced cap raised to 20; triage headings and ID-only dismissals remain the only hard hides (ADR `2026-07-26_mission-control-field-report-review-debt-inbox.md`)
- `/plan-review-triage`: supports multi-path sequential walk (`/plan-review-triage <path1> <path2> ...`) with per-monitor Ask questions gates, path skipping for nonexistent monitors, and stopping contract (Phase 3)
- `/field-report-resolve`: bulk copy target wording updated from "Older waits group" to "Field Report header"; documents the Resolve all header button (Phase 3)
- Mission Control Field Report Review debt ADR: render clause amended to reflect shipped flat list (no collapsible stale-group pattern for debt rows; Phase 3)
- Mission Control plugin UX: record that validation stays string/regex against dashboard source (no JSDOM dependency) until a named behavioral regression class justifies richer interaction tests
- Mission Control Cockpit: desktop widths show a 2x2 overview fold (Current mission, Monitor, Field Report, Checklist) without page scrolling, hide the Cockpit subheader, and scroll overflowing panel content internally; the More menu lives in the header at all widths (not only at ≥1024px)
- Mission Control Current mission: the step progress bar shimmers on the current segment (gated by `prefers-reduced-motion: no-preference`, disabled under reduce); the executing status chip drops its glow/pulse and keeps green fill plus the ▶ mark as the live cue
- Mission Control Field Report: section carries only untriaged External reviews (agent prompts and HANDOFF awaiting-user gates no longer appear there; Checklist unchanged)
- Mission Control Field Report: each review row exposes Copy path and Copy triage command (`/plan-review-triage <path>`) for paste into a fresh chat; prompt/handoff chrome removed
- `/field-report-resolve` accepts multiple `attention:report:<slug>` ids in one paste (per-row Copy resolve command; Field Report no longer ships nest-level bulk resolve chrome)
- Mission Control: header Refresh control is a 32×32 icon-only button (inline SVG, `currentColor`); refreshing spins the icon (respects `prefers-reduced-motion`); no-data uses title/aria "Start server" instead of button text
- `/start-project`: when HANDOFF already has an active plan, Ask questions for disposition before writing HANDOFF (`Add new plan to backlog` / `Park current plan and activate new` / `Cancel`); never park the active plan silently. Backlog path keeps the current plan active, lists the new plan under `Backlog plans`, and skips Gate B. Mirrored in `cursor-plan-handoff`, `hitl-ask-questions`, `session-plan-guard`, and `plan-routine`; ADR `2026-07-25_start-project-plan-disposition-gate.md`
- `/plan-review-triage`: every outcome (Write residuals plan, Fix nits only, Ack and stop) must persist a durable `## Triage note` (or equivalent) on the monitor so Field Report clears untriaged rows; Ack and stop no longer relies on HANDOFF alone
- Mission Control: Cockpit top-nav active chrome uses muted fill and transparent border (no blue stroke), aligned with Cursor Plan & Usage
- Mission Control: Field Report attention rows and Checklist plan cards no longer render severity or lifecycle left bars; severity badges remain
- Mission Control: Monitor Recent activity and Activity feed rows drop the colored left rail (CSS and inline); event type stays visible via icon and label, and the presentation test now fails if a left-bar accent is reintroduced
- Mission Control: unanswered-chat rows identify the conversation (first-line snippet, chat id, quiet time, pending question) and pair the copied chat id with past-chat-picker resume guidance, staying copy-only
- `/run-plan` orchestration: review to-dos with a findings `worker_contract` dispatch workers with write access so they author plan findings; orchestrator transcription is fallback only (secondhand label + HANDOFF gap). Cross-linked from `autogit/plan-routine.md`.
- `/run-plan` staging-ready: workers must run applicable formatter/linter checks on touched files and report them under `Tests:` / `Validation:` before `Staging ready: yes`; orchestrator rejects yes without that evidence when formatted/linted files changed (pure markdown with no applicable linter may state none). Mirrored in `plan.md` template and `autogit/plan-routine.md`; cross-links biome format incidents in `.cursor/memory/errors/`.
- Multi-lens plan review findings persist to `.cursor/memory/plan-review-<plan-slug>.md` (versioned audit) at consolidate or plan close; active plans remain gitignored per public-tree guard. Convention in `memory-loop` rule and ADR `2026-07-25_plan-review-findings-durable-home.md`; 24h review backfilled in `plan-review-24h-full-review-and-fix.md`.
- `/summary` closes with an Ask questions gate for the next step (`Continue where we left off`, `Something else`, `Show more detail`); chat fallback when the tool is unavailable.

### Fixed

- Mission Control Checklist: Actions dropdown uses `position: fixed` + `getBoundingClientRect` (same pattern as nav More) so Start/Edit/Cancel are not clipped by `#recent-plans-panel` / `.panel-scroll-body` overflow; prefer open above, flip below when space above is tight
- Mission Control HANDOFF parsing: accept plain (no-backtick) `- **Plan:** name.plan.md` and recover Backlog/Parked/Run queue lists written as `##` headings when the `- **Field:**` bullet is missing; session hard rule + format warning steer writers back to bullet fields (ADR `2026-07-26_handoff-machine-field-contract.md`)
- Monitor delivery attribution: each delivery event resolves its plan from its own merge branch (exact plan-basename match after conventional-prefix strip); unresolvable branches carry no attribution instead of inheriting the active plan's name
- Monitor coalescing: the merge is the anchor and absorbs the commits beneath it, so real squash and merge histories collapse into one attributed delivery row and feature commits are no longer dropped; squash-merge commits anchor their own delivery; the unimplemented `windowMs` time-window claim was removed from the producer docs
- Monitor delivery rows: `refs.sha` restores the copy-only and keyboard contract (`role`, `tabindex`, `aria-label`, copy handler), `.monitor-sub-row` gains a token-based hover, and the stagger animation binds behind `prefers-reduced-motion`
- Monitor/Activity stream: each merge renders once (raw merge and absorbed commit rows superseded by a delivery are dropped), delivery events are no longer starved by the activity cap (producer `limit`), and `plan_progress` events carry the plan's `agent`
- Plan template and `autogit/plan-routine.md` document the plan-level `agent:` attribution field (kit agent id from `.cursor/agents/`, null fallback grouped as `system`, distinct from per-to-do `worker_type`)
- Mission Control Field Report: clear agent-prompt rows when every exact `*.plan.md` reference in the pending question is completed or parked/exhausted; demote External-review rows for the same terminal reviewed-plan lifecycle without marking them triaged (unknown or missing plan refs stay visible)
- Mission Control Field Report: lifecycle clear parses plan references from the untruncated pending question, so a live multi-plan wait whose active reference sits past the 200-character display cutoff is no longer cleared by a terminal reference before it
- Mission Control Field Report: a plan record whose frontmatter parses zero to-dos resolves as unknown for attention clearing (not completed), so a parse failure cannot hide a live prompt or External-review row on false terminal evidence
- Mission Control Field Report: the browser bulk resolve helper validates the attention-id allowlist before building the copied command, mirroring the semantic model so malformed snapshot ids cannot enter clipboard text
- Mission Control: refresh control is borderless with transparent idle background (fill only on hover), uses a centered Feather-style SVG, and spins on `transform-origin: 50%` so the icon no longer wobbles off-axis
- Mission Control: typography follows Cursor workbench defaults (`system-ui` sans, `13px` / weight `500` chrome labels, `16px` icons, `12px` descriptions, separate mono stack) instead of mixed sizes and a mono-in-UI font stack
- Mission Control: extend Cursor chrome scale tokens to More-menu labels, count badges, refresh icon box, and discreet meta icons (regression-locked; no lifecycle pill restyle yet)
- Mission Control: shared `--mc-*` structure tokens for radius, spacing, card/header padding, and meta type; Legacy/Cursor skins stay color/surface overrides on the same ladder
- Mission Control: lifecycle and Field Report severity labels use solid semantic fills (no outline), sharing one pill rule on the Cursor chrome ladder; adds `--orange-bg` for incomplete/warning
- Mission Control: polish pass removes dead refresh-flash CSS, aligns feed icons to the chrome icon token, and keeps focus-visible / reduced-motion contracts under live refresh
- Mission Control: Current mission status badges join the solid chip family (filled semantic surface, no outline, chrome tokens); live pulse and its reduced-motion fallback glow without a perimeter ring, and state marks plus the idle pill radius carry the non-color cues
- Mission Control: Checklist recent plan cards list up to 10 plans instead of 5
- Mission Control HANDOFF parsing: Parked/Backlog plan sections are multi-line blocks; only `*.plan.md` refs count (branch names and monitor paths ignored); `Backlog plans` is a first-class lifecycle with badge/sort/Checklist notes, mirroring parked zero-open → completed
- Port B `install.md` table includes `.cursor/commands/field-report-resolve.md` so the L0 inventory stays aligned with `packages/cli/src/lifecycle/l0.ts`
- Mission Control Checklist: readiness advisories stay while a check is `needs_choice` and clear only when the doctor report turns ready or `onboarding.deferredItems` records an explicit deferral with a reason; readiness rows carry the pillar `checkId` so `collaboration.provider` matches the `confirm-provider` action
- Mission Control live refresh: compact pretty-printed snapshots to a single SSE `data:` line, count silence only after validated payloads, keep periodic flush off the watch debounce, and generate snapshots asynchronously so the Live badge cannot mask a frozen panel
- Mission Control plan lifecycle: a parked plan with zero open to-dos classifies as completed instead of staying `PARKED` at N/N, while parked metadata is preserved
- Mission Control plan lifecycle: a HANDOFF that reports STOPPED or exhausted with all to-dos terminal classifies as completed even when the mode string mentions `orchestrated`, instead of reporting a live run
- Mission Control: Current mission and the overview footer stop presenting an exhausted plan as active
- Mission Control: a completed plan keeps the Current mission panel with a COMPLETED status, full N/N progress, its final completed step, and honest copy-only actions instead of collapsing to the IDLE empty state; IDLE is reserved for snapshots without a HANDOFF plan reference
- Mission Control lifecycle: HANDOFF transitions trust plan to-do status, so pending or in-progress work cannot render as completed or idle during the final tick, and terminal work remains visible as completed
- Mission Control semantic model emits `PASTE_DESTINATIONS` keys (`chatInput`, `pastChatPicker`) for `pasteDestination` instead of human label strings
- Mission Control: remove dead native-open helpers (`buildEditorFileUris`, `joinRepoRoot`) and unused `system.repoRoot` snapshot field left after the copy-only decision
- Mission Control empty-state copy uses colons instead of em dash sentence connectors (All good, No plans yet, No commands registered, and similar)
- Superseded ADR for protocol-open trimmed to history-only; current behavior remains the 2026-07-25 copy-only paste-destination record
- L0 commands (`/start-project`, `/git-prod`, `/run-plan`, `/summary`): em dash sentence connectors replaced with colons or punctuation per kit hygiene
- Public sync auto-merge uses squash merge (`--squash --auto`) so CI matches the public repo ruleset (merge commits disallowed)
- `sync-public` CI job fails when `PUBLIC_REPO_TOKEN` is unset on tag or manual sync runs instead of exiting green with no sync
- `/continue-plan` HITL gate uses Ask questions with concrete options; typed "yes" is no longer the confirmation path

## [4.7.2] - 2026-07-25

### Fixed

- Public-sync dashboard allowlist guard skips when `scripts/public-sync.manifest` is absent (private-only file), so the public mirror CI stays green

## [4.7.1] - 2026-07-25

### Fixed

- Public sync allowlists `dashboard/**` so Mission Control sources reach the mirror with the CLI dashboard tests that import them
- Regression guard: `packages/cli/src/dashboard/public-sync-manifest-guard.test.ts` fails when synced dashboard tests depend on paths outside the allowlist

## [4.7.0] - 2026-07-25

Follows 4.5.1. Version 4.6.0 was withdrawn after release because it carried an unfinished dashboard; that number stays retired and is not reused. This release ships the completed Mission Control panel.

### Added

- `agent-kit dashboard` / `npm run dashboard` (`dashboard/start.mjs`): terminal counterpart to `/dashboard`; detach-starts Mission Control if needed, waits for HTTP 200, prints the URL, and opens the default browser
- Decision record: Mission Control actions are copy-only and name a paste destination (`.cursor/memory/decisions/2026-07-25_mission-control-copy-only-paste-destinations.md`), superseding the 2026-07-24 protocol-open record
- Mission Control plugin UX validation suite (`packages/cli/src/dashboard/plugin-ux-validation.test.ts`): narrow/mid layout media queries, reduced-motion, keyboard accordion/focus preservation, empty states, copy-only CTAs that name their paste destination, SSE+polling fallback, Cockpit anchors plus the More sections menu with no horizontal tab track, Cockpit order (Current mission → Monitor → Field Report → Checklist), nav/heading label parity, the space icon set, lifecycle visual keys, and hardening regressions (XSS helpers, read-only serve, loopback CORS)
- Mission Control Field Report renders `missionControl.attention` below Current mission and carries only what waits on a human reply: agent prompts awaiting an answer, external reviews awaiting triage, and the active handoff gate, each with a copy CTA and an empty state
- Mission Control Field Report source, agent prompts awaiting a reply: a transcript surfaces when its last agent-question tool call has no user entry after it, read from the project transcript store (30-day window, 60 files, 1 MB per file, 8 items rendered, `subagents/` transcripts ignored), with a copy action for the past-chat picker (`packages/cli/src/dashboard/field-report-prompts.test.ts`)
- Mission Control Field Report source, external reviews awaiting triage: a `.cursor/memory/plan-monitor-<slug>.md` report counts as triaged when it carries a triage heading or when a plan other than the reviewed plan names the report slug or the reviewed plan; untriaged reports copy the triage command with the report path (`packages/cli/src/dashboard/external-reports.test.ts`)
- Decision record: Mission Control Field Report source contract, covering both detection rules and the weaker signals rejected against real local data (`.cursor/memory/decisions/2026-07-25_mission-control-field-report-source-contract.md`)
- Shared inline SVG space-theme icon set with accessible names, used by the Cockpit section headings and the navigation, with no icon font, sprite fetch, or frontend dependency
- Static asset regression test (`packages/cli/src/dashboard/static-assets.test.ts`): every root-absolute `src`/`href` in the panel markup must resolve to a real file under `dashboard/`, so an asset URL cannot 404 silently
- Mission Control semantic snapshot model (`missionControl.now` / `activity` / `attention` / classified `plans`) in `dashboard/lib/semantic-model.mjs`, wired into `dashboard-data.mjs` (schema 1.2.0) with fixture tests
- Mission Control guard unit tests (config allowlist, git.files shape, static path lockdown, CORS, loopback bind); helpers in `dashboard/lib/guards.mjs`
- Local Agent Kit dashboard, branded **Mission Control** (`npm run start:dashboard`, port 3333), with live activity indicators, SSE heartbeat, process/terminal diffing, and responsive/a11y polish
- `/dashboard` command: starts `dashboard/serve.mjs` if port 3333 is free and opens Mission Control in Cursor Simple Browser; registered in the L0 inventory
- Mission Control git section lists staged/unstaged/untracked files with copy-only diff commands
- **Observability overhaul** in Mission Control: status bar with live system metrics, real-time activity feed with delta badges, clickable CTAs (plans, commands, agents, memory, terminals, git, health), SSE connectivity indicators, process health monitoring, terminal popups, git diff viewer, micro-animations, loading skeletons, and responsive layout
- Mission Control terminal list shows capped `lastOutput` previews from the snapshot payload
- Mission Control Processes section: Copy PID CTA per process row (no kill/restart)
- Mission Control Git section: bounded dirty `files[]` from `git status --short` (paths only), status badges, and copy-to-clipboard staged/unstaged `git diff` commands per file
- Error memory entry: public sync PR merge-blocked by ruleset and merge-commit method ([public-sync-pr-merge-blocked-ruleset](errors/2026-07-24_public-sync-pr-merge-blocked-ruleset.md))
- Decision record: Mission Control local-only security posture (`.cursor/memory/decisions/2026-07-24_mission-control-local-only-security.md`)
- Repository personalization profile (`.cursor/context/personalization.json`, `.cursor/project-context.md`, `AGENTS.md`) with matching manifest packs and protected paths in `.cursor/agent-kit.json`
- `docs-repo` core skill and `cursor-skills-node` community skill
- DevOps scaffolding templates: `templates/CODEOWNERS` and GitLab CI templates for content, Node plus Docker, and frontend plus Firebase repositories

### Changed

- Mission Control Cockpit page drops the redundant page-level `Cockpit` section title; the primary nav link remains the name for that page
- External review chat prepares a visible paste for an interactive Claude run, while CI remains headless; the launcher uses `--permission-mode auto`
- `/start-project` and session readiness block only unresolved essential checks; non-essential provider confirmation remains advisory
- Mission Control actions are copy-only and name the destination that receives the paste: repo-relative paths go to the file picker (Cmd+P / Ctrl+P), slash commands to the chat input, chat references to the past-chat picker, and shell commands, PIDs, working directories, and commit shas to the terminal. No label, tooltip, aria-label, or confirmation claims a native editor open, and there are no Stage or Restart controls the panel cannot perform. The snapshot action contract carries `path` / `copy` types with `subject` and `pasteDestination`
- Mission Control navigation: four Cockpit anchors (Cockpit, Monitor, Field Report, Checklist) plus a More sections menu holding Plans, Activity, Agents, Skills, Commands, Health, Git, Memory, Terminals, and Processes with their counts, replacing the hamburger drawer and the horizontally scrolling tab track; the menu is keyboard operable, closes on Escape and on outside click, and returns focus to its trigger, and the narrow panel no longer shows a horizontal scrollbar
- Mission Control Cockpit sections read Current mission, Monitor, Field Report, then Checklist, each led by an icon from the shared set, with navigation labels that match the headings
- Mission Control Checklist owns plan-state items: parked plans, incomplete plans, and the non-essential readiness note moved out of Field Report and render next to the plan cards, and a note is dropped when its plan already renders as a card
- Mission Control Current mission card: Previous → Current → Next stepper with a segmented step progress bar, deriving previous from completed todo statuses (`previousTodo` in the semantic view model)
- Mission Control executing badge: green live pulse (`now-status-live`); remove redundant companion status dot; awaiting/idle stay distinct without color alone; reduced motion kills the pulse
- Mission Control Current mission meta: Mode and Updated demoted to discreet icon-led rows (inline SVG with accessible names and tooltips)
- Mission Control Checklist shows a plan card set (lifecycle status, `x of x` progress, datetime, Copy path) sorted executing then attention then mtime; the Plans section uses keyboard-accessible accordions with full todo lists (narrow: one open unless Shift-click or Multiple open)
- Mission Control Monitor feed renders the semantic `missionControl.activity` sequence (run-plan ticks, merges, staging, commits, plan progress) with copyable plan paths and commit shas; terminal/process churn stays in the Activity diagnostic section
- Mission Control Current mission panel reads `missionControl.now` (status text, plan, x of x, mode, current/next todo, last update) and refreshes from each SSE snapshot while preserving focus, scroll, and expanded agent rows
- Mission Control narrow plugin shell: single header transport/freshness signal, removed status-bar and metric-card chrome, demoted inventory behind secondary navigation, and tuned layout for ~360–520px Cursor panels
- Mission Control render hygiene: pause background polling only when SSE is not live; restore nav hairline active state; remove dead section-loading helpers; dedupe card-flash CSS
- Mission Control accessibility pass: `:focus-visible` rings on interactive controls, keyboard activation for plan/process/git rows, scoped `aria-live` updates, `prefers-reduced-motion` overrides, and improved muted text contrast
- Mission Control server binds `127.0.0.1` by default (`HOST` override), serves only `dashboard/` static assets, and applies localhost-only CORS
- Mission Control branding across the dashboard: SVG logo asset, page title, favicon, server banner, data-model description
- Active navigation item uses a 1px hairline border instead of a left accent bar, with reserved border space so the active state does not shift layout
- Dashboard snapshot generation caps terminal file reads (64 KB, 40 files) and process listings (50 entries), and reads git ahead/behind without shell fallbacks
- Registry rebuilds preserve curated non-L1 artifacts instead of silently dropping them
- Repository readiness plan triage note: verified CLI tests pass (86/86), residual A closed
- `/dashboard` open path: try in-IDE browser once, then clipboard + Simple Browser / external browser instructions (no retry loop on localhost crash)
- Mission Control snapshot allowlists config fields for the dashboard payload instead of exporting full nested onboarding/readiness objects

### Removed

- Mission Control header **Copy start** control (false-positive when Live but process label missing). Start from the terminal with `npm run dashboard` / `agent-kit dashboard`, or from chat with `/dashboard`

### Fixed

- Mission Control header logo and favicon render from a served response: the panel requested `/dashboard/logo.svg` while the static resolver already roots request paths at `dashboard/`, so the URL resolved to a nonexistent `dashboard/dashboard/logo.svg` and returned 404
- Mission Control More sections menu is no longer clipped by the `overflow: hidden` nav row that suppresses the horizontal scrollbar: the menu anchors with fixed positioning computed from the trigger rect and scrolls internally when the viewport is short
- Mission Control Cockpit anchors finish their scroll across a live refresh: a snapshot re-render used to restore the scroll position captured while the anchor was still travelling, leaving the reader part way to the section
- Mission Control terminal expand controls carry an accessible name that says which terminal they belong to
- Mission Control degrades a failed snapshot into empty panels: the server error payload now carries every collection the panel reads, so a data failure no longer surfaces as a render error
- `/dashboard` now daemonizes Mission Control so the server survives the agent shell, verifies liveness in a separate call, and treats browser connection errors as a dead-server signal
- Mission Control live refresh: expand `.cursor` watch coverage (readiness, agents, skills, commands), periodic SSE broadcast for non-file sources (git/terminals/processes), and resume poll on SSE silence so the panel no longer stays stale while transport shows Live
- Mission Control polling no longer fights SSE-driven renders while the stream is connected
- Mission Control a11y: keyboard-operable table rows, reduced-motion respect for animations, and less noisy live region announcements
- Mission Control dashboard server binds `127.0.0.1` by default, serves only `dashboard/` static files, and restricts CORS to localhost origins on the dashboard port
- Dashboard stayed on the loading pane: the `statusDot` element id shadowed the status helper, and the SSE handler set the loading flag before a debounced render that then bailed on that same flag
- Concurrent HTTP and SSE requests stacked synchronous snapshot child processes; `serve.mjs` now caches payloads for 2s, reuses in-flight generation, debounces watch broadcasts, and bounds generation with a timeout
- Background polling no longer wipes the rendered pane, and section selection is preserved across re-renders instead of resetting to Overview
- Render errors surface an inline failure state with escaped output instead of leaving the panel blank
- Mission Control terminal expand popup uses `data-terminal-id` listeners and DOM construction (no inline `onclick` with output content)
- Mission Control HTML: restore missing `</style>` close and fix activity-feed template join syntax
- Mission Control XSS: escape dynamic HTML, attributes, and JS string contexts in dashboard rendering (`escapeHtml`, `escapeAttr`, `escapeJsString`)
- Mission Control snapshot truncates terminal, process, and git metadata strings and caps terminal/process list sizes
- Mission Control change animations only on real deltas (section hash and metric diffs), not every poll/re-render
- Mission Control LIVE badge tracks transport state (SSE live, polling fallback, reconnecting with attempt count)
- Mission Control plan and memory copy paths are correct and consistent; every copy CTA shows a toast with clipboard-failure fallback

## [4.5.1] - 2026-07-24

### Fixed

- CI and tests made portable to the public mirror (root-scoped plans guard, dogfood fixture skip, L0 registry assertions that tolerate public-owned `registry.json` drift)
- Version manifests (`.cursor/agent-kit.json`, `.cursor-plugin/plugin.json`) kept in sync with package SemVer on release

### Changed

- `.gitignore`: ignore PKCS12/PFX and credential JSON patterns; ignore local readiness snapshot and `agent-kit.config.json`

## [4.5.0] - 2026-07-24

### Added

- Design contract and dogfood acceptance criteria for repository-readiness onboarding, including install-to-agent discovery handoff and the namespaced `/agent-kit-onboard` decision
- CLI readiness model, repository scanner, provider evidence, and portable snapshot contract for application and non-application repositories
- Idempotent safe-readiness fixes with dry-run evidence, merge-safe repository profiles, and versioned onboarding state
- Unified install, init, doctor, and status readiness workflow with canonical L0 inventory and version parity checks
- Namespaced `/agent-kit-onboard` readiness journey with managed legacy-command migration and resume-aware session guidance
- Evidence-based repository personalization with protected ownership metadata and prepared `/start-project` profile reuse
- Readiness integration scenarios, L0 inventory parity guards, prompts unit coverage, and ops/knowledge self-hosted dogfood fixture

### Changed

- Docs and installer brief: single readiness narrative around `/agent-kit-onboard`; skins and external review stay optional after essentials
- Legacy welcome-only `/onboard` completion semantics superseded by verified readiness (see memory decisions)
- Built-in workspace skins (Autopilot, Night Shift, Ghost Runner) now include thematic emojis in chat hints and CLI banners

## [4.4.7] - 2026-07-23

### Fixed

- CI: Biome format in `glob.test.ts` so tag CI can publish after 4.4.6 lint failure

## [4.4.6] - 2026-07-23

### Fixed

- CLI: stop blanket-protecting `.cursor/context/**` so L0 templates and `config.example.json` install; legacy manifest globs expand to session-only paths on install/update
- Launcher: missing external-review prompt tips and exits 0 (no hard error); commands prefight templates before claiming a review ran

### Added

- Onboard / run-plan: External Review Ask (opt-in after skin; exhaustion Ask Run now / Always / Not now) and hitl-ask-questions gates
- CLI: external plan review arm prefers `.cursor/scripts/` launcher, falls back to `scripts/`; `--force` one-shot bypass of config opt-in
- L0: ship external plan review artifacts (commands, templates, `config.example.json`, canonical launcher under `.cursor/scripts/`)
- Public sync: allowlist `.cursor/scripts/**` and `.cursor/context/config.example.json`

### Changed

- Launcher: `scripts/plan-external-review.sh` is a thin wrapper; canonical path is `.cursor/scripts/plan-external-review.sh`

### Docs

- ADR / guides: external plan review promoted to L0 (still opt-in); paths and `offerOnExhausted` / `--force` / exhaustion Ask documented in `docs/external-plan-review.md`, `docs/getting-started.md`, `docs/layers-spec.md`

## [4.4.5] - 2026-07-22

### Fixed

- CI: `sync-public` job installs pnpm and disables `setup-node` package-manager-cache so tag pushes after Actions v5 do not fail with `Unable to locate executable file: pnpm`

### Added

- Sync: after the public sync PR merges, create a public GitHub Release (`vX.Y.Z`) from CHANGELOG notes so the storefront Latest badge tracks the release (opt out with `PUBLIC_SYNC_CREATE_RELEASE=false`)

## [4.4.4] - 2026-07-22

### Changed

- CI: bump GitHub Actions to Node 24 runtimes (`actions/checkout@v5`, `actions/setup-node@v5`, `pnpm/action-setup@v5`) to clear Node 20 deprecation annotations; job toolchain stays on Node 20

## [4.4.3] - 2026-07-22

### Docs

- README: Features table covering plans/HITL, handoff, run modes, git spine, memory loop, workspace skins, external plan review, packs, and output hygiene; Docs table links skins + external plan review
- Getting started: workspace skins subsection and onboard/continue-plan/run-plan skin defaults

### Fixed

- CLI: `resolve.test.ts` execFile mock callback arity (offline path) so `tsc --noEmit` passes in CI after 4.4.2

## [4.4.2] - 2026-07-22

### Added

- Hooks: `sessionStart` (`session-plan-guard.py`) tips when `dogfood/README.md` lists unprocessed inbox files (no watchers; consumers without `dogfood/` unchanged)
- Dogfood: private analysis surface with inbox contract (naming, index, ingest ritual); sessionStart surfaces unprocessed index entries

### Fixed

- CLI: auto-refresh remote registry cache on every resolve that reuses `~/.cache/agent-kit/registry/*` so new L0 artifacts (e.g. `onboard.md`) appear without requiring `--refresh`; offline/fetch failures still keep the existing cache

### Docs

- Update repository boundaries to document dogfood/ as private analysis folder
- Document stale remote cache missing L0 onboard error in .cursor/memory/errors/

## [4.4.1] - 2026-07-22

### Fixed

- CLI: Biome lint/format on `skin-banners` unit test and related `init`/`prompts` format drift (non-null assertions blocked CI `build` after `v4.4.0`, which skipped `publish-npm` and `sync-public`)

## [4.4.0] - 2026-07-21

### Added

- Skins: built-in packs `autopilot`, `night-shift`, and `ghost-runner` under `registry/skins/core/` (schema in `registry/schemas/skin-pack.json`; index in `registry/skins/core/index.json`)
- Skins: mode-aware chat chrome integration in `/continue-plan` and `/run-plan` commands; workspace skin configuration reading from `.cursor/context/config.json` with built-in pack fallbacks
- CLI: `agent-kit run-plan` tick banners from `workspaceSkin.modes["cli-run-plan"]` (default `ghost-runner`); loads `registry/skins/core/<id>/skin.json`, kolorist-only coloring, fail-soft to plain logs when the skin file is missing
- Docs: `docs/skins-contract.md` workspace skins schema, mode defaults, acceptance rules, and hygiene boundary; `workspaceSkin` keys in `.cursor/context/config.example.json`
- Commands: `/onboard` Ask questions workspace skin pick (Keep mode defaults / Autopilot / Night Shift / Ghost Runner / Skip); merges `workspaceSkin` into `.cursor/context/config.json` without wiping other keys; already-onboarded menu includes `Change workspace skin`
- CLI: `agent-kit init` wizard optional clack select for the same skin preference; writes `workspaceSkin` into `.cursor/context/config.json` (merge-safe)
- Docs: `docs/public-launch-announcement.md` copy-paste public launch text; indexed from `docs/README.md` and linked from `docs/public-launch.md`
- Docs: `docs/creating-skins.md` skin pack format, placement, contribute checklist; indexed from `docs/README.md`, `docs/CONTRIBUTING.md`, and `docs/contribute-upstream.md`

### Changed

- Rules: enhanced `ux-tone.mdc` with workspace skin chrome guidance and HITL confirmation hygiene (skins affect chat tone only, never confirmation options)
- Rules: `hitl-ask-questions` `/onboard` gate lists workspace skin pick and `Change workspace skin`
- Docs/meta: product identity says HITL framework (not developer bootstrapper) in `docs/README.md`, `docs/CONTRIBUTING.md`, root + CLI `package.json`, CLI banner, and `docs/cursor-native-audit.md` plugin description row
- Docs: renamed launch copy from channel-specific `public-launch-whatsapp.md` to channel-agnostic `public-launch-announcement.md`
- Docs: storefront claims for `/onboard` and `/start-project` match Ask questions + chat fallback, HITL gates, and Context Guardian wording (README, getting-started, bootstrap)
- Sync: public sync PRs get a semantic body (Summary + CHANGELOG release notes + source SHA) and auto-merge by default (`gh pr merge --auto`); opt out with `PUBLIC_SYNC_AUTO_MERGE=false`
- Docs: `/git-prod` requires annotated `vX.Y.Z` tag push after private `main` (triggers `publish-npm` + `sync-public`); public sync auto-merge documented in checklist and repository boundaries
- Sync: `scripts/sync-public.mjs` runs git via `execFileSync` argv arrays (no shell-string interpolation for branch/remote/url/message)
- Docs: consumer install notes version pin for unpinned `npx @dadado/agent-kit-cli` (README, install.md, getting-started)
- Docs: plan execution security note (`cursor-agent --sandbox disabled` access; registry trust model for external contributions) in getting-started and repository-boundaries

## [4.3.0] - 2026-07-20

### Added

- Commands: `/onboard` first-session welcome (Ask questions, `onboarded` marker in `.cursor/context/config.json`); bridges to `/start-project` without writing plan files; registered as L0

### Changed

- CLI: post-install Next block points at `/onboard` (then `/start-project` when you have a goal); `install.md` §6 / `install-prompt.md` / README brief align
- Hooks: `sessionStart` nudges `/onboard` when L0 is present and `onboarded` is not true (context only; no Ask questions from the hook)

## [4.2.4] - 2026-07-20

### Added

- Docs: `install-prompt.md` single source of truth for the pasteable Cursor installer brief (README embeds the same text; blank projects can fetch the raw URL)
- Sync: `install-prompt.md` on the public sync allowlist so consumers can fetch the raw URL after `/git-prod` mirror sync

### Changed

- Docs: consumer Install CTA is pasteable Cursor agent brief + single-line `npx @dadado/agent-kit-cli install`; factory / monorepo `pnpm --filter` install lives in CONTRIBUTING only (storefront vs factory)
- Install: Port B requires absolute workspace-root confirmation via Ask questions, prefers CLI when Node/npx exists, and accepts entry via attached `install.md` or `install-prompt.md`; Preference section keeps consumer fences one executable line each (no `#` comments inside fences)
- CLI: `install` logs absolute project root before writing and prints a post-install Next block (`/start-project`, `agent-kit status`); `init` exit path mirrors the Next block

## [4.2.3] - 2026-07-20

### Fixed

- Sync: remove stale `dadado` entry from `scripts/public-sync.denylist` so `@dadado/agent-kit-cli` docs and package metadata pass the public sync content guard (CI `sync-public` failed on tag `v4.2.2`)

## [4.2.2] - 2026-07-20

### Added

- Rules: always-applied L0 `hitl-ask-questions.mdc` (AskQuestion-first for all kit HITL gates; chat fallback; CLI clack exception)
- Decision: optional external plan review via Claude Code (opt-in config, post-hoc monitoring, no HITL interference)
- Templates: plan monitor template and external review prompt for Claude Code integration (.cursor/context/templates/plan-monitor.md, plan-external-review-prompt.md)
- Scripts / commands: opt-in external plan review launcher (`scripts/plan-external-review.sh`, `/plan-external-review`); Claude Code post-exhaustion arm; no-op if disabled or `claude` missing
- Command: `/plan-review-triage` for processing Claude monitor residuals with Ask questions (write residuals plan / fix nits only / ack and stop); cross-linked from `/plan-external-review` and `/run-plan`
- CLI: `agent-kit run-plan` arms `scripts/plan-external-review.sh` when the loop stops on plan exhausted (opt-in / missing `claude` stay in the script; tips do not fail the loop)
- Docs: `docs/external-plan-review.md` guide covering setup, workflow, configuration options, and triage guidelines for dual-agent plan validation
- Docs: npm publish HITL checklist for `@dadado/agent-kit-cli` (`docs/npm-publish-checklist.md`; linked from repository boundaries)
- Security: external PR threat model section in `docs/public-launch.md` covering contributor fork PRs, workflow protection, dependency confusion, and maintainer review guidance

### Changed

- Rules: `hitl-ask-questions` chat fallback documents numbered list + typed "Other"; tip notes empirical model gaps (Auto / Grok 4.5) with memory decision link
- Commands: `/run-plan` tick close documents optional external plan review after exhaustion (not a Cursor `stop` hook; never steals `/git-prod` HITL); `/plan-external-review` notes the wired exhausted path
- Commands / install / onboarding: Ask questions for confirmations (install Port B, context-guardian, continue-plan, git-prod, run-plan risk, handoff preference); bootstrap + getting-started aligned
- Install.md: Ask questions wired for all four residual gates (registry URL/ref, git hooks install, nested agent-kit/ migration, structure-already-existed confirmation)
- Commands: `/continue-plan` multi-plan picker when multiple resumable plans exist; Ask questions for plan selection and next to-do confirmation
- Commands: `/start-project` always creates a plan (Broad Intake Review, park prior active plan, Ask questions for Gate A/B); no continue-vs-new; resume via `/continue-plan`
- Rules / hooks: mirrored always-create-plan + Broad Intake + Ask questions HITL across all surfaces (cursor-plan-handoff, session-plan-guard.py, plan-routine, docs)
- Memory: supersede start-project two-gates decision (2026-07-20 always-create-plan + Broad Intake + Ask questions; park prior plan; no continue-vs-new)
- Docs: consolidated overlapping topology/cutover docs with `topology-private-public.md` as SoT and short pointers from other docs
- **Breaking (npm):** CLI package renamed from `@agent-kit/cli` to `@dadado/agent-kit-cli` (publish under maintainer npm scope `@dadado`)

### Fixed

- Docs: drift/coherence inventories no longer hardcode stale product version `3.5.1` (point to `package.json`)
- Memory: loop-review mandate addendum (continuous monitoring stays human HITL, not silent agent cancel); Decisions index lists the mandate
- Docs: Phase B topology status marked COMPLETE; cursor-native-audit product version aligned to 4.2.1

## [4.2.1] - 2026-07-19

### Fixed

- Sync: append-only public sync preserves public-owned `registry/**` across allowlist replace (Phase B SoT no longer wiped when excluded from the private→public manifest)

### Changed

- Docs: topology + boundaries updated for Phase B invariant (sync preserves public-owned registry; private remains factory for CLI/sync/dogfood even after public storefront + registry SoT)

## [4.2.0] - 2026-07-19

### Fixed

- Docs: root README maintainers section no longer claims "this repo is agent-kit-dev" (false on the public mirror after sync); names private factory vs public storefront + registry SoT (Phase B)

### Changed

- Docs: Phase B phase5 leak audit + public-URL install dogfood (2026-07-19) - Guard public tree pass; `node scripts/sync-public.mjs --dry-run` exit 0 (no session/secret paths; no `registry/**`; `.cursor/hooks.json` in set); smoke `install`/`update`/`status` against `https://github.com/agent-kit-startup/agent-kit@main` (24 L0 files); contribute gate rejects `.cursor/HANDOFF.md`. Gap: `@agent-kit/cli` not yet on npm (`npx` 404); documented checkout + `--url` path in README / getting-started / bootstrap
- Sync: Phase B cutover - `scripts/public-sync.manifest` no longer mirrors `registry/**` from private (include removed, `!registry/**` exclude); public repo is SoT for registry
- Contribute: Phase B cutover - contribution surfaces now point to public-first registry flow (public repo is canonical; CLI instructions use `--base main`)
- Docs: Phase B final pre-freeze public mirror recorded (private `9f6c717` → public PR #8; registry still in sync allowlist)
- Docs: Registry freeze messaging - private registry edits will soon stop publishing; prepare for Phase B cutover to public-canonical registry

## [4.1.0] - 2026-07-19

### Added

- CLI: `agent-kit run-plan` headless continuous plan runner (fresh agent per tick, `LOOP_TICK_RESULT` contract, stop file / max-ticks / no-progress guards); pluggable backend (`cursor-agent` default, `claude` reserved)
- Commands: `/run-plan` unifies continuous plan execution; strategy auto-selected (orchestrated workers, in-session loop, or headless `agent-kit run-plan`)
- Registry: expanded artifacts[] from ~17→50 entries with cursor-skills-* community skills (12 new) and checklist-n8n support
- Domain packs: DevOps templates (CODEOWNERS, GitLab CI variants for Docker/Firebase/content)
- Domain packs: engineering-architecture templates (ADR, task-brief)
- Domain packs: context-management template (context-pack)
- Docs: contributor quickstart section in CONTRIBUTING.md with skill placement and testing workflow; worktree isolation note for headless plan execution; secrets hook scope clarification
- Docs: ops/docs audit follow-ups (Phase 5) - contributor workflow improvements, git worktree isolation notes, pre-commit hook scope clarification

### Removed

- Registry: four `cursor-skills-*` mirror skills (json/n8n/prompts/sql) deduped into their canonical counterparts; `checklist-n8n.md` moved into `n8n-workflows`

### Fixed

- CLI: `guessRegistryPath` narrows the legacy flat skill id before `path.posix.join` so `pnpm typecheck` passes under strict indexed access
- Security: replaced shell-interpolated git commit in `scripts/sync-public.mjs` with `execFileSync` to prevent command injection

### Changed

- Security: bump monorepo devDependencies to clear pnpm audit critical/high (turbo >=2.9.14, vitest >=3.2.6, vite >=7.3.5 for the CLI test toolchain)

- Release: root and `packages/cli` `package.json` versions aligned to closed CHANGELOG SemVer (`4.0.1`); `/git-prod` must bump both when closing a release (see `autogit/gitupdate.md`)
- CI: run `pnpm typecheck` between lint and test in the build job
- Docs: skill-to-agent routing one-liners on community skills (`n8n-workflows`, `sql-postgres`, `prompts-markdown`, `json-data-config`) stating skill-first in the main window vs the matching demoted Task subagent, with `docs-repo` and `security-reviewer` routing notes; `/git-staging`, `/git-prod`, `/handoff` now state they run in the main window and are not Task-dispatched by default
- Commands: `/run-plan-loop` and `/run-plan-orchestrated` deprecated to thin aliases of `/run-plan`; tick contract lives in one place (`run-plan.md`)
- Scripts: `scripts/plan-loop.sh` is a thin wrapper that forwards to `agent-kit run-plan`
- Docs: README usage, getting-started, plan-routine, install.md, migrate-consumer, layers-spec updated for the single continuous command
- Registry: `build-registry.mjs` fails on duplicate skill ids and preserves hand-curated L0 artifacts across rebuilds
- Docs: CONTRIBUTING documents two contribution paths (improve existing skill vs new skill id)
- Domain packs: consolidated pack.json for devops/cybersec/engineering-architecture/context-management with expanded skill sets
- Registry: community skills count increased from 7→19 to include cursor-skills-* collection
- Security: git-secrets-safety rule dual placement (L0 + cybersec pack)
- Docs: updated domain-packs.md and layers-spec.md for Phase 4 consolidation
- CLI: L0/install types updated to support expanded domain pack structure
- Schemas: agent-kit.pack.schema.json updated for enhanced pack configurations

## [4.0.1] - 2026-07-19

### Fixed

- CLI: Biome format in `handoff.ts` pending todo spread (unblocks CI lint and public sync after v4.0.0).

## [4.0.0] - 2026-07-19

### Added

- Docs: three-layer cheat sheet (local scratch / private factory / public storefront) in `docs/repository-boundaries.md`, linked from root README and docs index.
- Skills: translated community and core skills to English (n8n-workflows, json-data-config, clickup, ux-message-flows, prompts-markdown, clean-code, sql-postgres) with registry mirrors updated.

### Fixed

- Public sync allowlist includes `.cursor/hooks.json` (sibling of `.cursor/hooks/**`). Without it, consumer `agent-kit install` from public `main` warned `Missing in registry` and skipped Cursor-native hook wiring.
- `/start-project` HITL: two gates (approve plan file, then approve first unit); active HANDOFF asks continue vs start new; goal-in-same-message is not execute permission. Aligned `/continue-plan`, `sessionStart` hard rules, `cursor-plan-handoff`, `plan-routine`, getting-started, README.

### Changed

- **Breaking:** L1 pack ids renamed to English: `gestao-projeto` → `project-management`, `gestao-contexto` → `context-management`, `engenharia-arquitetura` → `engineering-architecture` (dirs + `registry/packs/index.json` + regenerated `registry/registry.json` + CLI `DOMAIN_PACK_IDS`). Update consumer manifests that still list the old ids.
- Docs inventories refreshed post EN sweep: `coherence-inventory`, `drift-inventory`, `cursor-native-audit` aligned to 3.5.x release notes, 10 commands, EN pack ids, and Phase B cutover (removed stale EN-thesis / Fase labels).
- CHANGELOG header translated to English (body history unchanged).
- Public surface EN sweep close: `HANDOFF.md.example`, context templates, `cursor-handoff` messages, `.cursor/hooks/**` user strings, and sync-allowlisted residue translated; optional PT blurb kept only in `docs/github-about.md`.
- Root/docs and CLI user-facing strings: `adicionar-skills.md` renamed to `add-skills.md` (EN body); `categories.md`, `install.md` comments, `docs/repository-boundaries.md` flow section, and related docs residue translated; CLI prompts in `prompts.ts`, `handoff.ts`, `init.ts`.
- Stack rules under `.cursor/rules/cursor-skills-*.mdc`: remaining Portuguese bodies translated to English (api, clickup, devops, groovy, integrations, json, mobile, n8n, node, php, prompts, python, sql, testing, webdesign); frontmatter globs preserved. `general` and `git-workflow` were already EN.
- Agents under `.cursor/agents/`: bodies translated to English; `testes-roteiros` renamed to `test-suites` (pack + regenerated `registry/registry.json`); docs inventories updated.
- Public sync PR heads use semantic names (`sync/vX.Y.Z-<shortsha>`) instead of `sync/private-<run_id>`; re-runs update the same head and close superseded `sync/*` PRs. CI no longer overrides `PUBLIC_SYNC_BRANCH`.
- Public `Protect main` ruleset: Repository Admin bypass (`always`) so solo maintainer can merge sync PRs without a second reviewer (avoids self-approval deadlock).

## [3.5.1] - 2026-07-19

### Added

- `pre-push` authorized prod path: `ALLOW_MAIN_PUSH=1 git push origin main` (keeps the hook on; preferred over `--no-verify` for `/git-prod`). Documented in `git-hooks/README.md` and `autogit/gitupdate.md`.

### Changed

- Docs inventories (`coherence-inventory`, `drift-inventory`) and `git-autogit` agent aligned to English command names; legacy homolog alias references removed from live surfaces.

## [3.5.0] - 2026-07-19

### Adicionado

- Guardas de hook `git-hooks/pre-commit` e `git-hooks/pre-push`: bloqueiam commit e push direto em `main`/`master`; `git-hooks/README.md` documenta instalação e o override pontual (`--no-verify`).
- **Native Cursor hooks (L0):** `.cursor/hooks.json` + `.cursor/hooks/agent/` (`sessionStart` injeta HANDOFF + hard rules; `preCompact` avisa handoff). Soft rules sozinhas não bastavam no dogfood. Documentado em `docs/layers-spec.md`, `docs/getting-started.md`, `docs/bootstrap.md`.

### Alterado

- Native hooks: removed `stop` follow-up (`stop-phase-guard.py`) so `/git-staging` / `/git-prod` HITL is not interrupted; keep `sessionStart` + `preCompact`. Session hard rules note that HITL slash commands keep the turn.
- Orchestrated routing: worker signal → `subagent_type` table and fallback in `/run-plan-orchestrated`; optional plan todo `worker_type` in `autogit/plan-routine.md` and plan template.
- Agent install orphans: `docs-repo` agent added to L1 `engenharia-arquitetura` (skill + agent, clean-code pattern); `git-autogit` and thin stack agents (`json-guardian`, `prompts-agents`, `n8n-workflows`, `sql-schema`) documented as dogfood-only / skill-first in `docs/domain-packs.md` and `docs/coherence-inventory.md`. Registry regenerated.
- README: reescrito para versão lean em inglês (~54 linhas), focado no valor principal (contexto persistente + git seguro) e fluxo básico, removendo detalhes internos para aumentar adesão inicial.
- Docs sweep: command names and CLI examples aligned to English (`/start-project`, `/continue-plan`, `agent-kit`, pack ids like `context-management`) across `docs/`, `add-skills.md`, and `.cursor/context/templates/plan.md`.
- Modo manual endurecido: `/start-project` e `/continue-plan` (e rules `cursor-plan-handoff` / `context-guardian`) param após uma fase e não dispensam perguntas de contexto. Multi-fase na mesma janela só via `/run-plan-loop` ou `/run-plan-orchestrated`.
- README: abertura ampliada de "memória de contexto + git seguro" para o escopo real - harness do workflow completo (bootstrap personalizado, plano → execução, integração de PM/automação/infra e DevOps staging-first estruturado que faz os agentes lerem o estado real do projeto). "Why you'd want it" ganha bullets de loop completo e DevOps; produção segue exigindo confirmação.
- Anti-slop: política que elimina o caractere travessão (em dash) de mensagens de commit, textos e docs, mantendo-o apenas em citação literal obrigatória. Novo padrão no skill `clean-code` e reforço nas rules `agent-output-hygiene`, `docs-professional-standard` e `ux-tone`. Scrub aplicado nas rules, skills e docs de face (README, CHANGELOG, `install.md`, `docs/`).
- Spine DevOps reforçado nas rules `cursor-skills-devops` e `cursor-skills-git-workflow`: staging-first (nunca trabalhar em `main`), auditoria first-parent do `main` e poda de branch legada.
- CHANGELOG: links de comparação de versões atualizados (faltavam 3.2.0 a 3.4.0 e o `[Unreleased]` apontava para uma tag antiga).

### Removido

- Branch legada `homologacao` (local e remotos): migrada para `staging`.

## [3.4.0] - 2026-07-19

### Alterado

- README: reescrito em voz de produto para leitor externo - abre pela dor (perder contexto em chats longos), explica handoff/plano/staging→prod em linguagem comum e remove jargão interno do texto (L0, Core Pack, hygiene, spine); tabela de docs descreve cada guia pelo conteúdo.
- `docs/getting-started.md`: reescrito full em voz de produto - install, tabela de comandos em linguagem comum, "a normal day" e seção separada para quem desenvolve o kit.
- `docs/bootstrap.md`: reescrito full - abre pelo layout que o install gera (não pelo anti-pattern); passos de install/update/migração em linguagem comum.
- `docs/domain-packs.md`: reescrito full - explica o que é um pack e para que serve, tabela "what it adds / good for", sem jargão de fase.
- `docs/layers-spec.md` e `docs/agent-kit-manifest.md`: mantêm o modelo L0–L3 (docs de maintainer), mas ganham abertura em linguagem simples e perdem referências de sessão ("Phase 0", "fleet migration", "drift denominator", "f1-/f2-/f6-", seções de "Acceptance").
- `docs/public-launch.md`: checklist marca ruleset de `main` do repositório público como ativo.

## [3.3.1] - 2026-07-18

### Alterado

- README: rewrite slim em inglês - pitch HITL, install L0, fluxo, CLI lifecycle e links; remove inventário de stack (ClickUp/n8n/SQL…) e seção PT duplicada; L0 alinhado a `packages/cli/src/lifecycle/l0.ts`.
- `docs/github-about.md`: Description alinhada à tese HITL (deixa de usar “developer bootstrapper”).
- `docs/public-launch.md` e `docs/repository-boundaries.md`: `PUBLIC_REPO_TOKEN` documenta também `Workflows: write` (sync com `.github/workflows/`).

## [3.3.0] - 2026-07-18

### Alterado

- README: abertura reescrita em voz de produto (princípios HITL, estrutura, hygiene, core vs stack) - remove tabela de posicionamento interno e link para checklist de ops.
- Sync público: `install.md`, `categories.md`, `add-skills.md` e `HANDOFF.md.example` incluídos no manifest - README público os referencia (links quebravam no espelho).
- Política do repositório público: sync passa a abrir PR contra `main` por padrão; CI usa `PUBLIC_REPO_TOKEN`; `main` permanece como única branch longa e recebe ruleset com review + check `build`.
- `docs/CONTRIBUTING.md` e `docs/cursor-3-features.md`: guideline de tooling Cursor-native reescrita em termos genéricos (sem citar gateway específico).
- Hygiene no conjunto público: `docs/review-camadas.md` sem nome de org privada, números de PR e ids de sessão; `docs/cursor-native-audit.md` e `docs/public-launch.md` sem referências a paths privados (`.cursor/plans/`, `.cursor/memory/`); denylist do sync ganha `\bWAM\b` e `\bSofia\b` (guard estrutural).

### Removido

- `docs/CONTRIBUTING.md`: seção **GitHub CLI (`gh`)** - troubleshooting de autenticação local (PAT fine-grained, keyring da máquina) não é guideline de contribuição; conteúdo já coberto em `.cursor/memory/errors/` e `autogit/gitupdate.md` (troubleshooting).

## [3.2.0] - 2026-07-17

### Adicionado

- Runbook genérico de migração consumer: `docs/migrate-consumer.md` (`YOUR_PROJECT`; manifest + `update` preserva L3; loop/orquestrado).
- Frota de consumers migrada (`f4-migrar-frota`): nested `agent-kit/` removido; manifests v3.0.0; L3 preservado (inventário anonimizado em `docs/drift-inventory.md`).
- CLI `agent-kit contribute`: detecta drift/novos artefatos, gate anti-slop/hygiene, `--write` para checkout local + corpo de PR sugerido (`docs/contribute-upstream.md`).
- Coerência interna (`f6`): skills SoT no registry (incl. `json-data-config`, `prompts-markdown`, `ux-message-flows`); merge `code-deslop` → `clean-code` e `clickup-project-mgmt` → `clickup`; workspace só via `agent-kit update`; inventário atualizado.
- Repo público (`f6`): README EN com tese HITL; `docs/public-launch.md` go/no-go; `sync-public.mjs` default **append-only** (`--force-snapshot` escape hatch).
- Topologia Fase 7 (`f7-topologia-repos`): `docs/topology-private-public.md` - Phase A mirror vs Phase B registry canônico no público; cutover e promote runbook; boundaries/CONTRIBUTING alinhados.
- Marketplace (`f7-marketplace`): skills com `version`/`category` no frontmatter; builder → `registry.json`; `docs/marketplace.md` + gate em CONTRIBUTING; plugin.json alinhado à tese HITL.
- MCP pago (`f7-mcp-pago`): spec Release 2 em doc privado (valor vs registry grátis, tiers, infra, gate de implementação).
- Review camadas (`review-camadas`): `docs/review-camadas.md` - pass HITL/gates; residuals só ops.
- Bootstrap sem cópia de pasta: `docs/bootstrap.md`; `install.md` / README / getting-started apontam para `agent-kit install` (L0 + `autogit/` + manifest); L0 passa a incluir `autogit/gitupdate.md` e `autogit/plan-routine.md`.
- CLI lifecycle: `agent-kit install` / `update` / `diff` (com `add`/`status` alinhados) contra registry local ou cache remoto; `update` e cópias respeitam paths L3 em `protected` / `overrides` do manifest.
- `docs/drift-inventory.md`: inventário de drift entre workspaces (cópias `agent-kit/`, contagens, candidatos L0, artefatos L3 e órfãos a promover).
- `docs/layers-spec.md`: spec das camadas L0–L3 (precedência, nomenclatura, lista L0, packs L1, limites L2/L3).
- Comando **`/executar-plano-loop`**: execução contínua do plano com update de status nos to-dos a cada tick, HANDOFF e `/git-staging` automático (nunca `/git-prod` no loop).
- Comando **`/executar-plano-orquestrado`**: janela principal magra + workers (Task); contrato de summary; staging automático; fallback para loop/manual se não houver subagentes; L0 no CLI (`packages/cli/src/lifecycle/l0.ts`).
- Template de plano **`.cursor/context/templates/plan.md`** com budget de contexto por to-do (`read_scope`, `worker_contract`, `max_ticks`); `autogit/plan-routine.md` e rule `cursor-plan-handoff` documentam os campos.
- Manifest de distribuição **`.cursor/agent-kit.json`**: schema JSON (`schemas/agent-kit.manifest.schema.json`), doc (`docs/agent-kit-manifest.md`), parser/tipos no CLI, dogfood neste repo; `agent-kit status` mostra manifest + profile.
- Domain packs L1 (`registry/packs/*/pack.json` + `docs/domain-packs.md`): membership dos 7 packs (`cybersec`, `devops`, `engenharia-arquitetura`, `clean-code`, `gestao-projeto`, `gestao-contexto`, `quality`); schema `schemas/agent-kit.pack.schema.json`.
- Registry **schemaVersion 2**: `registry/registry.json` passa a listar `packs` e `artifacts` (rules/agents/commands/hooks via packs); `node scripts/build-registry.mjs`; `agent-kit add` instala skill ou pack (`--skill`/`--pack` se id colidir).

### Alterado

- Hygiene: origem de sessão ≠ caso de uso do produto; dogfood canônico = este monorepo; docs de migrate/drift/bootstrap sem nomes de consumer; decisão `2026-07-17_session-origin-not-product-usecase`.
- `docs/drift-inventory.md` / `docs/bootstrap.md`: piloto = dogfood no SoT; migrate-consumer = runbook genérico.
- `agent-kit update` deixa de regenerar só pelo wizard profile: sincroniza L0/packs/skills a partir do manifest e do registry.
- `docs/getting-started.md`: tabela de comandos com `install` / `diff` / lifecycle L3.
- Decisão em `.cursor/memory/decisions/`: título e arquivo renomeados para *framework HITL (contra autonomia sem revisão)* - remove termo transitório do posicionamento do produto; índice e referência histórica no CHANGELOG alinhados.
- `docs/README.md`: links para inventário de drift e spec de camadas.
- `autogit/plan-routine.md` e rule `cursor-plan-handoff.mdc`: plano primeiro; três modos (manual / loop / orquestrado); placar de status no frontmatter.
- `docs/getting-started.md`, `docs/layers-spec.md`, `docs/coherence-inventory.md`: documentam o loop no core.

### Corrigido

- Sync público: spec de pricing (doc privado) excluída do manifest até decisão de publicação; links públicos ajustados.
- Segurança (CLI): registry remoto valida `url`/`ref` antes do `git clone` - só `https://`, rejeita transportes que executam comando (`ext::`, `file://`, `ssh`) e argument injection (`-...`); subprocessos git rodam com `GIT_ALLOW_PROTOCOL=https`. Fecha o vetor de RCE via `registry.url` em `.cursor/agent-kit.json` de projeto não confiável.
- Sync público: `sync-public.mjs` ganha guard de **conteúdo** além do allowlist de paths - bloqueia shapes de secret (AWS, PAT, private key, Slack) e termos de denylist privada (`scripts/public-sync.denylist`, fora do manifest público; override via `PUBLIC_SYNC_DENYLIST`).
- `docs/drift-inventory.md`: inventário totalmente anonimizado (workspaces → `consumer-N`, artefatos L3 → exemplos genéricos); nenhum nome de consumer privado no conjunto sincronizado ao público.
- CI: contexto `secrets` não é permitido em `if` de job - jobs `sync-public` e `publish-npm` agora condicionam só por ref/evento e os steps pulam com aviso quando `PUBLIC_REPO_URL` / `NPM_TOKEN` não estão configurados (o `workflow_dispatch` falhava com HTTP 422).
- `scripts/trigger-public-sync-after-prod.sh`: aceita remotes GitHub com alias SSH (ex.: `git@github-agent-kit:owner/repo.git`), não só URLs `github.com`.

---

## [3.1.0] - 2026-07-14

### Alterado

- **Staging-first:** `git staging` → `origin/staging` passa a ser o comando/branch canônico do spine DevOps; `git homolog` / `homologacao` viram sinônimos legados. Branch `staging` criada no origin a partir de `homologacao`. Atualizados: `autogit/gitupdate.md` (prompts "git staging" e "git prod" com fechamento de release no CHANGELOG e passo de sync público), `autogit/plan-routine.md`, rules (`cursor-skills-git-workflow`, `cursor-skills-general`, `cursor-skills-devops`, `cursor-skills-clickup`), commands (`git-staging` principal, `git-homolog` legado, `git-prod`), agents (`git-autogit`, `clickup-tasks`), skill core `git-workflow`, README, `install.md`, `cursor-handoff`, docs (`repository-boundaries`, `getting-started`, `cursor-3-features`, `coherence-inventory`) e CLI (detecção de branch `staging`, labels e textos de handoff; valor interno `homolog-prod` mantido por compatibilidade). Decisão registrada em `.cursor/memory/decisions/2026-07-14_staging-first-branch-rename.md`.

### Adicionado

- `docs/cursor-native-audit.md`: auditoria Cursor-native (plugin, rule modes, shell hooks, gaps `hooks.json`, VS Code/Windsurf).
- `docs/coherence-inventory.md`: inventário Fase 1 - classificação core | stack | merge de rules, skills, hooks, agents e commands.

### Alterado

- `.cursor/rules/ux-tone.mdc`: frontmatter YAML (`alwaysApply: true`) para carregamento consistente no Cursor.
- `docs/README.md`: links para cursor-native audit e coherence inventory.
- **Identidade do projeto atualizada**: nova descrição unificada - "Developer bootstrapper for AI-assisted IDEs" - propagada para README, `package.json` (root + CLI), `plugin.json`, `docs/github-about.md`, CLI meta, e todas as docs (`getting-started`, `creating-skills`, `cursor-3-features`, `CONTRIBUTING`, `repository-boundaries`, `templates/*/README`). README reestruturado: "Why v3" substituído por "What it does" (understand → generate → maintain context) e "Key features".

### Corrigido

- `packages/cli/src/utils/logger.ts`: import nomeado de `kolorist` (ESM sem `default`) para compatibilidade com Node 20+ ao executar a CLI.

### Adicionado

- `scripts/trigger-public-sync-after-prod.sh` e script npm `pnpm git:trigger-public-sync`: após `git prod`, disparam `workflow_dispatch` do CI no `origin` (`sync_public=true`, ref `main`) quando existe remote `public` no GitHub; integrado ao passo 13 de `autogit/gitupdate.md`, `.cursor/commands/git-prod.md`, regra `cursor-skills-git-workflow.mdc` e agente `git-autogit.md`. Arquivo incluído no `public-sync.manifest`.
- `docs/repository-boundaries.md`: English doc - local × Git × npm table; CI blocks tracking `HANDOFF.md` and `*.plan.md` under `.cursor/plans/`; private vs public mirror and sync manifest (see file for current setup).
- Passo **Guard public tree** em `.github/workflows/ci.yml`.
- `scripts/sync-public.mjs` e `scripts/public-sync.manifest`: sync por allowlist para repositório público espelho.
- Jobs CI **sync-public** (tag `v*` ou `workflow_dispatch`) e **publish-npm** (tag `v*`), ativos apenas quando os secrets `PUBLIC_REPO_URL` e `NPM_TOKEN` estiverem configurados.
- `docs/github-about.md`: texto de About para o repositório GitHub (description + topics).
- Core skills (5) incluídos em `registry/registry.json` (antes só tinha community).
- `init` e `update`: quando `registry/registry.json` existe no projeto, instalam automaticamente as skills core selecionadas no profile em `.cursor/skills/` (`installSkillsByIds` em `registry/install.ts`).
- Regra `.cursor/rules/memory-loop.mdc`, layout `.cursor/memory/` (`errors/`, `decisions/`, `_index.md`) e subagente `memory-extractor` para consolidar aprendizados entre sessões.
- **`agent-kit handoff`:** lê plano ativo em `.cursor/plans/`, grava `.cursor/HANDOFF.md` com progresso, to-dos e rotinas sugeridas; se existir `.cursor/agent-kit.config.json`, usa workflow Git e ferramentas de gestão de projeto do perfil (senão sugere PR/MR genérico).
- Scanner CLI: metadados por provedor Git (`GIT_PLATFORM_META`), tipos de CI e de ferramenta de gestão de projeto ampliados para geradores e docs.
- Rules **`agent-output-hygiene.mdc`** (chat ≠ artefato versionado) e **`docs-professional-standard.mdc`** (documentação herdável, sem contexto transitório).
- Comando **`/git-staging`** (alias de `git homolog`) em `.cursor/commands/git-staging.md`.
- Decisões em `.cursor/memory/decisions/`: framework HITL (contra autonomia sem revisão), harness estrutural vs stack, output hygiene, docs professional standard.
- `add-skills.md`, `install.md`, `categories.md`, `registry-schema.md`, `skills-registry.json`, scripts `build-registry.sh` e `new-skill.sh`, `HANDOFF.md.example`.

### Alterado

- **Public Harness F0:** tese de framework (autonomia + humano no loop); spine DevOps (`git staging` ≡ `git homolog` → `git prod` → memory-loop); PM (ClickUp) e n8n **on demand**, não core.
- `autogit/gitupdate.md`, `autogit/plan-routine.md`: rotinas alinhadas ao spine DevOps e sinônimos staging/homolog.
- Agents, rules, skills (`.cursor/` + `registry/skills/core/`) e commands revisados para hygiene, docs standard e HITL.
- `cursor-handoff`, README e `docs/cursor-3-features.md` alinhados à narrativa de harness estrutural.

### Alterado

- `docs/repository-boundaries.md`: fluxo homolog → prod → **`pnpm git:trigger-public-sync`** (além de tag/dispatch manual). `autogit/gitupdate.md`: passo 13 detalhado; resumo em `git prod` (What it does).
- `.gitignore`: ignorar `.cursor/plans/**/*.plan.md` (inclui `archive/`); snapshots de plano arquivado deixam de ser candidatos a commit.
- `autogit/gitupdate.md`: seção sobre nomenclatura `main` / `homologacao`, ambientes de CI vs branches e boas práticas GitHub/GitLab.
- `.cursor/memory/`: índice único (errors + decisions) e decisão registrada sobre branches e ambientes.
- **Narrativa de handoff unificada:** handoff em arquivo é a fonte da verdade; features nativas do Cursor (summaries, `/resume`, Agents Window) complementam - não substituem.
- `context-guardian.mdc`: planejar por ~50% da janela, gravar HANDOFF após cada task, aviso proativo em ~60%.
- `cursor-plan-handoff.mdc`: um HANDOFF por projeto, atualizar to-dos sempre, sugerir rotinas pós-task; CLI + script `./cursor-handoff` opcional documentados.
- `.cursor/commands/handoff.md`, `context-librarian.md`: fluxo completo e rotinas pós-task.
- `docs/cursor-3-features.md`: Cursor nativo como complemento, não substituto.
- `generator/cursor.ts`: rules geradas incluem handoff awareness (regra `03-handoff.mdc`).
- README, `docs/github-about.md`, `docs/creating-skills.md`: lista completa de comandos CLI; esclarecimento core skills vs `registry/`; `add` descrito como core + community.
- `agent-kit add`: descrição do comando (core ou community).
- `agent-kit handoff`: plano ativo → HANDOFF.md; `./cursor-handoff handoff` opcional quando o script existe na raiz (Unix; Windows orientar Git Bash/WSL).
- `docs/CONTRIBUTING.md`: seção **GitHub CLI (`gh`)** - PAT fine-grained vs `checks:read`, OAuth no navegador ou PAT classic com `repo`.
- `CHANGELOG.md` reformatado para [Keep a Changelog](https://keepachangelog.com/) com seções PT-BR, `[Unreleased]` e links de comparação.
- `registry/registry.json`: estrutura separada em `{ core, community }` em vez de array flat.
- `registry/client.ts`: nova função `allSkills()` que busca em core + community.
- `registry/install.ts`: detecta core vs community + `installSkillsByIds` para instalação em lote.
- `registry/types.ts`: `RegistryIndex.skills` agora é `{ core, community }`.

### Removido

- Dependência `zod` do CLI (não era utilizada em nenhum arquivo).

### Corrigido

- CI (GitHub Actions): `pnpm/action-setup@v4` não recebe mais `version` duplicada; usa `packageManager` do `package.json` (`pnpm@10.0.0`).

---

## [3.0.0] - 2026-04-05

### Adicionado

- Monorepo com `pnpm` + `turbo` e CLI em TypeScript (`packages/cli`).
- Scanner de projeto (`agent-kit scan`): detecta stack, IDE, estrutura existente.
- Wizard dual-path: setup guiado para repos existentes e greenfield.
- Gerador adaptativo: gera regras, skills e templates conforme IDE e plano/tier.
- Registry installer (`agent-kit add <skill>`): instala skills do catálogo core/community.
- Estrutura `registry/` (core + community) e `templates/` por IDE.
- `autogit/gitupdate.md`: rotinas `git homolog` / `git prod` com Conventional Commits, SemVer e CHANGELOG.
- `autogit/plan-routine.md`: roteiro de criação de planos com ClickUp sync.
- `git-hooks/prepare-commit-msg`: remove `Co-authored-by: Cursor` dos commits.
- `.cursor/commands/`: git-homolog, git-prod, handoff, continuar-plano, iniciar-projeto, context-status, dicas, resumo.
- `.cursor/agents/`: 12 subagentes (git-autogit, cleancode-refactor, context-librarian, docs-repo, json-guardian, n8n-workflows, prompts-agents, security-reviewer, sql-schema, tech-lead, testes-roteiros, clickup-tasks).
- `.cursor/rules/`: regras always-on (general, git-workflow, clickup, plan-handoff, context-guardian, ux-tone).
- CI via GitHub Actions (lint, test, build).
- Documentação: getting-started, creating-skills, cursor-3-features, CONTRIBUTING.

### Alterado

- Migração completa de v2 (shell script + JSON registry) para v3 (TypeScript monorepo).
- v2 preservada em `_legacy/v2/` para referência.

---

[Unreleased]: https://github.com/agent-kit-startup/agent-kit/compare/v4.0.0...HEAD
[4.0.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.5.1...v4.0.0
[3.5.1]: https://github.com/agent-kit-startup/agent-kit/compare/v3.5.0...v3.5.1
[3.5.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.4.0...v3.5.0
[3.4.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.3.1...v3.4.0
[3.3.1]: https://github.com/agent-kit-startup/agent-kit/compare/v3.3.0...v3.3.1
[3.3.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/agent-kit-startup/agent-kit/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/agent-kit-startup/agent-kit/releases/tag/v3.0.0
