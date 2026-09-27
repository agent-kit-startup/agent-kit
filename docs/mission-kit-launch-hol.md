# Mission Kit: HOL launch copy

Source of truth for the launch draft on HOL (https://hol.org/guard/plugins/agent-kit-startup%2Fagent-kit/launches).
Captured from the launch editor on 2026-09-24. Status: private draft, 100% ready, not scheduled.

Registry listing: https://hol.org/registry/plugins/agent-kit-startup%2Fagent-kit

## Basics

| Field | Value |
|---|---|
| Plugin name | Mission Kit |
| Tagline | Plan-driven HITL harness with git DevOps for Cursor and Claude Code. |
| Topics | agents, hitl, handoff |
| Availability | Available |
| Pricing | Open source |
| Version label | v5.13.4 |

## Description

HOL strips line breaks from this field on save, so the description is written as a single paragraph (no headings or lists). Inline code in backticks renders.

Mission Kit is the building gear pack for coding agents: a full harness with built-in project management, human confirmation gates, customized DevOps pipelines and automated flows. You describe the goal. It writes a plan, runs it one unit at a time, and never promotes to production without your explicit yes. How it works: `/start-project` turns a goal into a plan file with to-dos, and nothing runs until you approve it. `/run-plan` executes one unit at a time and writes a HANDOFF, so the next chat picks up where the last one stopped. `/git-staging` ships each finished unit, and `/git-prod` promotes to main only after you pick "Proceed with production deploy". Every question is a real gate with a deterministic hook. In the pack: backlog commands, `/hotfix`, `/qa`, `/run-plan-all` for queued plans, and `/dashboard` for Mission Control, a local cockpit to manage your work as a SCRUM project. Skills, rules and hooks keep the agent inside the contract. Who it's for: devs using Cursor or Claude Code on real production repos who want their agents moving cheap, fast and shipping to the real world.

## Letter to hunters

Also saved as a single paragraph by HOL.

I built Mission Kit because my agents kept making the same three mistakes: forgetting what we decided yesterday, starting work before I agreed to it, and treating main like a scratchpad. Each command in the kit came out of one of those failures. The kit is developed and released through its own staging-then-prod lane, and it is fed every day with /dogfood from dozens of projects built with the tool, by me and fellow developers. What I'd like feedback on: are the confirmation gates in the right places, or do they slow you down? Which harness should come after Cursor and Claude Code? One thing to try today: install it, open any repo, run onboard and then /start-project with a one-line goal. You get a project-oriented plan with clear to-dos, managed context and memory, and you approve it before anything touches your code. MIT licensed and free to use.

## Media

Order as published. The first image is the cover. Files live in `assets/brand/`.

| # | File | Caption | Alt text |
|---|---|---|---|
| 1 (cover) | mission-kit-s1.png | Four commands take a goal from plan to production. You approve the plan and the release. | Mission Kit cover: astronaut helmet logo, tagline and the core commands /start-project, /run-plan, /git-staging, /git-prod |
| 2 | mission-kit-s2.png | One to-do per run, a HANDOFF between chats, staging after every unit, main only when you say so. | Five-step flow: goal intake, plan file, one unit per run, staging, production after explicit confirmation |
| 3 | mission-kit-s3.png | The production gate. Skip it or cancel and the run stops, with nothing pushed to main. | The /git-prod confirmation gate with three options: Proceed with production deploy, Review changes first, Cancel |

## Links

| Field | Value |
|---|---|
| Website | https://github.com/agent-kit-startup/agent-kit (swap for the landing URL when it is live) |
| Docs | https://github.com/agent-kit-startup/agent-kit/tree/main/docs |
| Source | https://github.com/agent-kit-startup/agent-kit |
