# Cartesi Primer — Primary-Source Study

**Phase:** `phase0-primary-source-study` (`cartesi-decentralized-llm-compute.plan.md`)
**Accessed:** 2026-08-24, from this environment (unproxied — see "Environment correction" below).
**Method:** Primary sources only — official GitHub repos (via `gh api`, which returns exact commit SHAs), `docs.cartesi.io` (fetched live), the original 2018 whitepaper PDF (fetched and read in full, 16 pages), and `governance.cartesi.io`. Every claim below is tagged with its source URL and either a commit SHA (GitHub) or a page/doc-version identifier (docs site, whitepaper). Anything not independently confirmed here is marked `UNVERIFIED`.

## Environment correction (important for later phases)

The plan's "Evidence note (2026-08-24)" states that the Broad Intake research session's egress proxy **blocked** `docs.cartesi.io`, `cartesi.io`, and `docs.mugen.builders`, and that Phase 0 exists to re-derive claims "in an unblocked environment." **That block does not apply in this environment.** `docs.cartesi.io`, `cartesi.io/cartesi_whitepaper.pdf`, `governance.cartesi.io`, and all `github.com/cartesi/*` repositories were all directly reachable via `curl`, `WebFetch`, and `gh api` in this session, with no proxy interference observed. This primer is built entirely from those directly-fetched primary sources, not from search-result summaries.

One correction to the plan's source list itself: **`cartesi/cartesi-coprocessor` does not exist.** The actual repository is **`cartesi/coprocessor`** (confirmed via `gh api repos/cartesi/coprocessor`, commit `f8c94a105ba3ba6edb7b130d91f5600aca66642b`). This primer cites the correct repo.

---

## 1. The Cartesi Machine

**What it is.** A deterministic RISC-V virtual machine that boots a full Linux operating system, used as the reproducible off-chain execution environment for Cartesi applications.

- **Architecture:** Implements RV64GC-class RISC-V (the whitepaper specifies the more precise **RV64IMASU** ISA — 64-bit, Integer+Mul/Div, Atomics, Supervisor+User privilege levels, Sv48 virtual memory — 99 total instructions). Runs a full Linux kernel via a Berkeley Boot Loader (BBL)/SBI shim, giving DApp developers "all the programming languages, tools, libraries, software, and services they are already familiar with." *(Whitepaper §1, §3, p.1–4; `cartesi/machine-emulator` README.)*
- **Self-contained / isolated:** "The Cartesi machine is self-contained and can't make an external request." *(docs.cartesi.io, `cartesi-rollups/2.0/core-concepts/cartesi-machine/`, verbatim.)*
- **Deterministic / reproducible:** "Given the same initial state and input, the Cartesi Machine will always produce the same output and final state." State transitions happen deterministically as RISC-V instructions execute. Floating point is emulated via a consistent software layer (not native hardware FP) specifically to preserve bit-for-bit reproducibility across hosts — the whitepaper spends an entire section (§4.3) justifying this because "different floating-point implementations can disagree subtly when ostensibly performing the same operation." *(docs.cartesi.io `cartesi-rollups/2.0/core-concepts/cartesi-machine/`; Whitepaper §4.3, p.7.)*
- **State representation — Merkle root:** The machine's entire physical address space (64-bit) is exposed as a binary Merkle tree keyed on Keccak-256 (chosen for Ethereum compatibility), built bottom-up from 2^61 64-bit-word leaves to a single root hash. A state is represented on-chain purely as this root hash; contents are known only off-chain. The reference emulator maintains this tree in PATRICIA form for storage efficiency and updates it lazily (dirty-page bitmap + TLB) for time efficiency. *(Whitepaper §5.1, p.8, incl. equations (2)-(6); `cartesi/machine-emulator` README: "State Merkle tree computation, for generating cryptographic proofs.")*
- **Transparent / auditable:** the emulator is open-source C/C++ (POSIX-restricted to terminal/process/mmap), current stable release **v0.21.0** (published 2026-08-04), default branch `main` at commit `bd09538131e589319e371d7d65e81c2c82dd3411` as of 2026-08-23. *(`gh api repos/cartesi/machine-emulator`.)*
- **Runs standard software (llama.cpp-class workloads):** because it's a real Linux/RISC-V machine (not a custom VM/circuit), it can run any software that compiles for RISC-V Linux — the whitepaper's stated goal is exactly to avoid "ad-hoc new architecture" and "the porting of a toolchain and operating system" that custom smart-contract VMs would require. No primary source directly says "llama.cpp" or "PyTorch" run today — that capability follows from "full Linux + standard toolchain," not from a specific named benchmark. **Marking the specific claim "llama.cpp runs inside a Cartesi Machine today" `UNVERIFIED`** — it is a reasonable inference from the general-purpose-Linux design, not a primary-source-confirmed fact, and Phase 1's harness is precisely the place this gets tested for real.

