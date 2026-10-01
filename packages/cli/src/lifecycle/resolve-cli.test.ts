import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentKitManifest } from "../manifest/types.js";
import { DEFAULT_REGISTRY_URL } from "../registry/resolve.js";
import { resolveRegistryFromCli } from "./resolve-cli.js";

const resolveRootMock = vi.hoisted(() => vi.fn());
const infoMock = vi.hoisted(() => vi.fn());
const warnMock = vi.hoisted(() => vi.fn());

vi.mock("../registry/resolve.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../registry/resolve.js")>();
  return { ...mod, resolveRegistryRoot: (...args: unknown[]) => resolveRootMock(...args) };
});

vi.mock("../utils/logger.js", () => ({
  logger: { info: infoMock, warn: warnMock, success: vi.fn(), error: vi.fn() },
}));

function manifestWith(url: string, ref = "main"): AgentKitManifest {
  return { registry: { url, ref } } as AgentKitManifest;
}

describe("resolveRegistryFromCli registry source notice", () => {
  beforeEach(() => {
    resolveRootMock.mockReset().mockResolvedValue({ root: "/r", source: "remote-cache" });
    infoMock.mockReset();
    warnMock.mockReset();
  });

  it("prints nothing when the url comes from --url or the built-in default", async () => {
    await resolveRegistryFromCli({ cwd: "/p", manifest: null });
    await resolveRegistryFromCli({
      cwd: "/p",
      url: "https://example.com/fork",
      manifest: manifestWith("https://example.com/other"),
    });
    expect(infoMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
    expect(resolveRootMock.mock.calls[1]?.[0].registryUrl).toBe("https://example.com/fork");
  });

  it("prints an info line when the manifest carries the default url", async () => {
    await resolveRegistryFromCli({ cwd: "/p", manifest: manifestWith(DEFAULT_REGISTRY_URL, "v1") });
    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(infoMock).toHaveBeenCalledWith(`registry: ${DEFAULT_REGISTRY_URL}@v1 (from manifest)`);
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("adds a warning line when the manifest url is not the default", async () => {
    const url = "https://example.com/fork";
    await resolveRegistryFromCli({ cwd: "/p", manifest: manifestWith(url) });
    expect(infoMock).toHaveBeenCalledWith(`registry: ${url}@main (from manifest)`);
    expect(warnMock).toHaveBeenCalledTimes(1);
    expect(warnMock.mock.calls[0]?.[0]).toContain(url);
    expect(resolveRootMock.mock.calls[0]?.[0].registryUrl).toBe(url);
  });
});
