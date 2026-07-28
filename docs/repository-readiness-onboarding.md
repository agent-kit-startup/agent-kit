# Repository Readiness Onboarding

## Status

This document is the product and UX contract for repository-readiness onboarding. The CLI install, doctor, status, and `/agent-kit-onboard` surfaces implement this contract. Validation coverage lives under `packages/cli` and the synthetic fixture at `dogfood/fixtures/ops-knowledge-self-hosted/`.

## Product Boundary

Agent Kit has two distinct setup concerns:

- **Repository purpose:** the stable role, structure, infrastructure, conventions, and operating environment of the repository.
- **Project goal:** a specific deliverable that becomes a plan with to-dos.

Repository onboarding prepares the environment. `/start-project` plans a deliverable after that environment is ready. The onboarding must not ask for a first feature before it understands whether the repository can support the Agent Kit workflow.

## Outcomes

A completed onboarding provides:

1. a verified Agent Kit installation;
2. a classified repository purpose and stack;
3. a known Git state, including local-only and remote-hosted cases;
4. secrets and hook safeguards;
5. a documented branch and promotion strategy;
6. enough project context for agents to act without inventing facts;
7. relevant rules, skills, and agents selected from evidence;
8. a readiness report with no unresolved essential blocker;
9. one clear next action: `/start-project` or finish setup.

## Journey

### Stage 1: Install and Inspect

`agent-kit install` installs L0, validates the workspace root, scans the repository, applies safe local preparation, and writes a readiness snapshot.

The completion message reports:

- what was detected;
- what was fixed safely;
- what still requires a decision;
- the single next action for the current interface.

The CLI does not ask the user to repeat facts that can be derived from files, Git, or installed tooling.

### Stage 2: First Onboarding Message

The onboarding loads the install snapshot, validates its freshness, and starts with a short result:

```text
Repository preparation: 6 of 9 areas ready.
Detected: operations and knowledge repository, GitLab-compatible remote, staging branch.
Fixed: Agent Kit structure and secrets ignore rules.
Next decision: confirm the remote provider.
```

The first message must not ask about skins, external review, or the first deliverable.

### Stage 3: Resolve Essential Decisions

The onboarding presents one decision at a time. A decision appears only when it changes the setup and the scanner cannot resolve it safely.

Priority order:

1. workspace root and repository purpose;
2. Git local or remote operating model;
3. remote provider and branch strategy;
4. secrets, hooks, and protected content;
5. build, test, CI, and deploy prerequisites;
6. missing project context;
7. Agent Kit component recommendations.

### Stage 4: Validate

The onboarding reruns affected checks and records evidence. It completes only when:

- all essential checks are `ready`; or
- a non-blocking check is explicitly deferred with a reason and a recovery action.

An acknowledgment alone is not completion.

### Stage 5: Optional Personalization

Agent Personas belong in a later settings or personalization step. External plan review belongs at plan exhaustion, where its purpose is visible. Neither feature blocks repository readiness.

### Stage 6: Start a Deliverable

After readiness passes, the onboarding offers `/start-project`. The next command asks for the deliverable goal and preserves the existing Gate A and Gate B contract.

## Readiness Model

### Statuses

| Status | Meaning | Owner |
|---|---|---|
| `ready` | Evidence satisfies the check | System |
| `auto_fix` | A local, reversible, idempotent action can satisfy the check | System |
| `needs_choice` | Valid outcomes depend on user intent | User through Ask questions |
| `manual` | The user must act outside Agent Kit | User with guided steps |
| `blocked` | An essential dependency prevents progress | User or external administrator |

### Pillars

#### 1. Workspace

- absolute root and nested-repository detection;
- existing Agent Kit manifest and version;
- L0 inventory, required templates, and protected paths;
- required local runtimes for installed hooks.

#### 2. Repository Purpose and Context

- application, library, monorepo, documentation, knowledge, operations, automation, or mixed purpose;
- README, architecture, runbooks, prompts, schemas, and source-of-truth files;
- project-owned conventions and existing agent guidance;
- confidence and evidence for every classification.

