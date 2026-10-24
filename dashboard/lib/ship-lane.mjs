/**
 * Ship lane signal for the Git e CI/CD section (ADR 2026-10-23
 * git-cicd-tab-read-in-mc-act-in-colony, points 2, 3, 6 and 7).
 *
 * Read-only. One `gh api graphql` call fetches the forge half (open PRs with
 * mergeable state and check rollups, the latest tag's CI jobs, GitHub Release
 * Latest, and, in the factory lane, the public repo's release and sync PRs);
 * one registry fetch reads the npm version. Local git facts (latest v* tag,
 * manifest version, staging vs main) are recomputed on every snapshot, so the
 * rows stay current while the network half is cached between snapshots the
 * way pipeline-cache.mjs does it for `gh run list`.
 *
 * Forge text (PR titles, branch names, check names) is untrusted input: it is
 * capped here and the panel renders it through textContent / escaping only.
 * Rows carry copy-only next commands (`kind: "copy"` in the panel); nothing in
 * this module runs a mutating command.
 */

import { truncateStr } from "./guards.mjs";

export const SHIP_LANE_CACHE_ENV = "AGENT_KIT_PREV_SHIP_LANE";
/**
 * Twice the pipeline TTL: ship state moves on human merges and tag CI jobs
 * (minutes), not on the few-second snapshot cadence, and one GraphQL call
 * per two minutes keeps the forge load flat while a release is watched.
 */
export const SHIP_LANE_CACHE_TTL_MS = 120_000;
/** Measured 2026-10-23 on this repo: about 1.2s for the full query. */
export const SHIP_LANE_GH_TIMEOUT_MS = 8_000;
export const SHIP_LANE_NPM_TIMEOUT_MS = 4_000;
/** Public storefront of the factory checkout (same constant as public-inbound-radar.ts). */
export const FACTORY_PUBLIC_REPO = "agent-kit-startup/agent-kit";

export const MAX_SHIP_LANE_PRS = 15;
const MAX_PR_TITLE_CHARS = 120;
const MAX_BRANCH_CHARS = 100;
const MAX_CHECK_NAME_CHARS = 60;
const MAX_FAILING_CHECKS = 8;
const MAX_TAG_JOBS = 12;
const MAX_SYNC_PRS = 5;
const MAX_REASON_CHARS = 80;

/** Signature scan check name (errors/2026-10-05_git-prod-signature-gate-merged-staging-commit.md). */
const SIGNATURE_SCAN_CHECK = "signature-scan";
const FAILING_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
]);
const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

/**
 * Provider and slug of a remote URL. Same host rule as remote-issues.ts
 * parseRemoteUrl: a gitlab host (or git.<domain>) is gitlab, anything else github.
 * @param {string | null | undefined} url
 * @returns {{ provider: "github" | "gitlab", host: string, owner: string, name: string, slug: string } | null}
 */
export function parseForgeRemote(url) {
  if (!url || typeof url !== "string") return null;
  const trimmed = url.trim();
  const m =
    trimmed.match(/^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/i) ||
    trimmed.match(/^(?:[^@/]+@)?([^/:]+):(.+?)(?:\.git)?\/?$/);
  if (!m) return null;
  const host = m[1].toLowerCase();
  const parts = m[2].split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const name = parts[parts.length - 1];
  const owner = parts.slice(0, -1).join("/");
  if (!/^[\w.-]+(?:\/[\w.-]+)*$/.test(owner) || !/^[\w.-]+$/.test(name)) return null;
  const provider = /gitlab|(^|\.)git\.[^.]+\./i.test(host) ? "gitlab" : "github";
  return { provider, host, owner, name, slug: `${owner}/${name}` };
}

/**
 * A v* tag name that is safe to put in a copyable shell command. Git allows
 * `;`, `$`, `|`, `&`, backticks and quotes in ref names, and tags arrive from
 * the remote, so anything outside this set is dropped rather than quoted
 * (security pass p4, 2026-10-23).
 * @param {unknown} name
 * @returns {string | null}
 */
export function safeTagName(name) {
  return typeof name === "string" && /^v[0-9A-Za-z][0-9A-Za-z._+-]{0,62}$/.test(name) ? name : null;
}

/** npm package name (lowercase, optional scope) safe for `npm view <name>`; else null. */
export function safeNpmName(name) {
  return typeof name === "string" &&
    name.length <= 214 &&
    /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)
    ? name
    : null;
}

