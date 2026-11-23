import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = join(repoRoot, ".cursor/scripts/plan-external-review.sh");
const SRC = readFileSync(SCRIPT, "utf8");

function extractFn(name) {
  const out = spawnSync("sed", ["-n", `/^${name}() {/,/^}$/p`, SCRIPT], { encoding: "utf8" });
  assert.ok(out.stdout.includes(`${name}()`), `failed to extract ${name}`);
  return out.stdout;
}

function runBash(body) {
  const fns = [
    "normalize_model_id",
    "normalize_model_family",
    "models_same_family",
    "model_is_family_alias",
    "review_model_relation",
    "effective_reviewer_model",
  ]
    .map(extractFn)
    .join("\n");
  const bash = `
set -euo pipefail
REVIEWER_BACKEND="\${REVIEWER_BACKEND:-claude}"
REVIEWER_MODEL="\${REVIEWER_MODEL:-sonnet}"
${fns}
${body}
`;
  return spawnSync("bash", ["-c", bash], { encoding: "utf8" });
}

function extractVarAssignment(name) {
  const out = spawnSync("grep", ["-m1", `^${name}=`, SCRIPT], { encoding: "utf8" });
  assert.ok(out.stdout.trim().length > 0, `failed to extract ${name}`);
  return out.stdout;
}

// Runs the real monitor_wants_advisor() from the script (plus its
// ADVISOR_ESCALATE_SENTINEL constant) against a scratch file, mirroring how
// maybe_run_advisor() gates the opus escalation.
function monitorWantsAdvisor(root, rel) {
  const prelude = [
    extractVarAssignment("ADVISOR_ESCALATE_SENTINEL"),
    extractFn("monitor_wants_advisor"),
  ].join("\n");
  const bash = `
set -euo pipefail
ROOT=${JSON.stringify(root)}
${prelude}
if monitor_wants_advisor ${JSON.stringify(rel)}; then echo yes; else echo no; fi
`;
  const out = spawnSync("bash", ["-c", bash], { encoding: "utf8" });
  assert.equal(out.status, 0, out.stderr);
  return out.stdout.trim();
}

// Historical default at f27910a was Haiku; classifier-capable Sonnet is the post-amendment default.
test("launcher model routing: classifier-capable reviewer spawn, escalate sentinel, same-model refuse", () => {
  assert.match(SRC, /--reviewer-model/);
  assert.match(SRC, /--advisor-model/);
  assert.match(SRC, /--implementer-model/);
  assert.match(SRC, /AGENT_KIT_AUDIT_IMPLEMENTER_MODEL/);
  assert.match(SRC, /--model "\$\{WAIT_REVIEWER_MODEL:-sonnet\}"/);
  assert.match(SRC, /<!-- audits-advisor-escalate -->/);
  assert.match(SRC, /maybe_run_advisor/);
  assert.match(SRC, /enforce_implementer_reviewer_split/);
  assert.match(SRC, /findings-contract against the git delta/);
  assert.match(SRC, /This is not a silent self-review/);
});