#### 3. Source Control

- no Git, local-only Git, or remote-hosted Git;
- remotes, current branch, default branch, and clean/dirty state;
- provider and capability detection;
- staging branch presence locally and remotely;
- branch protection and merge permissions when observable.

Provider classification follows this evidence order:

1. explicit project configuration;
2. authenticated provider CLI or API metadata;
3. known provider hostname;
4. provider-specific repository files as supporting evidence;
5. user confirmation.

A custom hostname alone never proves a provider.

#### 4. Safety

- `.gitignore` coverage for environment files and credentials;
- tracked sensitive-file detection;
- existing hook framework and compatibility;
- secrets checks and main-branch guards.

#### 5. Stack and Tooling

- languages, frameworks, package managers, lockfiles, workspaces, databases, and automation platforms;
- build, lint, format, typecheck, and test commands;
- repository type without requiring an application package marker.

#### 6. Quality and CI

- local validation commands;
- CI provider and workflow files;
- required checks and test prerequisites;
- known gaps that prevent reliable staging.

#### 7. Deploy and Infrastructure

- local-only, preview, staging, and production environments;
- hosting and deployment configuration;
- Docker, orchestration, infrastructure-as-code, and operational runbooks;
- manual credentials or administrative prerequisites.

#### 8. Collaboration

- repository host, pull request or merge request terminology, and available CLI;
- issue or project-management integration when already present;
- ownership, review, and branch policies.

#### 9. Agent Kit Personalization

- relevant core rules and commands;
- evidence-based packs, skills, and agents;
- project-owned generated context;
- optional settings that do not affect readiness.

## Action Policy

### Automatic Local Actions

An action can run automatically only when it is local, reversible, idempotent, and merge-safe. Examples:

- create missing Agent Kit-owned directories;
- merge required secrets patterns into `.gitignore`;
- repair missing L0 artifacts from the configured registry;
- write a new readiness snapshot;
- merge a missing default into an Agent Kit-owned config.

### Confirmed Actions

Ask questions is required before:

- initializing or changing the intended Git workflow;
- creating, renaming, publishing, or deleting branches;
- adding or changing a remote;
- installing or replacing hooks;
- creating CI or deployment configuration;
- creating a repository on an external host;
- changing branch protection or provider settings;
- installing uncertain optional components.

### Guided Manual Actions

The onboarding provides a short procedure and verification for:

- authentication;
- organization or instance permissions;
- protected-branch policy;
- secrets stored in external systems;
- deployment account configuration;
- actions blocked by an administrator.

## Install-to-Onboard Handshake

### Proposed Artifacts

- `.cursor/agent-kit.config.json`: stable detected and confirmed repository profile.
- `.cursor/context/readiness.json`: regenerable readiness snapshot and action queue.
- `.cursor/context/config.json`: user preferences and onboarding progress.

These artifacts have separate ownership. Update and repair operations must not overwrite confirmed project facts with lower-confidence detection.

### Snapshot Requirements

The readiness snapshot contains:

- schema version and generator version;
- generation time and repository fingerprint without exposing the absolute path;
- evidence, confidence, and source for each detected fact;
- readiness checks grouped by pillar;
- applied safe fixes;
- pending choices, manual actions, and blockers;
- deferred checks and recovery commands.

### Freshness

The onboarding reruns a check when:

- the snapshot schema is unsupported;
- the repository fingerprint does not match;
- relevant files or Git metadata changed;
- the generator version requires migration;
- the previous check ended in an error.

Unchanged valid checks are reused to avoid repeating work and questions.

## Reference Journeys

### Empty or Non-Git Directory

Detect the absence of project and Git evidence. Ask for repository purpose before proposing structure. Confirm Git initialization and remote setup separately.

### Local-Only Repository

Preserve local-only as a valid operating mode. Explain which collaboration and production routines remain unavailable. Do not pressure the user into choosing a host.

### GitHub

Confirm GitHub from strong evidence, inspect existing branches and workflows, and adapt to the current strategy before proposing staging changes.

### GitLab SaaS

