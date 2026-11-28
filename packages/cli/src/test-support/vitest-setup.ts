/**
 * Global vitest setup (packages/cli/vitest.config.ts `setupFiles`).
 *
 * install, update, init and doctor feed the machine install registry
 * (`~/.config/agent-kit/installs.json`). Point it at a scratch file for every
 * test file so no test, and no CLI child that inherits this env, can write the
 * operator's real registry. A test that needs another path sets it itself.
 * The update check is opted out by env for the same reason.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll } from "vitest";

// Literal on purpose: importing installs/store.ts here would load
// node:fs/promises into the module graph before a test file's vi.mock of it.
const INSTALLS_FILE_ENV = "AGENT_KIT_INSTALLS_FILE";

const scratch = mkdtempSync(path.join(tmpdir(), "ak-installs-test-"));
process.env[INSTALLS_FILE_ENV] = path.join(scratch, "installs.json");

// The update check is on by default (ADR 2026-07-27 Amend 2026-11-26): keep
// every suite, and every CLI child it spawns, off the npm registry. The notice
// cache (`update-notice.json`) lands beside the scratch installs.json. Tests
// of the check itself pass their own env.
process.env.AGENT_KIT_NO_UPDATE_CHECK = "1";

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});