/** Factory checkout: origin is the private agent-kit-dev repo (detectFactoryCheckout rule). */
export function isFactorySlug(slug) {
  return typeof slug === "string" && /agent-kit-dev$/i.test(slug);
}

export const SHIP_LANE_QUERY = `query($owner:String!,$name:String!,$tag:String!,$withPublic:Boolean!,$pubOwner:String!,$pubName:String!){
  repo: repository(owner:$owner,name:$name){
    pullRequests(states:OPEN,first:${MAX_SHIP_LANE_PRS},orderBy:{field:UPDATED_AT,direction:DESC}){
      totalCount
      nodes{ number title isDraft baseRefName headRefName mergeable mergeStateStatus
        commits(last:1){ nodes{ commit{ statusCheckRollup{ state contexts(first:40){ nodes{ __typename ... on CheckRun{ name status conclusion } ... on StatusContext{ context state } } } } } } } }
    }
    latestRelease{ tagName publishedAt }
    tag: ref(qualifiedName:$tag){ name target{ __typename ... on Commit{ ...suites } ... on Tag{ target{ ... on Commit{ ...suites } } } } }
  }
  pub: repository(owner:$pubOwner,name:$pubName) @include(if:$withPublic){
    latestRelease{ tagName publishedAt }
    pullRequests(states:[OPEN,MERGED],last:${MAX_SYNC_PRS}){ nodes{ number title state mergedAt } }
  }
}
fragment suites on Commit{ checkSuites(first:12){ nodes{ workflowRun{ databaseId event workflow{ name } } checkRuns(first:20){ nodes{ name status conclusion } } } } }`;

/**
 * argv for `gh` (no shell; values are validated slugs and a v* tag name).
 * @param {{ owner: string, name: string, tag: string | null, publicRepo: string | null }} p
 */
export function shipLaneGhArgs({ owner, name, tag, publicRepo }) {
  const [pubOwner, pubName] = publicRepo ? publicRepo.split("/") : ["_", "_"];
  return [
    "api",
    "graphql",
    "-f",
    `query=${SHIP_LANE_QUERY}`,
    "-F",
    `owner=${owner}`,
    "-F",
    `name=${name}`,
    "-F",
    `tag=refs/tags/${tag || "__no_tag__"}`,
    "-F",
    `withPublic=${publicRepo ? "true" : "false"}`,
    "-F",
    `pubOwner=${pubOwner}`,
    "-F",
    `pubName=${pubName}`,
  ];
}

const lower = (v) => (typeof v === "string" && v ? v.toLowerCase() : null);
const capText = (v, n) => truncateStr(String(v ?? ""), n);

/** One check context (CheckRun or StatusContext) as {name, state: success|failure|pending}. */
function contextState(node) {
  if (!node || typeof node !== "object") return null;
  if (node.__typename === "StatusContext") {
    const st = lower(node.state);
    return {
      name: capText(node.context, MAX_CHECK_NAME_CHARS),
      state:
        st === "success"
          ? "success"
          : st === "pending" || st === "expected"
            ? "pending"
            : "failure",
    };
  }
  const status = lower(node.status);
  const conclusion = lower(node.conclusion);
  let state = "pending";
  if (status === "completed") {
    if (FAILING_CONCLUSIONS.has(conclusion)) state = "failure";
    else if (conclusion === "skipped") state = "skipped";
    else if (PASSING_CONCLUSIONS.has(conclusion)) state = "success";
    else state = "failure";
  }
  return { name: capText(node.name, MAX_CHECK_NAME_CHARS), state };
}

function trimPr(node) {
  const rollup = node?.commits?.nodes?.[0]?.commit?.statusCheckRollup ?? null;
  const contexts = (rollup?.contexts?.nodes ?? []).map(contextState).filter(Boolean);
  const failing = contexts.filter((c) => c.state === "failure").map((c) => c.name);
  const sig = contexts.find((c) => c.name === SIGNATURE_SCAN_CHECK);
  return {
    number: Number(node?.number) || 0,
    title: capText(node?.title, MAX_PR_TITLE_CHARS),
    base: capText(node?.baseRefName, MAX_BRANCH_CHARS),
    head: capText(node?.headRefName, MAX_BRANCH_CHARS),
    draft: node?.isDraft === true,
    mergeable: lower(node?.mergeable),
    mergeState: lower(node?.mergeStateStatus),
    stackedOn: null,
    checks: {
      state: lower(rollup?.state),
      total: contexts.length,
      failing: failing.slice(0, MAX_FAILING_CHECKS),
      pending: contexts.filter((c) => c.state === "pending").length,
      signatureScan: sig ? sig.state : "missing",
    },
  };
}

