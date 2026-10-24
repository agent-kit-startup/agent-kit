#!/usr/bin/env node
/**
 * Sign the engine artifact's SHA256SUMS with the engine signing key (minisign format), for
 * IDE hosts that verify what they install (ADR 2026-10-19_colony-managed-engine-distribution,
 * Decision 2 and Consequence 4; Colony `engine.rs` `verify_sums_signature`).
 *
 *   ENGINE_SIGNING_KEY=<minisign secret key file, text or base64 of it> \
 *   [ENGINE_SIGNING_PUBKEY=<RW... line>] \
 *   node scripts/sign-engine-artifact.mjs --file dist/engine/SHA256SUMS [--comment <text>]
 *
 * Writes `<file>.minisig`: a prehashed Ed25519 minisign signature (what `minisign -S`
 * writes; `minisign -Vm <file> -P <RW...>` verifies it). The key must be passwordless
 * (`minisign -G -W`): the secret lives in the CI secret store, and an encrypted key would
 * need its password there too. The script checks the key's own public half, verifies the
 * signature it wrote, and, when ENGINE_SIGNING_PUBKEY is set, that the key is that one.
 * Node built-ins only.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

function b64Line(text, what) {
  const line = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(line)) throw new Error(`${what} is not base64`);
  return Buffer.from(line, "base64");
}

/** Parse a passwordless minisign secret key file (text, or base64 of the file). */
export function parseSecretKey(input) {
  let text = String(input ?? "").trim();
  if (!text) throw new Error("ENGINE_SIGNING_KEY is empty");
  if (!text.startsWith("untrusted comment:")) {
    text = Buffer.from(text, "base64").toString("utf8").trim();
  }
  const lines = text.split(/\r?\n/);
  if (!lines[0].startsWith("untrusted comment:") || lines.length < 2) {
    throw new Error("ENGINE_SIGNING_KEY is not a minisign secret key file");
  }
  const raw = b64Line(lines[1], "the secret key line");
  if (raw.length !== 158)
    throw new Error(`minisign secret key has ${raw.length} bytes, expected 158`);
  if (raw.subarray(0, 2).toString("latin1") !== "Ed")
    throw new Error("not an Ed25519 minisign key");
  const kdf = raw.subarray(2, 4).toString("latin1");
  if (kdf !== "\0\0") {
    throw new Error(
      "the engine signing key is password-protected: create it with `minisign -G -W`",
    );
  }
  const keyId = raw.subarray(54, 62);
  const seed = raw.subarray(62, 94);
  const pk = raw.subarray(94, 126);
  const priv = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, seed]),
    format: "der",
    type: "pkcs8",
  });
  const derived = createPublicKey(priv).export({ format: "der", type: "spki" }).subarray(-32);
  if (!derived.equals(pk))
    throw new Error("minisign secret key is corrupt (public half does not match)");
  return { keyId, priv, pk };
}

/** The `RW...` public key line of a parsed key. */
export function publicKeyLine(key) {
  return Buffer.concat([Buffer.from("Ed", "latin1"), key.keyId, key.pk]).toString("base64");
}

/** minisign signature file text for `data` (prehashed, BLAKE2b-512). */
export function signMinisig(data, key, trustedComment) {
  if (/[\r\n]/.test(trustedComment)) throw new Error("the trusted comment must be one line");
  const digest = createHash("blake2b512").update(data).digest();
  const sig = sign(null, digest, key.priv);
  const global = sign(null, Buffer.concat([sig, Buffer.from(trustedComment, "utf8")]), key.priv);
  const sigLine = Buffer.concat([Buffer.from("ED", "latin1"), key.keyId, sig]).toString("base64");
  return [
    "untrusted comment: signature from the Agent Kit engine signing key",
    sigLine,
    `trusted comment: ${trustedComment}`,
    global.toString("base64"),
    "",
  ].join("\n");
}

/** Verify a minisign signature file over `data` with an `RW...` public key line. */
export function verifyMinisig(data, sigText, publicKey) {
  const pkRaw = b64Line(publicKey, "the public key");
  if (pkRaw.length !== 42 || pkRaw.subarray(0, 2).toString("latin1") !== "Ed") {
    throw new Error("not a minisign Ed25519 public key");
  }
  const lines = String(sigText).split(/\r?\n/);
  const sigRaw = b64Line(lines[1] ?? "", "the signature line");
  const tc = lines[2] ?? "";
  if (!tc.startsWith("trusted comment: ")) throw new Error("no trusted comment");
  const global = b64Line(lines[3] ?? "", "the global signature line");
  if (sigRaw.length !== 74 || global.length !== 64) throw new Error("malformed minisign signature");
  const alg = sigRaw.subarray(0, 2).toString("latin1");
  if (alg !== "ED") throw new Error(`signature algorithm ${alg} is not prehashed Ed25519 (ED)`);
  if (!sigRaw.subarray(2, 10).equals(pkRaw.subarray(2, 10)))
    throw new Error("signature is by another key");
  const pub = createPublicKey({
    key: Buffer.concat([SPKI_ED25519, pkRaw.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const sig = sigRaw.subarray(10);
  const digest = createHash("blake2b512").update(data).digest();
  if (!verify(null, digest, pub, sig)) throw new Error("signature does not match the file");
  const comment = tc.slice("trusted comment: ".length);
  if (!verify(null, Buffer.concat([sig, Buffer.from(comment, "utf8")]), pub, global)) {
    throw new Error("trusted comment signature does not match");
  }
  return comment;
}

function main() {
  const { values } = parseArgs({
    options: { file: { type: "string" }, comment: { type: "string" } },
  });
  if (!values.file) throw new Error("--file is required");
  const key = parseSecretKey(process.env.ENGINE_SIGNING_KEY);
  const pub = publicKeyLine(key);
  const want = (process.env.ENGINE_SIGNING_PUBKEY ?? "").trim();
  if (want && want !== pub) {
    throw new Error("ENGINE_SIGNING_KEY is not the key whose public half is ENGINE_SIGNING_PUBKEY");
  }
  const data = readFileSync(values.file);
  const comment = values.comment ?? `file:${basename(values.file)}`;
  const text = signMinisig(data, key, comment);
  verifyMinisig(data, text, pub);
  writeFileSync(`${values.file}.minisig`, text);
  console.log(`sign-engine-artifact: ${values.file}.minisig (public key ${pub})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (err) {
    console.error(`sign-engine-artifact: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