## 2. Rollups (2.0) — on-chain / off-chain architecture

*Primary source: `docs.cartesi.io/cartesi-rollups/2.0/` (marked "Version: 2.0 (Unreleased)" on the architecture page, last-updated 2026-02-11), cross-checked against `cartesi/rollups-contracts` (commit `549408f8514f2ff74348bc3413524078b9e1dbb2`, default branch `main`, latest tagged release `v2.2.0` published 2026-02-06).*

### On-chain layer
- **InputBox:** "All inputs destined for a Cartesi dApp are first submitted to this contract, which then emits events that the off-chain components can process." Entry point for data availability and transaction ordering.
- **Application contract** (docs call it "CartesiDApp"; the current contracts repo names the interface `Application`/`ApplicationFactory`): "acts as the on-chain representation of the dApp and can hold ownership of digital assets on the base layer, including Ether, ERC-20 tokens, and NFTs."
- **ApplicationFactory:** "allows developers to deploy new CartesiDApp instances with a single function call."
- **Portals:** asset-transfer contracts for ETH, ERC-20, ERC-721, ERC-1155 (single and batch) — `ERC20Portal` is the one named in the plan; confirmed present alongside `EtherPortal`, `ERC721Portal`, `ERC1155SinglePortal`, `ERC1155BatchPortal` in the 2.0 API reference tree.
- **IConsensus** and implementations:
  - **Authority:** "Single-owner consensus controlled by one address."
  - **Quorum:** "Multi-validator consensus requiring majority approval."
  - **DaveConsensus:** confirmed via a separate docs page (`fraud-proofs/references/daveconsensus/`) — "the consensus contract for applications that use Dave-style tournaments (such as PRT) for verification," which "manages epochs, defined as half-open block-number intervals" and links "input ingestion, epoch progression, and Dave tournament-based verification under a single consensus interface." **The exact migration mechanics between Authority → Quorum → DaveConsensus were not found on a single primary page** in this pass — the consensus-overview page enumerates Authority and Quorum but did not surface DaveConsensus content in the same fetch, and a direct `.../consensus/daveconsensus/` API path returned 404. Treat "the migration path is a live, seamless swap" as `UNVERIFIED`; Phase 3 (which owns this specifically) should re-fetch `fraud-proofs/references/daveconsensus/` directly and also check `IConsensus`'s interface definition in the contracts repo source for whether swapping the consensus contract is a first-class supported operation or requires redeployment.
- **Claim structure:** a claim = {application contract address, last processed block number, outputs Merkle root}. Validated when: the block number lands on an epoch boundary (`block % epochLength == epochLength - 1`), the block is in the past, and no duplicate claim exists for that application+epoch. Once valid, "the outputs Merkle root becomes valid and can be used to validate individual outputs in the application contract."

### Off-chain layer / data flow
- **Advance state:** modifications to application state, submitted via InputBox. The node processes each input, executes the backend logic in the Cartesi Machine, and produces outputs — **vouchers** (on-chain calls, e.g. ERC-20 transfers), **notices** (arbitrary informational log entries with a validity proof), and **reports** (diagnostic, non-authenticated output), queryable via the node's JSON/GraphQL API.
- **Inspect state:** "sends an inspect-state request to the dApp backend passing the payload string in the URL." Key properties, quoted: "the whole Cartesi Machine is rolled back after processing the inspect-state request" (machine mode); "this method is synchronous, so it is not advised to perform resource-intensive operations"; "Inspect-state inputs do not produce vouchers or notices." Response is a status (`accept`/`reject`/`exception`) plus reports only. This is the read-only query path — no state mutation, no on-chain settlement.
- **advance → finish handshake:** the backend calls `finish` after processing each advance request, with `status: accept | reject`. "If the advance-state request is rejected, the vouchers and notices are discarded. In contrast, reports are not discarded in case of rejection." The Rollup HTTP Server then returns the next pending request in the `finish` response body (long-poll style; host mode returns HTTP 202 after ~10s if nothing is pending).
- **Epoch/claim lifecycle:** the node "bundles multiple advance-state inputs into an epoch" and submits a claim (outputs Merkle root over that epoch) for on-chain validation once the epoch closes, per the IConsensus rules above.