/** The tag's own CI run: among push-event suites, the one with the most non-skipped jobs. */
function trimTagCi(tagRef) {
  const commit = tagRef?.target?.__typename === "Tag" ? tagRef.target.target : tagRef?.target;
  const suites = commit?.checkSuites?.nodes ?? [];
  let best = null;
  let bestScore = -1;
  for (const suite of suites) {
    if (lower(suite?.workflowRun?.event) !== "push") continue;
    const jobs = (suite.checkRuns?.nodes ?? []).map(contextState).filter(Boolean);
    const score = jobs.filter((j) => j.state !== "skipped").length;
    if (jobs.length && score >= bestScore) {
      best = { suite, jobs };
      bestScore = score;
    }
  }
  if (!best) return null;
  const runId = Number(best.suite.workflowRun?.databaseId);
  return {
    workflow: capText(best.suite.workflowRun?.workflow?.name, MAX_CHECK_NAME_CHARS),
    runId: Number.isSafeInteger(runId) && runId > 0 ? runId : null,
    jobs: best.jobs.slice(0, MAX_TAG_JOBS),
  };
}

function trimRelease(release) {
  if (!release || typeof release.tagName !== "string") return null;
  return {
    tag: capText(release.tagName, 64),
    publishedAt: typeof release.publishedAt === "string" ? release.publishedAt : null,
  };
}

/**
 * Trimmed, capped forge half from the GraphQL response (untrusted input).
 * @param {unknown} json parsed `gh api graphql` stdout
 * @param {{ repo: string, tag: string | null, publicRepo: string | null, fetchedAt: string }} meta
 */
export function trimShipLaneGraphql(json, { repo: repoSlug, tag, publicRepo, fetchedAt }) {
  const data = json && typeof json === "object" ? json.data : null;
  const repo = data?.repo;
  if (!repo || typeof repo !== "object") return null;
  const prs = (repo.pullRequests?.nodes ?? []).slice(0, MAX_SHIP_LANE_PRS).map(trimPr);
  const byHead = new Map(prs.map((p) => [p.head, p.number]));
  for (const pr of prs) pr.stackedOn = byHead.get(pr.base) ?? null;
  const pub = data?.pub;
  return {
    available: true,
    fetchedAt,
    repo: repoSlug,
    tag: tag || null,
    publicRepo: publicRepo || null,
    prs,
    prsTotal: Number(repo.pullRequests?.totalCount) || prs.length,
    originRelease: trimRelease(repo.latestRelease),
    tagCi: tag ? trimTagCi(repo.tag) : null,
    public:
      publicRepo && pub
        ? {
            release: trimRelease(pub.latestRelease),
            syncPrs: (pub.pullRequests?.nodes ?? []).slice(-MAX_SYNC_PRS).map((p) => ({
              number: Number(p?.number) || 0,
              title: capText(p?.title, MAX_PR_TITLE_CHARS),
              state: lower(p?.state),
              mergedAt: typeof p?.mergedAt === "string" ? p.mergedAt : null,
            })),
          }
        : null,
    npm: null,
  };
}

/**
 * Reason for a failed `gh` attempt, from the execFile error shape.
 * @param {any} err
 * @param {string} [stderr]
 */
export function classifyGhFailure(err, stderr = "") {
  if (err?.code === "ENOENT") return "gh-missing";
  if (err?.killed || err?.signal === "SIGTERM") return "timeout";
  if (/auth login|not logged in|authenticat/i.test(String(stderr))) return "gh-auth";
  return "call-failed";
}

/** Human note for an unavailable forge half (the remote issues lane wording). */
export function shipLaneReasonNote(reason) {
  const notes = {
    budget: "skipped: snapshot budget ran out before gh was attempted",
    "gh-missing": "skipped: gh not installed",
    "gh-auth": "skipped: gh not authenticated",
    timeout: "skipped: gh timed out",
    "call-failed": "skipped: gh call failed (offline or no access)",
    "no-remote": "skipped: no origin remote",
    "provider-unsupported": "skipped: glab support comes later (git provider is gitlab)",
  };
  return notes[reason] ?? `skipped: ${capText(reason, MAX_REASON_CHARS)}`;
}

