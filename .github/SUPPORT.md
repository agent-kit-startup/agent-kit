# Support

Thanks for using Agent Kit. This page says where to go, so your question reaches
the right place instead of sitting unanswered.

GitHub Discussions is not enabled on this project. **Issues are the support
channel** — questions are welcome there, not just bug reports.

## Try the docs first

Most support questions already have a written answer:

| You want to | Read |
|-------------|------|
| Install and run the first loop | [Getting started](../docs/getting-started.md) |
| Install without a nested `agent-kit/` folder | [Bootstrap](../docs/bootstrap.md) |
| Prepare an existing repo before `/start-project` | [Repository readiness onboarding](../docs/repository-readiness-onboarding.md) |
| Change a setting, flag, or environment variable | [Consumer configuration](../docs/consumer-configuration.md) |
| Add, write, or publish a skill | [Marketplace catalog](../docs/marketplace.md), [Creating skills](../docs/creating-skills.md) |
| Understand what is core vs optional vs planned | [Five-layer claim matrix](../docs/five-layer-claim-matrix.md) |
| Work on the kit itself | [Contributing](../docs/CONTRIBUTING.md) |
| See the whole index | [Docs index](../docs/README.md) |

Before filing anything, run:

```bash
npx @dadado/agent-kit-cli doctor --json
```

`doctor` reports readiness problems and, with `--fix-safe`, repairs the safe
subset. Its output is the single most useful thing to paste into an issue.

## Where to file what

| Kind | Where |
|------|-------|
| Something is broken | Bug report issue |
| Something is missing | Feature request issue |
| "How do I…" / "is this supported?" | Open an issue; questions are in scope |
| Docs are wrong, stale, or unclear | Bug report issue, with the doc path |
| Security vulnerability | **Not an issue** — follow [SECURITY.md](SECURITY.md) |
| Conduct concern | [Code of Conduct](CODE_OF_CONDUCT.md) |
| Code, docs, or skill contribution | PR — see [Contributing](../docs/CONTRIBUTING.md) |

## What makes a question answerable

- CLI version (`npx @dadado/agent-kit-cli --version`) and the `version` field in
  your `.cursor/agent-kit.json`
- OS, Node version, and IDE (Cursor / VS Code / Windsurf — note that VS Code and
  Windsurf generators are partial by design)
- What you ran, what happened, what you expected
- `doctor --json` output, and the relevant terminal output as text rather than a
  screenshot

## Response expectations

This project is maintained on a best-effort basis. There is no support contract
and no guaranteed response time. Issues with a clear reproduction and `doctor`
output are the ones that get resolved fastest. A closed issue is not a dismissal
— read the closing comment, and reopen if it did not actually cover your case.
