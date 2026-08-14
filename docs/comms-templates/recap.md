# Template: recap

Short cycle tied to **already merged** CHANGELOG `[Unreleased]` or a dated slice of shipped 5.0.0 work. Not a preview of unmerged branches.

Fill `{{placeholders}}`. Run claim check in [comms-content-calendar.md](../comms-content-calendar.md) before Ask.

## English (docs / Medium / newsletter)

```text
Mission Kit recap ({{date}})

Shipped in the Agent Kit repo / CLI this cycle:
{{bullet list from CHANGELOG, no unshipped items}}

Install stays Agent Kit: npx @dadado/agent-kit-cli@5.0.0 install
Site: https://missionkit.io
Contribute: issues and PRs on https://github.com/agent-kit-startup/agent-kit

HITL framework: plans and staging can move; production still needs a human yes.
```

## Short (X)

```text
Mission Kit recap: {{one shipped fact}}.

npx @dadado/agent-kit-cli@5.0.0 install
https://missionkit.io
```

## Portuguese (optional; launch voice)

Reuse tone from [public-launch-announcement.md](../public-launch-announcement.md). Keep dual-name (Mission Kit product / Agent Kit install) and do not add features absent from CHANGELOG.