function isCacheableRemote(remote) {
  return (
    !!remote &&
    typeof remote === "object" &&
    !Array.isArray(remote) &&
    typeof remote.available === "boolean" &&
    typeof remote.fetchedAt === "string" &&
    Number.isFinite(Date.parse(remote.fetchedAt))
  );
}

/**
 * Cached forge half from the env blob when younger than `ttlMs` and fetched
 * for the same repo and tag; else null (a new tag invalidates it at once).
 * @param {string | undefined} raw
 * @param {number} nowMs
 * @param {{ repo: string | null, tag: string | null }} key
 * @param {number} [ttlMs]
 */
export function readCachedShipLaneRemote(raw, nowMs, key, ttlMs = SHIP_LANE_CACHE_TTL_MS) {
  if (!raw || typeof raw !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isCacheableRemote(parsed)) return null;
  if ((parsed.repo ?? null) !== (key.repo ?? null)) return null;
  if (parsed.available && (parsed.tag ?? null) !== (key.tag ?? null)) return null;
  const age = nowMs - Date.parse(parsed.fetchedAt);
  return age >= 0 && age < ttlMs ? parsed : null;
}

/** Env blob for the next snapshot, or null to keep the prior one. */
export function shipLaneCacheJsonFromSnapshot(snapshot) {
  const remote = snapshot?.shipLane?.remote;
  return isCacheableRemote(remote) ? JSON.stringify(remote) : null;
}

const cmd = (text, destination = "terminal") => ({ text, destination });

function prCheckState(pr) {
  if (pr.checks.failing.length || pr.mergeable === "conflicting") return "red";
  return "pending";
}

function prDetail(pr) {
  const bits = [`#${pr.number} ${pr.head} → ${pr.base}`];
  if (pr.checks.failing.length) bits.push(`failing: ${pr.checks.failing.join(", ")}`);
  else if (pr.checks.pending) bits.push(`${pr.checks.pending} check(s) running`);
  if (pr.mergeable === "conflicting") bits.push("conflicts");
  else if (pr.mergeState) bits.push(pr.mergeState);
  return bits.join(" · ");
}

/**
 * The /kit-prod §5 Done rows (or the generic /git-prod subset in a consumer
 * repo), each green / red / pending / unknown with one copyable next command.
 * @param {{ lane: "factory" | "consumer", repo: string | null, publicRepo: string | null,
 *   local: { latestTag: string | null, version: string | null, mainRef: string | null,
 *     stagingAheadOfMain: number | null, mainInStaging: boolean | null, tagOnMain: boolean | null },
 *   remote: any }} input
 */
