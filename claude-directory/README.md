# Mission Kit for Claude Code

Plan, build, ship, and keep shipping. Agent Kit gives Claude Code plans with to-dos, a HANDOFF file that survives new chats, durable memory for decisions and errors, and a staging-to-prod git routine with explicit human gates, for long-term projects with your own coding agents.

This folder is the plugin as listed in the Claude plugin directory (version 6.19.0): skills, slash commands and subagents only. It ships no hooks and no scripts. For the session-start context and the shell guard hooks, install the plugin from the repository marketplace instead:

```
/plugin install agent-kit --marketplace agent-kit-startup/agent-kit
```

The slash commands work on a repository prepared by the agent-kit CLI (`agent-kit install`); see [install.md](https://github.com/agent-kit-startup/agent-kit/blob/main/install.md). Mission Control, the browser view of plans and runs, comes with the CLI.

Source, issues and license (Apache-2.0): https://github.com/agent-kit-startup/agent-kit
