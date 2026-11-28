---
name: cursor-skills-node
description: Kit guidance for Node.js (Express, NestJS, Next.js): repo tooling first, strict types, validated config, thin handlers.
version: 0.2.0
category: language
---

# Node.js and TypeScript

- **Use the repo's tooling.** One package manager and its lockfile; the Node version pinned (`engines`, `.nvmrc` or mise). Lint and format with the repo's config.
- **TypeScript is strict.** No `any` without a comment saying why. Follow the package's module type (ESM or CJS) and do not mix them.
- **Async:** `async`/`await`, no floating promises, a timeout on every outbound call.
- **Config comes from the environment,** validated once at startup; the process fails fast. No `process.env` scattered through the code.
- **Thin handlers.** Route handlers and controllers parse and respond; logic lives in services, I/O in adapters. This holds for Express, NestJS and Next.js route handlers.
- **Next.js:** server components by default, client components marked on purpose, secrets only on the server.
- **Security:** validate input, never `eval`, run a dependency audit in CI.
- **Tests:** colocated or under `tests/`; unit tests make no network calls.