export function buildShipLaneRows({ lane, repo, publicRepo, local, remote }) {
  const slash = lane === "factory" ? "/kit-prod" : "/git-prod";
  const tag = local.latestTag;
  const tagVersion = tag ? tag.replace(/^v/, "") : null;
  const forgeUp = remote?.available === true;
  const forgeNote = forgeUp ? null : shipLaneReasonNote(remote?.reason ?? "call-failed");
  const prs = forgeUp ? remote.prs : [];
  const mainBase = local.mainRef ? local.mainRef.replace(/^origin\//, "") : "main";
  const rows = [];

  // 1. Release close (manifests bumped, close PR into staging).
  const closePr = prs.find((p) => /close-release/i.test(p.head));
  if (closePr) {
    rows.push({
      id: "release-close",
      label: "Release close",
      state: prCheckState(closePr),
      detail: prDetail(closePr),
      next: cmd(`gh pr checks ${closePr.number}`),
    });
  } else if (!local.version) {
    rows.push({
      id: "release-close",
      label: "Release close",
      state: "unknown",
      detail: "no manifest version",
      next: null,
    });
  } else if (tagVersion !== local.version) {
    rows.push({
      id: "release-close",
      label: "Release close",
      state: "green",
      detail: `v${local.version} closed`,
      next: null,
    });
  } else if ((local.stagingAheadOfMain ?? 0) > 0) {
    rows.push({
      id: "release-close",
      label: "Release close",
      state: "pending",
      detail: `staging is ${local.stagingAheadOfMain} commit(s) ahead of ${mainBase}; next release not closed`,
      next: cmd(slash, "agent chat input"),
    });
  } else {
    rows.push({
      id: "release-close",
      label: "Release close",
      state: "green",
      detail: `v${local.version} shipped; nothing to close`,
      next: null,
    });
  }

  // 2. Staging -> main PR.
  const promotePr = prs.find(
    (p) => p.head === "staging" && (p.base === "main" || p.base === "master"),
  );
  if (promotePr) {
    rows.push({
      id: "staging-main",
      label: `Staging → ${promotePr.base}`,
      state: prCheckState(promotePr),
      detail: prDetail(promotePr),
      next: cmd(`gh pr checks ${promotePr.number}`),
    });
  } else if (local.stagingAheadOfMain == null) {
    rows.push({
      id: "staging-main",
      label: `Staging → ${mainBase}`,
      state: "unknown",
      detail: "no origin/staging or origin/main ref",
      next: null,
    });
  } else if (local.stagingAheadOfMain > 0) {
    rows.push({
      id: "staging-main",
      label: `Staging → ${mainBase}`,
      state: "pending",
      detail: `staging ${local.stagingAheadOfMain} ahead, no open PR${forgeNote ? ` (${forgeNote})` : ""}`,
      next: cmd(slash, "agent chat input"),
    });
  } else {
    rows.push({
      id: "staging-main",
      label: `Staging → ${mainBase}`,
      state: "green",
      detail: `${mainBase} has everything on staging`,
      next: null,
    });
  }

  // 3. Tag.
  if (!tag && local.unsafeTag) {
    rows.push({
      id: "tag",
      label: "Tag",
      state: "unknown",
      detail: "latest v* tag has characters outside [A-Za-z0-9._+-]; not shown or copied",
      next: null,
    });
  } else if (!tag) {
    rows.push({ id: "tag", label: "Tag", state: "unknown", detail: "no v* tag", next: null });
  } else if (local.version && tagVersion !== local.version) {
    rows.push({
      id: "tag",
      label: "Tag",
      state: "pending",
      detail: `v${local.version} not tagged (latest ${tag})`,
      next: cmd(slash, "agent chat input"),
    });
  } else if (local.tagOnMain === false) {
    rows.push({
      id: "tag",
      label: "Tag",
      state: "pending",
      detail: `${tag} not on ${local.mainRef || "origin/main"}`,
      next: cmd("git fetch origin --tags"),
    });
  } else {
    rows.push({
      id: "tag",
      label: "Tag",
      state: "green",
      detail: `${tag} on ${local.mainRef || "origin/main"}`,
      next: null,
    });
  }

  // 4. Tag CI jobs.
  if (!tag) {
    rows.push({ id: "tag-ci", label: "Tag CI", state: "unknown", detail: "no v* tag", next: null });
  } else if (!forgeUp) {
    rows.push({
      id: "tag-ci",
      label: "Tag CI",
      state: "unknown",
      detail: forgeNote,
      next: cmd(`gh run list --branch ${tag}`),
    });
  } else if (!remote.tagCi) {
    rows.push({
      id: "tag-ci",
      label: "Tag CI",
      state: "pending",
      detail: `no CI run found for ${tag}`,
      next: cmd(`gh run list --branch ${tag}`),
    });
  } else {
    const { jobs, runId } = remote.tagCi;
    const failed = jobs.filter((j) => j.state === "failure").map((j) => j.name);
    const running = jobs.filter((j) => j.state === "pending").map((j) => j.name);
    const list = jobs
      .filter((j) => j.state !== "skipped")
      .map((j) => j.name)
      .join(", ");
    if (failed.length) {
      rows.push({
        id: "tag-ci",
        label: "Tag CI",
        state: "red",
        detail: `${tag}: ${failed.join(", ")} failed`,
        next: cmd(runId ? `gh run rerun ${runId} --failed` : `gh run list --branch ${tag}`),
      });
    } else if (running.length) {
      rows.push({
        id: "tag-ci",
        label: "Tag CI",
        state: "pending",
        detail: `${tag}: ${running.join(", ")} running`,
        next: cmd(runId ? `gh run watch ${runId}` : `gh run list --branch ${tag}`),
      });
    } else {
      rows.push({
        id: "tag-ci",
        label: "Tag CI",
        state: "green",
        detail: `${tag}: ${list || "all jobs"} green`,
        next: null,
      });
    }
  }

  // 5. Staging fast-forward sync (main is an ancestor of staging).
  if (local.mainInStaging == null) {
    rows.push({
      id: "staging-sync",
      label: "Staging sync",
      state: "unknown",
      detail: "no origin/staging or origin/main ref",
      next: null,
    });
  } else if (local.mainInStaging) {
    rows.push({
      id: "staging-sync",
      label: "Staging sync",
      state: "green",
      detail: `${mainBase} is an ancestor of staging`,
      next: null,
    });
  } else {
    rows.push({
      id: "staging-sync",
      label: "Staging sync",
      state: "red",
      detail: `${mainBase} has commits staging lacks`,
      next: cmd(`git log --oneline origin/staging..${local.mainRef || "origin/main"}`),
    });
  }

  // 6. npm.
  const npm = forgeUp ? remote.npm : null;
  if (npm?.name) {
    if (!npm.version) {
      rows.push({
        id: "npm",
        label: "npm",
        state: "unknown",
        detail: `${npm.name}: registry not reachable`,
        next: cmd(`npm view ${npm.name} version`),
      });
    } else if (tagVersion && npm.version === tagVersion) {
      rows.push({
        id: "npm",
        label: "npm",
        state: "green",
        detail: `${npm.name}@${npm.version}`,
        next: null,
      });
    } else {
      rows.push({
        id: "npm",
        label: "npm",
        state: "pending",
        detail: `${npm.name}@${npm.version}, expected ${tagVersion ?? "a tag"}`,
        next: cmd(`npm view ${npm.name} version`),
      });
    }
  }

  // 7-8. Public sync PR and public Release Latest (factory lane).
  if (publicRepo) {
    const pub = forgeUp ? remote.public : null;
    if (!pub) {
      const detail = forgeNote ?? "public repo not readable";
      rows.push({
        id: "public-sync",
        label: "Public sync PR",
        state: "unknown",
        detail,
        next: cmd(`gh pr list -R ${publicRepo} --state all --limit 5`),
      });
      rows.push({
        id: "public-release",
        label: "Public Release Latest",
        state: "unknown",
        detail,
        next: cmd(`gh release list -R ${publicRepo} --limit 3`),
      });
    } else {
      const sync = tag ? [...pub.syncPrs].reverse().find((p) => p.title.includes(tag)) : null;
      if (sync?.state === "merged") {
        rows.push({
          id: "public-sync",
          label: "Public sync PR",
          state: "green",
          detail: `#${sync.number} merged`,
          next: null,
        });
      } else if (sync) {
        rows.push({
          id: "public-sync",
          label: "Public sync PR",
          state: "pending",
          detail: `#${sync.number} ${sync.state ?? "open"}`,
          next: cmd(`gh pr view ${sync.number} -R ${publicRepo}`),
        });
      } else {
        rows.push({
          id: "public-sync",
          label: "Public sync PR",
          state: "pending",
          detail: `no sync PR for ${tag ?? "the latest tag"}`,
          next: cmd(`gh pr list -R ${publicRepo} --state all --limit 5`),
        });
      }
      const rel = pub.release?.tag ?? null;
      rows.push(
        rel && rel === tag
          ? {
              id: "public-release",
              label: "Public Release Latest",
              state: "green",
              detail: `${rel} is Latest`,
              next: null,
            }
          : {
              id: "public-release",
              label: "Public Release Latest",
              state: "pending",
              detail: rel ? `Latest is ${rel}, expected ${tag ?? "a tag"}` : "no public release",
              next: cmd(`gh release list -R ${publicRepo} --limit 3`),
            },
      );
    }
  }

  // GitHub Release Latest on origin, when the repo publishes releases there.
  const originRelease = forgeUp ? remote.originRelease : null;
  if (originRelease) {
    rows.push(
      originRelease.tag === tag
        ? {
            id: "origin-release",
            label: "Release Latest",
            state: "green",
            detail: `${originRelease.tag} is Latest`,
            next: null,
          }
        : {
            id: "origin-release",
            label: "Release Latest",
            state: "pending",
            detail: `Latest is ${originRelease.tag}, expected ${tag ?? "a tag"}`,
            next: cmd(`gh release list${repo ? ` -R ${repo}` : ""} --limit 3`),
          },
    );
  }
  return rows;
}
