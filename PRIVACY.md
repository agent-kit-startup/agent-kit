# Privacy

Mission Kit (Agent Kit on npm) collects no telemetry.

## Install, init, and hooks

`agent-kit init` (`packages/cli/src/commands/init.ts`) is a wrapper over install. `agent-kit install` (`packages/cli/src/commands/install.ts`) writes local project files. Neither command posts usage events, identifiers, or prompt text.

Hooks in `.cursor/hooks/` call the local CLI. The shell adapters do not open a network connection. Two optional checks stay off unless `.cursor/context/config.json` turns them on (`updateCheck.enabled` and `cursorUpdateCheck.enabled` both default to false in `.cursor/context/config.example.json`):

- Update check: a GET of the public npm document for `@dadado/agent-kit-cli`.
- Cursor changelog check: a GET of the changelog URL stored in that config (default `https://cursor.com/changelog`).

Those checks do not upload a usage report.

When the project has no local skill registry, install can clone the public repository over HTTPS into a local cache and copy files from it. That is a download of public source.

`scripts/install-ubuntu24-bare-metal.sh` can download the Node.js setup script from NodeSource on a machine that has no Node. That download is the Node installer.

## Website

<https://missionkit.io/> does not include a contact form and does not ask for an email address. A commercial question is an email the visitor sends to sales@missionkit.io from their own mail client.

The page requests the public GitHub star count for `agent-kit-startup/agent-kit`. Opening the demo loads a YouTube embed.

## License

The software is PolyForm Noncommercial 1.0.0, as is, with no warranty. See [LICENSE](LICENSE). Commercial use needs a separate license: sales@missionkit.io.
