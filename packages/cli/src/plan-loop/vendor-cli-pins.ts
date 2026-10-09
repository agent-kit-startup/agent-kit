/**
 * Pinned vendor CLI versions (vendor terms posture): the versions whose
 * headless output format the kit's adapters and contract tests were written
 * against. A version older than `min` cannot run
 * the headless flags; a version newer than `tested` runs with a warning so a
 * vendor output change is named before it is guessed at. Bump `tested` only
 * together with the fixture or contract test that proves the newer format.
 *
 * The fixtures under `fixtures/` emulate these versions; CI does not install
 * vendor binaries, so the pins are checked against recorded or documented
 * output, and the live binary is re-verified on a host that has it.
 */

export type VendorCliId = "claude" | "cursor-agent" | "codex";

export interface VendorCliPin {
  bin: string;
  /** Oldest version the kit's headless argv works with; null = no known floor. */
  min: string | null;
  /** Newest version the contract was checked against (recorded on a host with the binary). */
  tested: string;
  /** Where `tested` was recorded. */
  testedOn: string;
  /** First match is the comparable version (dot-separated numbers). */
  versionRe: RegExp;
}

export const VENDOR_CLI_PINS: Readonly<Record<VendorCliId, VendorCliPin>> = {
  claude: {
    bin: "claude",
    min: "2.1.259",
    tested: "2.1.292",
    testedOn: "2026-10-08 `claude --version` (Linux)",
    versionRe: /(\d+\.\d+\.\d+)/,
  },
  "cursor-agent": {
    bin: "cursor-agent",
    min: null,
    tested: "2026.10.01",
    testedOn: "2026-10-08 `cursor-agent --version` = 2026.10.01-e373342 (Linux)",
    versionRe: /(\d{4}\.\d{2}\.\d{2})(?:-[0-9a-f]+)?/,
  },
  codex: {
    bin: "codex",
    min: null,
    tested: "0.160.1",
    testedOn: "2026-10-08 `codex --version` = codex-cli 0.160.1 (Linux)",
    versionRe: /(\d+\.\d+\.\d+)/,
  },
};

/** Comparable version from raw `--version` output, or null. */
export function parseVendorVersion(id: VendorCliId, raw: string | null): string | null {
  if (!raw) return null;
  return VENDOR_CLI_PINS[id].versionRe.exec(raw)?.[1] ?? null;
}

/** Numeric, segment-wise compare (`2026.10.01` and `2.1.292` alike). */
export function compareVendorVersions(a: string, b: string): number {
  const pa = a.split(/\D+/).filter(Boolean).map(Number);
  const pb = b.split(/\D+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export type VendorVersionStatus =
  | { status: "unknown"; version: null }
  | { status: "too-old"; version: string; message: string }
  | { status: "newer-than-tested"; version: string; message: string }
  | { status: "supported"; version: string };

/** Where a reported version sits against the pin. Never throws. */
export function vendorVersionStatus(id: VendorCliId, raw: string | null): VendorVersionStatus {
  const pin = VENDOR_CLI_PINS[id];
  const version = parseVendorVersion(id, raw);
  if (!version) return { status: "unknown", version: null };
  if (pin.min && compareVendorVersions(version, pin.min) < 0) {
    return {
      status: "too-old",
      version,
      message: `${pin.bin} ${version} is older than ${pin.min}, the oldest version the headless runner supports.`,
    };
  }
  if (compareVendorVersions(version, pin.tested) > 0) {
    return {
      status: "newer-than-tested",
      version,
      message: `${pin.bin} ${version} is newer than ${pin.tested}, the last version the kit's headless contract was checked against; continuing (a changed output format is named here first).`,
    };
  }
  return { status: "supported", version };
}