## 3. Coprocessor + EigenLayer AVS model

*Primary source: `cartesi/coprocessor` README (commit `f8c94a105ba3ba6edb7b130d91f5600aca66642b`).*

- **What it is:** "The Cartesi Coprocessor combines the technologies of EigenLayer and the Cartesi Machine to provide expressive, verifiable off-chain computation for Ethereum smart contracts," built as an EigenLayer AVS (Actively Validated Service).
- **Components (off-chain):**
  - **Coprocessor Operator** — "a stateless executor that receives and runs Cartesi Machines with a specific input and signs the resulting computation. Operators do not retain any local state between requests."
  - **Coprocessor Solver** — "a coordination agent that listens for computation requests emitted by smart contracts. It orchestrates the execution using a set of Operators, aggregates their BLS signatures on the result, and submits the aggregated proof back on-chain via a callback to the originating contract."
- **Model, precisely:** this is a smart-contract-requests-computation → operator-set-executes → **BLS-signature-aggregation** → **on-chain callback** pattern. It is **economically/cryptographically attested via EigenLayer restaking + operator signatures**, not a fraud-proof/dispute-game pattern — the README states this explicitly: "This architecture enables highly parallel, verifiable computation with strong cryptographic guarantees of correctness, **without requiring interactive fraud proofs or continual on-chain execution**." That is an important distinction for the plan's Phase 2 threat model: the Coprocessor's trust model is EigenLayer operator-set honesty/slashing, not Dave/PRT's one-of-N challenge game. Related repos: `coprocessor-solver`, `coprocessor-operator`, `coprocessor-advance-runner`, `coprocessor-evm-call` (all under `cartesi/`).
- **Deployment target:** targets EigenLayer's "Operator Sets" and "Slashing" contract generation; ships a Holesky testnet deployment config. Apache-2.0 licensed.

## 4. Dave / PRT — one-of-N fraud-proof security

*Primary sources: `cartesi/dave` README (commit `34d84178e4f120877ea87f496de9225617315f3f`, default branch `main`, latest tag `v2.1.1` published 2026-03-10) and `docs.cartesi.io/fraud-proofs/prt/prt-introduction/`.*

