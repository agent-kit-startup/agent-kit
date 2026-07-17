import { describe, expect, it } from "vitest";
import { DEFAULT_REGISTRY_REF, DEFAULT_REGISTRY_URL, assertSafeRegistrySource } from "./resolve.js";

describe("assertSafeRegistrySource", () => {
  it("accepts the default public registry", () => {
    expect(() =>
      assertSafeRegistrySource(DEFAULT_REGISTRY_URL, DEFAULT_REGISTRY_REF),
    ).not.toThrow();
  });

  it("accepts https urls with branch/tag refs", () => {
    expect(() =>
      assertSafeRegistrySource("https://github.com/org/repo", "release/v3.1.0"),
    ).not.toThrow();
    expect(() =>
      assertSafeRegistrySource("https://gitlab.com/org/repo.git", "v3.1.0"),
    ).not.toThrow();
  });

  it("rejects command-executing git transports (ext::, ssh, file)", () => {
    expect(() => assertSafeRegistrySource("ext::sh -c 'id>/tmp/pwned'", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("file:///etc", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("ssh://host/repo", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("git@github.com:org/repo.git", "main")).toThrow(/https/);
  });

  it("rejects argument injection via leading dash", () => {
    expect(() => assertSafeRegistrySource("--upload-pack=touch /tmp/x", "main")).toThrow(/https/);
    expect(() => assertSafeRegistrySource("https://github.com/org/repo", "--force")).toThrow(
      /invalid/,
    );
  });

  it("rejects refs with shell metacharacters", () => {
    expect(() => assertSafeRegistrySource("https://github.com/org/repo", "main; rm -rf")).toThrow(
      /invalid/,
    );
  });
});