Use merge-request terminology and GitLab CI evidence. Confirm remote or branch mutations.

### GitLab Self-Hosted

Do not infer GitHub from a custom hostname. Detect GitLab through explicit configuration, authenticated CLI/API metadata, or supporting repository evidence. Treat instance-specific capabilities and permissions as unknown until verified.

### Existing Application

Preserve existing package manager, scripts, CI, hooks, and branch policy. Agent Kit integrates with the current repository instead of replacing its conventions.

### Monorepo

Confirm the installation scope. Record workspace boundaries and validation commands. Avoid installing independent root and child setups without an explicit reason.

### Documentation, Knowledge, or Operations Repository

Do not classify the repository as empty because it lacks an application package marker. Detect documentation, prompts, workflow definitions, SQL, infrastructure, and source-of-truth content as meaningful project evidence.

### Existing Agent Kit Installation

Validate manifest, L0 parity, protected content, active plans, HANDOFF, and configuration migrations. Resume incomplete onboarding from the first stale or unresolved check.

## Command Discoverability

The duplicate entry has two independent sources:

- legacy Agent Kit workspace command: `.cursor/commands/onboard.md`;
- Cursor-managed user skill: `~/.cursor/skills-cursor/onboard/SKILL.md`.

Commands and explicit-invocation skills both appear in slash search. Cursor does not deduplicate this collision or document precedence that Agent Kit can rely on. The Cursor-managed skill also has a restricted, preference-focused contract that must not govern repository preparation.

The canonical Agent Kit entry is `/agent-kit-onboard`, implemented as `.cursor/commands/agent-kit-onboard.md`. New installs do not ship `.cursor/commands/onboard.md`.

Migration requirements:

1. install the namespaced command before removing the old managed command;
2. remove the old file only when it matches an Agent Kit-managed version;
3. preserve a customized old file and report the collision;
4. update hooks, docs, install output, registry, and command references;
5. do not retain a visible `/onboard` compatibility alias.

Acceptance requires a clean install to show one Agent Kit onboarding option with a description that explains repository preparation.

## Migration from Legacy Welcome Onboarding

Existing installs may still have `.cursor/commands/onboard.md` or `onboarded: true` from the welcome-only flow.

1. Install or update so `.cursor/commands/agent-kit-onboard.md` is present.
2. Remove the managed legacy command when it matches an Agent Kit-managed version; preserve a customized copy and report the collision.
3. Run `agent-kit doctor --json` (or refresh readiness during `/agent-kit-onboard`) so `.cursor/context/readiness.json` reflects the current repository.
4. Treat `onboarded: true` without readiness evidence as incomplete; resume essential checks until they pass or an allowed non-essential item is deferred with a recovery action.
5. Keep skins and external plan review as optional settings after essentials, not as the first-session path.

## UX Rules

- Explain the outcome before requesting input.
- Show detected and fixed facts before pending decisions.
- Ask one question at a time.
- Do not ask for facts already known with sufficient confidence.
- Use concrete choices with impact, not “standard” or “advanced”.
- Keep future optional settings hidden until essentials pass.
- Preserve existing content by default.
- Report blockers with one next action.
- End every stage with current status and the next step.

## Acceptance

- The first useful message concerns repository readiness.
- Known Git, provider, branch, stack, and infrastructure facts flow from install to onboarding.
- A fully detectable repository requires no setup questions.
- No external or branch mutation occurs without confirmation.
- Re-running install, doctor, or onboarding is idempotent.
- Existing plans, HANDOFF, memory, rules, skills, hooks, and configuration remain intact.
- A docs and operations repository on a self-hosted Git service is not classified as greenfield or GitHub without evidence.
- The slash picker shows one Agent Kit onboarding entry.
- `/start-project` receives a prepared repository profile and asks only for the deliverable goal.
- `/start-project` blocks planning only on unresolved essential checks (`essential: true` in `pillars[].checks[]`). Non-essential pending items such as `collaboration.provider` / `confirm-provider` are warnings only and must not halt Broad Intake or the Gate A / Gate B HITL contract.