- **What it is:** "Dave" is Cartesi's permissionless fraud-proof consensus system — Solidity contracts + a Rust validator node + Lua clients + dispute-algorithm specs, using the Cartesi Machine as the execution/verification substrate. Its initial implementation is **PRT (Permissionless Refereed Tournaments)**.
- **One-of-N security, verbatim from the repo:** Dave targets "one-of-N security: under the protocol's stated correctness, clock, and censorship assumptions, one correct validator can prevent an incorrect result." Docs echo this: "fraud proofs that are secure where 1-of-N honesty suffices, decentralized where anyone can participate."
- **Mechanism, high level (docs.cartesi.io):** incompatible claims enter a bracket-style tournament; each round is refereed by comparing **computation hashes** (Merkle trees over the *entire computational history*, not just final state) rather than the older single-final-state comparison — this lets mutually-honest validators collaborate without trusting each other, and prevents adversaries from "misplaying" honest claims mid-dispute. Disputes start from sparse hashes and recurse into denser hashes as the disagreement narrows, terminating in a one-step proof (this is the same bisection-to-one-step idea as the whitepaper's original verification game — see §5 below — generalized to survive Sybil crowds). Settlement time scales as "logarithm squared in the number of Sybils," while an honest validator's own workload stays logarithmic. Bond requirements scale similarly, making mass-Sybil attacks economically unattractive without requiring a permissioned validator set.
- **Relation to the 2018 whitepaper's verification game:** the whitepaper (§5.2, "Crowd disputes," §7) explicitly flags that its original two-player (Alice/Bob) verification game is vulnerable to a "coordinated crowd of dishonest participants ... using sequential disputes over an honest result as a denial-of-service attack," and says Cartesi has "developed a variant of the verification game that enables any honest participant to defend his result against an entire crowd at negligible cost" — PRT/Dave is that promised generalization, now shipped.

## 5. The 2018 whitepaper — foundational model

*Primary source: `cartesi.io/cartesi_whitepaper.pdf`, fetched directly (937,605 bytes, PDF 1.3, 16 pages). Title page: "This is the original whitepaper for the Cartesi project published in 2018 ... the Cartesi technology in its current state is the product of years of research, development, and contributions." Document itself: **"The Core of Cartesi," Version 1.01**, authors Augusto Teixeira and Diego Nehab.*

Core ideas that still hold (per the docs/repo cross-checks above) vs. superseded:

| Whitepaper concept (2018, v1.01) | Current status (2026, per primary sources above) |
|---|---|
| Cartesi Machine: self-contained, deterministic RISC-V, Linux-capable | **Unchanged in principle**; ISA/tooling has evolved (current emulator targets RV64GC-class per the repo, whitepaper specified RV64IMASU) |
| State = Merkle root over 64-bit address space, Keccak-256 | **Unchanged**, confirmed in `cartesi-rollups/2.0` outputs-Merkle-root claim structure |
| Two-player verification game (Alice/Bob, binary-search bisection to one step, arbiter = blockchain) | **Superseded/generalized** by Dave/PRT's tournament model, explicitly to fix the whitepaper's own acknowledged crowd-dispute weakness (§5.2, §7) |
| Dispute delegation market (principal delegates a dispute to a proxy for a fee, proxy stakes principal's collateral) | **Not found** as a currently-documented, named feature in `docs.cartesi.io` or the rollups-contracts / dave repos surveyed here — mark `UNVERIFIED` whether this shipped as designed, was renamed, or was dropped. Worth a direct follow-up search in a later phase if the plan's provider/scheduler design (Phase 6) wants to reuse this pattern. |
| "Cartesi Node" as the per-user off-chain software+hardware host | **Terminology evolved**: current docs speak of "Cartesi Rollups Node" with Validator/Reader modes, not the whitepaper's Alice/Bob/Charlie per-user node model — the 2018 paper predates the rollups architecture entirely (it describes a more general "expression DAG" model of composable disputable primitives, not the InputBox/Application/IConsensus contracts of Rollups 2.0) |
| Layer-2, hybrid on-chain/off-chain DApps, "any dispute settles at negligible on-chain cost" | **Unchanged as the core value proposition**, now delivered via the Rollups + Dave stack rather than the whitepaper's original generic expression-DAG interface |

**Important framing correction for this plan:** the 2018 whitepaper describes an earlier, more general architecture (arbitrary "expression DAGs" of disputable/constant primitives, generic two-party verification games) that is **not** what ships today. The plan's Phase 2/3 architecture should be designed against the **current** Rollups 2.0 + Dave/PRT + Coprocessor stack (sections 1–4 above), using the whitepaper only for the foundational *why* (determinism requirement, Merkle-root state commitment, dispute-arbitration cost argument) — not as a literal current API reference.

## 6. governance.cartesi.io

*Primary source: fetched directly.*

A Discourse-based governance forum ("Cartesi Governance - Grants and governance proposal area"), with categories: General Discussions, Metagovernance & Policies, Cartesi Grants Program, Technical Vision Forum, Proposed RFPs (explicitly "for proposing RFPs for high-impact work needed in the ecosystem, aligned with the CGP Intents"), and an Old & Archived RFPs section. This is the correct venue named in Phase 8's worker_contract ("ecosystem-fit note for governance.cartesi.io") — confirmed reachable and structurally suited to that deliverable. No specific proposal content was reviewed in this pass (out of scope for Phase 0; Phase 8 should read live threads before drafting its post).

## 7. Claim table

| # | Claim | Source URL | SHA / Version | Verified? |
|---|---|---|---|---|
| 1 | Cartesi Machine implements RISC-V, boots full Linux | `cartesi.io/cartesi_whitepaper.pdf` §3 | v1.01 (2018) | Verified |
| 2 | Cartesi Machine implements RV64IMASU (whitepaper) | `cartesi.io/cartesi_whitepaper.pdf` §3.1, p.4 | v1.01 | Verified |
| 3 | Cartesi Machine is self-contained, cannot make external requests | `docs.cartesi.io/cartesi-rollups/2.0/core-concepts/cartesi-machine/` | fetched 2026-08-24, docs site (no per-page version marker found) | Verified |
| 4 | Same input+initial state -> same output+final state (determinism) | `docs.cartesi.io/cartesi-rollups/2.0/core-concepts/cartesi-machine/` | fetched 2026-08-24 | Verified |
| 5 | State represented as Merkle tree, root = single hash, Keccak-based | `cartesi.io/cartesi_whitepaper.pdf` §5.1, p.8 | v1.01 | Verified |
| 6 | Current stable emulator release v0.21.0; default branch `main` | `github.com/cartesi/machine-emulator` | release `v0.21.0` (2026-08-04); commit `bd09538131e589319e371d7d65e81c2c82dd3411` (2026-08-23) | Verified (via `gh api`) |
| 7 | InputBox = data availability + input ordering entry point | `docs.cartesi.io/cartesi-rollups/2.0/getting-started/architecture/` | "2.0 (Unreleased)", last-updated 2026-02-11 | Verified |
| 8 | Application contract holds ETH/ERC-20/NFT ownership on base layer | `docs.cartesi.io/cartesi-rollups/2.0/getting-started/architecture/` | same as #7 | Verified |
| 9 | ApplicationFactory deploys new Application instances | `docs.cartesi.io/cartesi-rollups/2.0/getting-started/architecture/` | same as #7 | Verified |
| 10 | Portals support ETH, ERC-20, ERC-721, ERC-1155 (single+batch) | `docs.cartesi.io/cartesi-rollups/2.0/api-reference/contracts/overview/` sitemap paths | 2.0 | Verified (via sitemap + architecture page) |
| 11 | Authority = single-owner consensus | `docs.cartesi.io/cartesi-rollups/2.0/api-reference/contracts/consensus/overview/` | 2.0 | Verified |
| 12 | Quorum = multi-validator majority consensus | same as #11 | 2.0 | Verified |
| 13 | DaveConsensus manages epochs (half-open block intervals), ties input ingestion + epoch progression + Dave tournaments under one IConsensus | `docs.cartesi.io/fraud-proofs/references/daveconsensus/` | fetched 2026-08-24 | Verified |
| 14 | Exact Authority -> Quorum -> DaveConsensus migration mechanics | not found on a single primary page in this pass | — | **UNVERIFIED** — re-check in Phase 3 |
| 15 | rollups-contracts repo: default branch `main`, latest tag `v2.2.0` | `github.com/cartesi/rollups-contracts` | tag `v2.2.0` (2026-02-06); commit `549408f8514f2ff74348bc3413524078b9e1dbb2` (2026-08-19) | Verified (via `gh api`) |
| 15b | Claim = {app address, last processed block, outputs Merkle root}; validity rules (epoch-boundary block, past block, no duplicate) | `docs.cartesi.io/cartesi-rollups/2.0/api-reference/contracts/consensus/overview/` | 2.0 | Verified |
| 16 | Advance = InputBox-submitted, produces vouchers/notices/reports | `docs.cartesi.io/cartesi-rollups/2.0/getting-started/architecture/`, `.../api-reference/rollup/finish/` | 2.0 | Verified |
| 17 | Inspect = synchronous, read-only, machine rolled back after, no vouchers/notices, reports+status only | `docs.cartesi.io/cartesi-rollups/2.0/api-reference/inspect/inspect/` | 2.0 | Verified |
| 18 | finish() advance semantics: accept/reject; rejected discards vouchers/notices but keeps reports; long-poll for next input | `docs.cartesi.io/cartesi-rollups/2.0/api-reference/rollup/finish/` | 2.0 | Verified |
| 19 | Correct Coprocessor repo is `cartesi/coprocessor`, not `cartesi/cartesi-coprocessor` | `github.com/cartesi/coprocessor` | commit `f8c94a105ba3ba6edb7b130d91f5600aca66642b` | Verified (404 confirmed for the plan's originally-named repo) |
| 20 | Coprocessor = EigenLayer AVS; Operator (stateless executor, signs result) + Solver (aggregates BLS sigs, submits callback) | `github.com/cartesi/coprocessor` README | commit `f8c94a105ba3ba6edb7b130d91f5600aca66642b` | Verified |
| 21 | Coprocessor explicitly does NOT use interactive fraud proofs — attested via signature aggregation, not dispute game | same as #20 | same | Verified — **material for Phase 2 threat model: Coprocessor security = EigenLayer operator honesty/slashing, not Dave-style 1-of-N** |
| 22 | Dave = permissionless fraud-proof system (Solidity + Rust validator + Lua clients); PRT = initial tournament implementation | `github.com/cartesi/dave` README | commit `34d84178e4f120877ea87f496de9225617315f3f`; tag `v2.1.1` (2026-03-10) | Verified |
| 23 | Dave/PRT one-of-N: "one correct validator can prevent an incorrect result" | `github.com/cartesi/dave` README | same as #22 | Verified |
| 24 | PRT tournament mechanism: computation-hash brackets, sparse->dense recursion, one-step proof, settlement scales as log^2(Sybils) | `docs.cartesi.io/fraud-proofs/prt/prt-introduction/` | fetched 2026-08-24 | Verified |
| 25 | Whitepaper's original verification game (2-player bisection) is vulnerable to crowd DoS; a crowd-resistant variant was "developed" (i.e., promised) | `cartesi.io/cartesi_whitepaper.pdf` §7, p.14 | v1.01 (2018) | Verified as a 2018 statement of intent; PRT/Dave (item 24) is the shipped realization — **inference**, not a primary source explicitly saying "PRT is that promised variant" |
| 26 | Whitepaper's "dispute delegation market" (proxy buys a dispute role for a fee+stake) | `cartesi.io/cartesi_whitepaper.pdf` §6.2, p.13 | v1.01 (2018) | Verified as a 2018 design; **current shipping status UNVERIFIED** — not found in docs.cartesi.io or dave/rollups-contracts repos surveyed here |
| 27 | Fraud-proof bonds: dishonest party's bond is slashed (partial or full) on a proven-wrong claim | `docs.cartesi.io/fraud-proofs/fraud-proof-basics/introduction/` | fetched 2026-08-24 | Verified |
| 28 | Honeypot = Stage-2 app-specific rollup, asymmetric-access ERC-20 vault, built to test PRT security in a real deployment | `docs.cartesi.io/fraud-proofs/honeypot/introduction/` | fetched 2026-08-24 | Verified — **not confirmed as a currently-live bounty with real funds**; Phase 4/8 should re-check live status before citing it as an active adversarial-proof program |
| 29 | governance.cartesi.io = Discourse forum with Grants/RFP/Technical Vision categories | `governance.cartesi.io` | fetched 2026-08-24 | Verified |
| 30 | CTSI staking: delegation-based pools, automatic reward compounding | `docs.cartesi.io/earn-ctsi/staking/` | page states "Last updated on May 7, 2024" | Verified as documented, but **the page is ~2.3 years stale relative to today (2026-08-24)** — treat current CTSI/Noether staking mechanics as `UNVERIFIED-CURRENT` pending a Phase-4-time re-check (this is the same item the plan's own Evidence note flagged; it remains open, now with a concrete staleness date attached) |
| 31 | Emulation slowdown factor vs. bare metal ("at least 50x") | not re-derived here — explicitly out of Phase 0 scope | — | **UNVERIFIED**, deliberately deferred to Phase 1 measurement per the plan's own Evidence note and Phase 1 worker_contract |
| 32 | llama.cpp (or any specific LLM-inference stack) runs inside a Cartesi Machine today | no primary source found stating this specifically | — | **UNVERIFIED** — inferred only from "general-purpose Linux/RISC-V machine," not confirmed by a named benchmark or example; Phase 1 is the actual test |

## 8. Open items carried forward

- **Phase 1 (determinism/perf spike):** must independently measure the emulation slowdown factor (#31) and should confirm llama.cpp actually boots and runs inside the machine (#32) before any architecture decision leans on it.
- **Phase 3 (verification/disputes):** re-fetch `docs.cartesi.io/fraud-proofs/references/daveconsensus/` and the `IConsensus` Solidity interface directly to nail down the Authority → Quorum → DaveConsensus migration mechanics (#14) — this primer found DaveConsensus's *role* but not the *migration procedure*.
- **Phase 2 (threat model):** the Coprocessor's trust model (#21 — EigenLayer operator-set attestation, not a dispute game) is a hard input to the two-lane design. Lane B ("attested-accelerated") should be modeled on the Coprocessor's actual mechanism (signature aggregation over an operator set with slashing), not on a hand-waved generic "attestation."
- **Phase 4 (tokenomics):** the CTSI staking page (#30) is stale (dated May 2024) relative to today; do not design the delegation-pool model against it without a fresh check of current staking mechanics (Noether or its successor) and the Honeypot's live-bounty status (#28).
- **Phase 6/8 (provider node / pilot):** the whitepaper's "dispute delegation market" (#26) is architecturally close to what a censorship-resistant scheduler fallback needs (a party that can defend a claim on your behalf for a fee) — worth a direct check of whether an equivalent exists in the current Dave/PRT tooling before designing a new one from scratch.