test("monitor_wants_advisor: anchored to a standalone sentinel line, ignores prose/negated mentions", () => {
  const dir = mkdtempSync(join(tmpdir(), "audits-advisor-sentinel-"));
  try {
    const proseFile = "prose-negated.md";
    writeFileSync(
      join(dir, proseFile),
      [
        "**To-do:** Opus advisor only when monitor marks `<!-- audits-advisor-escalate -->`.",
        "Neither finding is high/critical severity; no `<!-- audits-advisor-escalate -->` needed.",
      ].join("\n"),
    );
    assert.equal(
      monitorWantsAdvisor(dir, proseFile),
      "no",
      "inline/negated prose mention of the sentinel must not trigger escalation",
    );

    const genuineFile = "genuine-escalate.md";
    writeFileSync(
      join(dir, genuineFile),
      ["## Advisor", "", "<!-- audits-advisor-escalate -->", ""].join("\n"),
    );
    assert.equal(
      monitorWantsAdvisor(dir, genuineFile),
      "yes",
      "a genuine standalone sentinel comment line must trigger escalation",
    );

    const indentedFile = "genuine-indented.md";
    writeFileSync(join(dir, indentedFile), "text\n   <!-- audits-advisor-escalate -->   \nmore\n");
    assert.equal(
      monitorWantsAdvisor(dir, indentedFile),
      "yes",
      "surrounding whitespace on an otherwise-standalone sentinel line must still trigger escalation",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("normalize_model_family collapses vendor aliases", () => {
  const out = runBash(`
echo "$(normalize_model_family "")"
echo "$(normalize_model_family Auto)"
echo "$(normalize_model_family haiku)"
echo "$(normalize_model_family claude-haiku-4-5-20251001)"
echo "$(normalize_model_family claude-3-5-haiku-latest)"
echo "$(normalize_model_family opus)"
echo "$(normalize_model_family claude-opus-4-20250514)"
echo "$(normalize_model_family composer-2.5-fast)"
`);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    out.stdout.trim(),
    ["auto", "auto", "haiku", "haiku", "haiku", "opus", "opus", "composer"].join("\n"),
  );
});

test("models_same_family refuses Auto/Auto and Haiku/Haiku, allows Auto/Haiku", () => {
  const out = runBash(`
models_same_family auto Auto && echo auto-auto || echo auto-auto-no
models_same_family haiku claude-haiku-4-5 && echo haiku-haiku || echo haiku-haiku-no
models_same_family auto haiku && echo auto-haiku || echo auto-haiku-no
models_same_family sonnet opus && echo sonnet-opus || echo sonnet-opus-no
`);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(
    out.stdout.trim(),
    ["auto-auto", "haiku-haiku", "auto-haiku-no", "sonnet-opus-no"].join("\n"),
  );
});

// ADR 2026-11-16_reviewer-same-family-rule: block only the identical model, warn on the
// same family. The same table runs against the CLI rule in model-roles.test.ts.
test("review_model_relation: identical refused, same family warns, different runs", () => {
  const cases = [
    ["auto", "auto", "identical"],
    ["", "Auto", "identical"],
    ["cursor-auto", "default", "identical"],
    ["opus", "opus", "identical"],
    ["Claude-Opus-5-5", "claude-opus-5-5", "identical"],
    ["opus", "claude-opus-5-5", "identical"],
    ["claude-opus-5-5", "claude-opus", "identical"],
    ["fable", "claude-fable-5-2", "identical"],
    ["composer", "composer-2.5-fast", "identical"],
    ["opus[1m]", "opus", "identical"],
    ["claude-opus-4-7[1m]", "claude-opus-4-7", "identical"],
    ["gpt-5", "gpt-5", "identical"],
    ["claude-opus-5-5", "claude-opus-4-8", "same-family"],
    ["claude-opus-4-7", "claude-opus-4-7-20260101", "same-family"],
    ["claude-fable-5-2", "claude-fable-5-1", "same-family"],
    ["opus", "sonnet", "different"],
    ["claude-opus-5-5", "fable", "different"],
    ["claude-opus-5-5", "claude-fable-5-2", "different"],
    ["auto", "sonnet", "different"],
    ["gpt-5", "gpt-5.1", "different"],
  ];
  const body = cases
    .map(([a, b]) => `echo "$(review_model_relation ${JSON.stringify(a)} ${JSON.stringify(b)})"`)
    .join("\n");
  const out = runBash(body);
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(
    out.stdout.trim().split("\n"),
    cases.map((c) => c[2]),
  );
  // The rule is symmetric.
  const flipped = runBash(
    cases
      .map(([a, b]) => `echo "$(review_model_relation ${JSON.stringify(b)} ${JSON.stringify(a)})"`)
      .join("\n"),
  );
  assert.deepEqual(
    flipped.stdout.trim().split("\n"),
    cases.map((c) => c[2]),
  );
});

test("normalize_model_family knows fable and folds a bracket parameter", () => {
  const out = runBash(`
echo "$(normalize_model_family fable)"
echo "$(normalize_model_family claude-fable-5-2)"
echo "$(normalize_model_family 'opus[1m]')"
echo "$(normalize_model_family sonnet-4.5)"
`);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), ["fable", "fable", "opus", "sonnet-4.5"].join("\n"));

  const cursorFable = runBash(`
REVIEWER_BACKEND=cursor
REVIEWER_MODEL=fable
echo "$(effective_reviewer_model)"
`);
  assert.equal(cursorFable.stdout.trim(), "auto");
});

// Runs a copy of the launcher inside a scratch workspace so ROOT and config are the fixture's.
function launcherFixture(config) {
  const root = mkdtempSync(join(tmpdir(), "audits-roles-reviewer-"));
  mkdirSync(join(root, ".cursor", "scripts"), { recursive: true });
  mkdirSync(join(root, ".cursor", "context", "templates"), { recursive: true });
  mkdirSync(join(root, ".cursor", "plans"), { recursive: true });
  copyFileSync(SCRIPT, join(root, ".cursor", "scripts", "plan-external-review.sh"));
  writeFileSync(
    join(root, ".cursor", "context", "templates", "plan-external-review-prompt.md"),
    "# prompt\n",
  );
  writeFileSync(join(root, ".cursor", "context", "templates", "plan-monitor.md"), "# monitor\n");
  writeFileSync(
    join(root, ".cursor", "plans", "fixture.plan.md"),
    "---\nname: Fixture\ntodos:\n  - id: one\n    status: completed\n---\n",
  );
  writeFileSync(join(root, ".cursor", "HANDOFF.md"), "# Handoff\n\n- **Plan:** fixture.plan.md\n");
  if (config !== undefined) {
    writeFileSync(join(root, ".cursor", "context", "config.json"), JSON.stringify(config));
  }
  const run = (args, env = {}) =>
    spawnSync("bash", [join(root, ".cursor", "scripts", "plan-external-review.sh"), ...args], {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, AGENT_KIT_AUDIT_IMPLEMENTER_MODEL: "", ...env },
    });
  return { root, run, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("roles.reviewer switch: off and scope tick win over externalPlanReview.enabled", () => {
  for (const [reviewer, tip] of [
    [{ enabled: false }, /the reviewer role is off/],
    [{ enabled: true, scope: "off" }, /the reviewer role is off/],
    [{ enabled: true, scope: "tick" }, /roles\.reviewer\.scope is "tick"/],
  ]) {
    const fx = launcherFixture({ externalPlanReview: { enabled: true }, roles: { reviewer } });
    try {
      const out = fx.run(["--dry-run", "fixture.plan.md"]);
      assert.equal(out.status, 0, out.stderr);
      assert.match(out.stdout, tip);
      assert.doesNotMatch(out.stdout, /prepared/);
    } finally {
      fx.done();
    }
  }
});

test("scope tick without an enabled review prints the opt-in tip, not the per-tick one", () => {
  const fx = launcherFixture({ roles: { reviewer: { scope: "tick" } } });
  try {
    const out = fx.run(["--dry-run", "fixture.plan.md"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /audits \(external plan review\) are opt-in and currently disabled/);
    assert.doesNotMatch(out.stdout, /reviews run after each headless tick/);
  } finally {
    fx.done();
  }
});

test("roles.reviewer enabled true arms without externalPlanReview.enabled; no roles keeps the old tip", () => {
  const on = launcherFixture({ roles: { reviewer: { enabled: true, scope: "plan" } } });
  try {
    const out = on.run(["--paste-only", "--dry-run", "fixture.plan.md"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /audits \/ external plan review: prepared/);
  } finally {
    on.done();
  }
  const legacy = launcherFixture({ externalPlanReview: { enabled: false } });
  try {
    const out = legacy.run(["--dry-run", "fixture.plan.md"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /audits \(external plan review\) are opt-in and currently disabled/);
  } finally {
    legacy.done();
  }
});

test("reviewer and implementer models come from roles; identical refused, same family warns", () => {
  const dry = (config, args = [], env = {}) => {
    const fx = launcherFixture(config);
    try {
      return fx.run(["--force", "--paste-only", "--dry-run", ...args, "fixture.plan.md"], env);
    } finally {
      fx.done();
    }
  };
  // Opus implements, Fable reviews, one subscription: runs, no warning.
  const fable = dry({
    roles: {
      worker: { backend: "claude", model: "claude-opus-5-5" },
      reviewer: { enabled: true, backend: "claude", model: "fable", advisorModel: "sonnet" },
    },
    externalPlanReview: { reviewerModel: "haiku", advisorModel: "opus" },
  });
  assert.equal(fable.status, 0, fable.stderr);
  assert.match(fable.stdout, /reviewer-model: fable/);
  assert.match(fable.stdout, /implementer-model: claude-opus-5-5/);
  assert.match(fable.stdout, /advisor-model: sonnet/);
  assert.match(fable.stdout, /same-model-refuse: no/);
  assert.match(fable.stdout, /same-family-warn: no/);

  // Two different ids of one family: runs with one warning line.
  const family = dry({
    roles: { worker: { model: "claude-opus-5-5" }, reviewer: { model: "claude-opus-4-8" } },
  });
  assert.match(family.stdout, /same-model-refuse: no/);
  assert.match(family.stdout, /same-family-warn: yes/);
  assert.equal(
    family.stdout.match(/^warning: reviewer claude-opus-4-8 and implementer/gm)?.length,
    1,
  );

  // Alias against an id of its family: identical, refused.
  const alias = dry({
    roles: { worker: { model: "claude-opus-5-5" }, reviewer: { model: "opus" } },
  });
  assert.match(alias.stdout, /same-model-refuse: yes/);
  assert.match(alias.stdout, /This is not a silent self-review/);

  // Legacy keys still work when roles has no reviewer model.
  const legacy = dry({ externalPlanReview: { reviewerModel: "haiku" } });
  assert.match(legacy.stdout, /reviewer-model: haiku/);
  assert.match(legacy.stdout, /implementer-model: auto/);

  // --implementer-model beats roles.worker.model; the env stamp is the fallback below it.
  const flag = dry({ roles: { worker: { model: "claude-opus-5-5" } } }, [
    "--implementer-model",
    "gpt-5",
  ]);
  assert.match(flag.stdout, /implementer-model: gpt-5/);
  const env = dry({}, [], { AGENT_KIT_AUDIT_IMPLEMENTER_MODEL: "composer-2.5-fast" });
  assert.match(env.stdout, /implementer-model: composer-2\.5-fast/);
});

test("roles.reviewer.backend is read before externalPlanReview.backend", () => {
  const fx = launcherFixture({
    roles: { reviewer: { backend: "cursor-agent" } },
    externalPlanReview: { backend: "claude" },
  });
  try {
    const out = spawnSync(
      "bash",
      [
        "-c",
        `CONFIG=${JSON.stringify(join(fx.root, ".cursor/context/config.json"))}\n${extractFn("config_review_backend")}\nconfig_review_backend`,
      ],
      { encoding: "utf8" },
    );
    assert.equal(out.status, 0, out.stderr);
    assert.equal(out.stdout.trim(), "cursor");
  } finally {
    fx.done();
  }
});

test("effective_reviewer_model: Claude default is sonnet; explicit haiku kept; Cursor Claude-family collapses to auto", () => {
  const claudeDefault = runBash(`
REVIEWER_BACKEND=claude
unset REVIEWER_MODEL
echo "$(effective_reviewer_model)"
`);
  assert.equal(claudeDefault.status, 0, claudeDefault.stderr);
  assert.equal(claudeDefault.stdout.trim(), "sonnet");

  const claudeHaiku = runBash(`
REVIEWER_BACKEND=claude
REVIEWER_MODEL=haiku
echo "$(effective_reviewer_model)"
`);
  assert.equal(claudeHaiku.status, 0, claudeHaiku.stderr);
  assert.equal(claudeHaiku.stdout.trim(), "haiku");

  const cursorHaiku = runBash(`
REVIEWER_BACKEND=cursor
REVIEWER_MODEL=haiku
echo "$(effective_reviewer_model)"
`);
  assert.equal(cursorHaiku.status, 0, cursorHaiku.stderr);
  assert.equal(cursorHaiku.stdout.trim(), "auto");

  const cursorNamed = runBash(`
REVIEWER_BACKEND=cursor
REVIEWER_MODEL=composer-2.5-fast
echo "$(effective_reviewer_model)"
`);
  assert.equal(cursorNamed.status, 0, cursorNamed.stderr);
  assert.equal(cursorNamed.stdout.trim(), "composer-2.5-fast");
});

test("launcher --prompt-file overrides TEMPLATE_REL; default remains the findings template", () => {
  assert.match(
    SRC,
    /DEFAULT_TEMPLATE_REL="\.cursor\/context\/templates\/plan-external-review-prompt\.md"/,
  );
  assert.match(SRC, /TEMPLATE_REL="\$DEFAULT_TEMPLATE_REL"/);
  assert.match(SRC, /--prompt-file requires PATH/);
  assert.match(SRC, /INTERACTIVE_FLAGS\+=\(--prompt-file "\$TEMPLATE_REL"\)/);
  assert.match(SRC, /echo " {2}prompt-file: \$TEMPLATE_REL"/);
  const findings = join(repoRoot, ".cursor/context/templates/plan-external-review-prompt.md");
  assert.equal(existsSync(findings), true, "do not replace the L0 findings template in place");
  assert.match(readFileSync(findings, "utf8"), /post-hoc evidence-based monitoring/);

  const missingArg = spawnSync("bash", [SCRIPT, "--force", "--prompt-file"], { encoding: "utf8" });
  assert.equal(missingArg.status, 2);
  assert.match(missingArg.stderr, /--prompt-file requires PATH/);
});

const COPY_PLAN = "docs-usage-first-anti-slop-revamp.plan.md";
const COPY_PROMPT = ".cursor/context/templates/plan-fable-copy-prompt.md";

test("dry-run prints default prompt-file; override forwards --prompt-file on paste-cmd", {
  skip:
    !existsSync(join(repoRoot, ".cursor/plans", COPY_PLAN)) &&
    "plan file absent (gitignored session state)",
}, () => {
  const def = spawnSync(
    "bash",
    [SCRIPT, "--force", "--autonomous", "--wait-monitor", "--dry-run", COPY_PLAN],
    { encoding: "utf8", cwd: repoRoot },
  );
  assert.equal(def.status, 0, def.stderr);
  assert.match(
    def.stdout,
    /prompt-file: \.cursor\/context\/templates\/plan-external-review-prompt\.md/,
  );
  assert.doesNotMatch(def.stdout, /paste-cmd:.*--prompt-file/);

  const ov = spawnSync(
    "bash",
    [
      SCRIPT,
      "--force",
      "--autonomous",
      "--wait-monitor",
      "--prompt-file",
      COPY_PROMPT,
      "--dry-run",
      COPY_PLAN,
    ],
    { encoding: "utf8", cwd: repoRoot },
  );
  assert.equal(ov.status, 0, ov.stderr);
  assert.match(ov.stdout, /prompt-file: \.cursor\/context\/templates\/plan-fable-copy-prompt\.md/);
  assert.match(
    ov.stdout,
    /paste-cmd:.*--prompt-file \.cursor\/context\/templates\/plan-fable-copy-prompt\.md/,
  );
});
