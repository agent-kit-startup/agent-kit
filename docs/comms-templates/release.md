# Template: release

Use only when a CHANGELOG version is **closed**, a GitHub Release exists (or is the same tag), and missionkit.io claims match. Current floor: **5.0.0**.

## English

```text
Mission Kit {{version}} is out.

What it is: HITL development operations in Cursor and VS Code (plan, handoff, staging→prod with confirmation). Dashboard: Mission Control.

Install (Agent Kit CLI):
npx @dadado/agent-kit-cli@{{version}} install

Site: https://missionkit.io
Notes: {{link to CHANGELOG section or GitHub Release}}
Source-available: PolyForm Noncommercial; commercial: sales@missionkit.io
```

## Short (X)

```text
Mission Kit {{version}} / Agent Kit CLI @{{version}}

npx @dadado/agent-kit-cli@{{version}} install
https://missionkit.io
```

## Hacker News (optional, after Ask)

Title: `Show HN: Mission Kit {{version}} – HITL plan/handoff/staging→prod for AI IDEs`

Body: dual-name one-liner, install command, what is **not** claimed (no full autonomy, Marketplace listing not this release unless the parked submit plan has actually listed it).
