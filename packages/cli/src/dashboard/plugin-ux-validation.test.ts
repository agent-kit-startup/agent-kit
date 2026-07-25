import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST,
  allowlistConfig,
  isAllowedOrigin,
  resolveBindHost,
} from "../../../../dashboard/lib/guards.mjs";
import {
  buildMissionControlView,
  classifyPlan,
  parseHandoffMarkdown,
} from "../../../../dashboard/lib/semantic-model.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardHtml = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");
const serveSource = readFileSync(resolve(repoRoot, "dashboard/serve.mjs"), "utf8");

const lifecycleStates = [
  "executing",
  "awaiting_user",
  "parked",
  "incomplete",
  "completed",
] as const;

describe("plugin-ux-validation: narrow shell + a11y chrome", () => {
  it("defines primary narrow (≤520px) and mid-width (521–700px) layout rules", () => {
    expect(dashboardHtml).toContain("@media (max-width: 520px)");
    expect(dashboardHtml).toContain("@media (min-width: 521px) and (max-width: 700px)");
    expect(dashboardHtml).toContain("Narrow Cursor plugin panel (primary: ~360–520px)");
    expect(dashboardHtml).toMatch(/function isNarrowPanel\(\)\s*\{[\s\S]*max-width:\s*520px/);
  });

  it("honors prefers-reduced-motion by disabling decorative animation", () => {
    expect(dashboardHtml).toContain("@media (prefers-reduced-motion: reduce)");
    expect(dashboardHtml).toContain("animation: none !important");
    expect(dashboardHtml).toMatch(/function prefersReducedMotion\(\)/);
  });

  it("keeps keyboard activation for role=button rows and accordion triggers", () => {
    expect(dashboardHtml).toContain("keydown");
    expect(dashboardHtml).toContain('[role="button"][tabindex="0"]');
    expect(dashboardHtml).toContain("aria-expanded");
    expect(dashboardHtml).toContain("plan-accordion-trigger");
    expect(dashboardHtml).toMatch(/onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '/);
  });

  it("uses Cockpit anchors plus a more-sections dropdown (no horizontal tab track)", () => {
    expect(dashboardHtml).toContain('class="top-tabs"');
    expect(dashboardHtml).toContain('class="cockpit-anchors"');
    expect(dashboardHtml).toContain('class="top-nav-anchor');
    expect(dashboardHtml).toContain('data-anchor="now-execution-panel"');
    expect(dashboardHtml).toContain('data-anchor="hero-activity"');
    expect(dashboardHtml).toContain('data-anchor="attention-panel"');
    expect(dashboardHtml).toContain('data-anchor="recent-plans-panel"');
    expect(dashboardHtml).toContain("function goCockpitAnchor(");
    expect(dashboardHtml).toContain('id="navMoreBtn"');
    expect(dashboardHtml).toContain('id="navMoreMenu"');
    expect(dashboardHtml).toContain('role="menu"');
    expect(dashboardHtml).toContain("spaceIconSvg('more-sections', { decorative: false })");
    expect(dashboardHtml).toContain("function closeNavMore(");
    expect(dashboardHtml).toContain("function openNavMore(");
    expect(dashboardHtml).toContain("Escape");
    expect(dashboardHtml).toContain("overflow-x: hidden");
    expect(dashboardHtml).not.toContain("overflow-x: auto");
    expect(dashboardHtml).not.toContain('role="tablist"');
    expect(dashboardHtml).not.toContain("top-tabs-track");
    expect(dashboardHtml).toContain(".top-nav-anchor:focus-visible");
    expect(dashboardHtml).toContain(".nav-more-btn:focus-visible");
    expect(dashboardHtml).not.toContain("hamburgerBtn");
    expect(dashboardHtml).not.toContain("sidebarOverlay");
    expect(dashboardHtml).not.toContain('id="sidebar"');
    expect(dashboardHtml).not.toContain('class="sidebar"');
    expect(dashboardHtml).toContain('data-section="plans"');
    expect(dashboardHtml).toContain('data-section="processes"');
    expect(dashboardHtml).toContain("function showSection(id)");
    expect(dashboardHtml).toContain("onclick=\"return showSection('plans')\"");
  });

  it("preserves focus and scroll across SSE re-renders", () => {
    expect(dashboardHtml).toContain("function captureUiState()");
    expect(dashboardHtml).toContain("function restoreUiState(state)");
    expect(dashboardHtml).toContain("data-focus-key");
    expect(dashboardHtml).toContain("openPlanAccordions");
  });

  it("lets an anchor scroll finish across a live refresh instead of restoring mid-flight", () => {
    // Scroll restoration used to reinstate the position captured when the
    // render started, stranding a smooth anchor scroll part way to its section.
    expect(dashboardHtml).toContain("let pendingAnchorScroll = null");
    expect(dashboardHtml).toContain("const ANCHOR_SCROLL_SETTLE_MS");
    expect(dashboardHtml).toContain("function scrollToCockpitAnchor(anchorId");
    expect(dashboardHtml).toMatch(
      /function goCockpitAnchor\([\s\S]*?scrollToCockpitAnchor\(targetId\)/,
    );
    const restoreFn = dashboardHtml.match(/function restoreUiState\(state\) \{[\s\S]*?\n\}/);
    expect(restoreFn).not.toBeNull();
    expect(restoreFn?.[0]).toContain(
      "pendingAnchorScroll && Date.now() < pendingAnchorScroll.until",
    );
    expect(restoreFn?.[0]).toContain(
      "scrollToCockpitAnchor(pendingAnchorScroll.id, { track: false })",
    );
    // Manual scrolling releases the takeover instead of fighting the user.
    expect(dashboardHtml).toContain("window.addEventListener('wheel', releaseAnchorScroll");
    expect(dashboardHtml).toContain("window.addEventListener('touchmove', releaseAnchorScroll");
  });

  it("ships empty-state copy for now, activity, attention, and plans", () => {
    expect(dashboardHtml).toContain("activity-feed-empty");
    expect(dashboardHtml).toContain("attention-empty");
    expect(dashboardHtml).toContain("Nothing needs attention");
    expect(dashboardHtml).toContain("No plan, staging, or merge history yet");
    expect(dashboardHtml).toContain("No plans yet. Use /start-project");
    expect(dashboardHtml).toContain("No to-dos in this plan");
  });

  it("renders the current work card as a previous/current/next stepper with a step bar", () => {
    expect(dashboardHtml).toContain("function renderNowStepBar(now)");
    expect(dashboardHtml).toContain("function renderNowStepper(now, handoff, status, meta)");
    expect(dashboardHtml).toContain('class="now-stepper"');
    expect(dashboardHtml).toContain("now-step-previous");
    expect(dashboardHtml).toContain("now-step-current");
    expect(dashboardHtml).toContain("now-step-next");
    expect(dashboardHtml).toContain("now-stepbar-seg-done");
    expect(dashboardHtml).toContain("now-stepbar-seg-current");
    // Edge states: first step, last step, plan complete (no invented previous).
    expect(dashboardHtml).toContain("None \\u2014 first step");
    expect(dashboardHtml).toContain("None \\u2014 last step");
    expect(dashboardHtml).toContain("'Plan complete'");
    // Long ids/content degrade instead of breaking the narrow layout.
    expect(dashboardHtml).toContain("overflow-wrap: anywhere");
    expect(dashboardHtml).toContain("-webkit-line-clamp");
    // SSE fingerprint covers the new field so real changes re-render.
    expect(dashboardHtml).toMatch(/previousTodo: now\.previousTodo\?\.id \|\| null/);
  });

  it("uses a green live executing badge without a companion status dot", () => {
    // Executing badge is green with a live pulse class (not blue).
    expect(dashboardHtml).toMatch(/\.now-status-executing\s*\{[^}]*var\(--green\)/);
    expect(dashboardHtml).not.toMatch(/\.now-status-executing\s*\{[^}]*var\(--blue\)/);
    expect(dashboardHtml).toContain(".now-status-live");
    expect(dashboardHtml).toContain("@keyframes now-status-live-pulse");
    expect(dashboardHtml).toContain("live: true");
    // Reduced motion kills the live pulse while keeping the green badge.
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.now-status-live\s*\{[\s\S]*?animation:\s*none/,
    );
    // Companion status dot beside the badge is gone from the current-work header.
    const nowStatusMetaFn = dashboardHtml.match(/function nowStatusMeta\([\s\S]*?\n\}/);
    expect(nowStatusMetaFn).not.toBeNull();
    expect(nowStatusMetaFn?.[0]).not.toContain("dot:");
    expect(nowStatusMetaFn?.[0]).toContain("live: true");
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    expect(nowPanelFn?.[0]).not.toMatch(/class="dot \$\{meta\.dot\}"/);
    expect(nowPanelFn?.[0]).not.toContain("meta.dot");
    // Non-executing states stay distinct via mark + border shape, not color alone.
    expect(dashboardHtml).toContain("mark: '\\u25B6'");
    expect(dashboardHtml).toContain("mark: '\\u23F8'");
    expect(dashboardHtml).toContain("mark: '\\u25CB'");
    expect(dashboardHtml).toMatch(/\.now-status-awaiting\s*\{[^}]*border-style:\s*dashed/);
    expect(dashboardHtml).toMatch(/\.now-status-idle\s*\{[^}]*border-radius:\s*999px/);
  });

  it("demotes Mode and Updated to icon-led discreet meta with accessible names", () => {
    expect(dashboardHtml).toContain("function renderNowMeta(modeLabel, updatedSource)");
    expect(dashboardHtml).toContain("function nowMetaIconSvg(kind)");
    expect(dashboardHtml).toContain('class="now-meta"');
    expect(dashboardHtml).toContain("now-meta-icon");
    // Icons keep accessible names and tooltips (no bold Mode:/Updated: labels).
    expect(dashboardHtml).toContain('aria-label="Mode"');
    expect(dashboardHtml).toContain('aria-label="Updated"');
    expect(dashboardHtml).toContain('title="Mode"');
    expect(dashboardHtml).toContain('title="Updated"');
    expect(dashboardHtml).toContain("title=\"${escapeAttr('Mode: ' + modeLabel)}\"");
    expect(dashboardHtml).toContain("title=\"${escapeAttr('Updated: ' + updatedPlain)}\"");
    // Old full-weight labeled rows are gone from the now panel.
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    expect(nowPanelFn?.[0]).toContain("renderNowMeta(modeLabel, updatedSource)");
    expect(nowPanelFn?.[0]).not.toContain('now-meta-label">Mode:');
    expect(nowPanelFn?.[0]).not.toContain('now-meta-label">Updated:');
    expect(dashboardHtml).not.toContain("now-meta-label");
    expect(dashboardHtml).not.toContain("now-meta-row");
    // Inline SVG only (no icon font / dependency).
    expect(dashboardHtml).toMatch(/nowMetaIconSvg[\s\S]*?<svg class="now-meta-icon"/);
    expect(dashboardHtml).not.toMatch(/font-awesome|material-icons|iconify/i);
  });

  it("routes every action through the copy vocabulary that names a paste destination", () => {
    // One vocabulary, one mechanism: subject plus destination for every action.
    expect(dashboardHtml).toContain("const PASTE_DESTINATIONS = {");
    for (const destination of [
      "file picker (Cmd+P / Ctrl+P)",
      "chat input",
      "past-chat picker",
      "terminal",
    ]) {
      expect(dashboardHtml).toContain(`'${destination}'`);
    }
    expect(dashboardHtml).toContain("function copyToastMessage(subject, destination)");
    expect(dashboardHtml).toContain("function copyActionTitle(subject, destination)");
    expect(dashboardHtml).toContain("function copyForPaste(text, subject, destination)");
    expect(dashboardHtml).toMatch(
      /Copied \$\{subject\}\. Paste into the \$\{pasteDestinationLabel\(destination\)\}\./,
    );
    expect(dashboardHtml).toMatch(
      /Copy \$\{subject\}\. Paste into the \$\{pasteDestinationLabel\(destination\)\}\./,
    );
    // Path actions copy for the file picker; they never claim a native open.
    expect(dashboardHtml).toContain("const PATH_COPY_LABEL = 'Copy path'");
    expect(dashboardHtml).toContain("function copyRepoPath(relPath)");
    expect(dashboardHtml).toContain("function copyGitStagingCommand()");
    expect(dashboardHtml).not.toContain("canAttemptNativeOpen");
    expect(dashboardHtml).not.toContain("pathActionLabel");
    expect(dashboardHtml).not.toContain("attemptProtocolOpen");
    expect(dashboardHtml).not.toContain("Requested editor open:");
    expect(dashboardHtml).not.toContain("function buildEditorFileUris");
    expect(dashboardHtml).not.toMatch(/a\.href\s*=\s*uri/);
    expect(dashboardHtml).toContain("looksLikeCommitSha");
  });

  it("copies without promising an open in any label, tooltip, or confirmation", () => {
    // Walks the rendered user-facing strings rather than sampling known CTAs, so
    // a new action cannot reintroduce an open the panel cannot perform.
    const openPromise = /\b(open|opens|opening|launch|launches|reveal|reveals)\b/i;
    // Panel-local disclosure words: these describe expanding in place, not
    // opening a file, a chat, or an editor.
    const localDisclosure = /^(multiple open: (on|off)|show stack trace|\(expand\))/i;

    const offenders: string[] = [];
    const attributePattern = /(aria-label|title)="([^"]*)"/g;
    for (const [, name, value] of dashboardHtml.matchAll(attributePattern)) {
      // Template placeholders resolve at runtime; assert on the literal text.
      const literal = value.replace(/\$\{[^}]*\}/g, " ").trim();
      if (!literal || localDisclosure.test(literal)) continue;
      if (openPromise.test(literal)) offenders.push(`${name}="${value}"`);
    }
    expect(offenders).toEqual([]);

    // Button and role=button label text.
    const labelPattern = />\s*([A-Z][^<>{}]{2,60}?)\s*<\/button>/g;
    const labelOffenders: string[] = [];
    for (const [, label] of dashboardHtml.matchAll(labelPattern)) {
      if (localDisclosure.test(label)) continue;
      if (openPromise.test(label)) labelOffenders.push(label);
    }
    expect(labelOffenders).toEqual([]);

    // Confirmations are built by the copy vocabulary only.
    expect(dashboardHtml).not.toMatch(/toastMessage:\s*'[^']*\bopen/i);
    expect(dashboardHtml).not.toMatch(/showToast\(\s*['"`][^'"`]*\bOpened\b/i);
  });

  it("names a paste destination on every copy control", () => {
    // Copy handlers carry a destination argument; bare copies would leave the
    // human holding text with no stated destination.
    const bareCopies: string[] = [];
    for (const match of dashboardHtml.matchAll(/(?<!function )copyToClipboard\(/g)) {
      const call = dashboardHtml.slice(match.index ?? 0, (match.index ?? 0) + 200);
      if (!call.includes("toastMessage")) bareCopies.push(call.split("\n")[0].trim());
    }
    expect(bareCopies).toEqual([]);
    expect(dashboardHtml).toContain("function copyForPasteHandler(text, subject, destination)");
    expect(dashboardHtml).toContain("function copyRepoPathHandler(relPath)");
    // Inline handlers are escaped for the JS string and the HTML attribute.
    expect(dashboardHtml).toMatch(
      /return escapeAttr\(\s*`copyForPaste\('\$\{escapeJsString\(text\)/,
    );
    expect(dashboardHtml).toMatch(
      /return escapeAttr\(`copyRepoPath\('\$\{escapeJsString\(relPath\)/,
    );
  });
});

describe("plugin-ux-validation: SSE + overview model wiring", () => {
  it("uses EventSource with polling fallback when SSE degrades", () => {
    expect(dashboardHtml).toContain("function connectSSE()");
    expect(dashboardHtml).toContain("new EventSource('/api/events')");
    expect(dashboardHtml).toContain("syncPollingWithSseMode");
    expect(dashboardHtml).toContain("sseMode = 'polling'");
    expect(dashboardHtml).toContain("startAutoRefresh");
    expect(dashboardHtml).toMatch(
      /if \(!force && sseMode === 'live' && !sseReconnecting && !sseSilentFallback && data\) return/,
    );
  });

  it("re-renders now + attention from missionControl fingerprints on each snapshot", () => {
    expect(dashboardHtml).toContain("function nowFingerprint(now)");
    expect(dashboardHtml).toContain("attentionFingerprint");
    expect(dashboardHtml).toContain("renderNowExecutionPanel");
    expect(dashboardHtml).toContain("d.missionControl?.now");
    expect(dashboardHtml).toContain("d.missionControl?.attention");
    expect(dashboardHtml).toContain("d.missionControl?.activity");
  });

  it("orders overview as current mission → monitor → field report → checklist", () => {
    const overviewStart = dashboardHtml.indexOf('id="section-overview"');
    expect(overviewStart).toBeGreaterThan(-1);
    const overviewSlice = dashboardHtml.slice(overviewStart, overviewStart + 4000);
    const nowIdx = overviewSlice.indexOf("renderNowExecutionPanel");
    const activityIdx = overviewSlice.indexOf('id="hero-activity"');
    const attentionIdx = overviewSlice.indexOf("renderAttentionPanel");
    const recentIdx = overviewSlice.indexOf("renderRecentPlanCards");
    expect(nowIdx).toBeGreaterThan(-1);
    expect(activityIdx).toBeGreaterThan(nowIdx);
    expect(attentionIdx).toBeGreaterThan(activityIdx);
    expect(recentIdx).toBeGreaterThan(attentionIdx);
  });

  it("names the Cockpit page and its four sections consistently with the nav", () => {
    // Headings are the shipped Phase 2 names, each led by its icon.
    for (const heading of [
      "${spaceIconSvg('current-mission')}Current mission",
      "${spaceIconSvg('monitor')}Monitor",
      "${spaceIconSvg('field-report')}Field Report",
      "${spaceIconSvg('checklist')}Checklist",
    ]) {
      expect(dashboardHtml).toContain(heading);
    }
    // Primary nav names the page; no redundant page-level Cockpit/Overview title.
    expect(dashboardHtml).toContain('class="top-nav-anchor-label">Cockpit</span>');
    expect(dashboardHtml).not.toMatch(/<span class="dot dot-blue"><\/span>\s*Cockpit/);
    expect(dashboardHtml).not.toMatch(/<span class="dot dot-blue"><\/span>\s*Overview/);
    // No prose pointing at navigation the panel no longer ships.
    expect(dashboardHtml).not.toContain("Inventory tabs");
    expect(dashboardHtml).toContain("More sections menu");
  });

  it("does not offer a Copy start header control (terminal: npm run dashboard / agent-kit dashboard)", () => {
    expect(dashboardHtml).not.toContain("btn-copy-start");
    expect(dashboardHtml).not.toContain("copyStartCommand");
    expect(dashboardHtml).not.toContain("serverOfflineAction");
    expect(dashboardHtml).not.toContain("Copy start");
  });

  it("visually distinguishes all plan lifecycle states", () => {
    const visualKeys = ["executing", "awaiting", "parked", "incomplete", "completed"];
    for (const key of visualKeys) {
      expect(dashboardHtml).toContain(`lifecycle-pill-${key}`);
      expect(dashboardHtml).toContain(`recent-plan-card-${key}`);
    }
    for (const state of lifecycleStates) {
      expect(LIFECYCLE_SORT_RANK_SOURCE()).toContain(`${state}:`);
    }
    expect(dashboardHtml).toContain("awaiting_user: { key: 'awaiting'");
  });
});

/** Executes the shipped icon builder instead of asserting on its source text. */
function loadSpaceIconSvg() {
  const fn = dashboardHtml.match(/function spaceIconSvg\(kind, opts\) \{[\s\S]*?\n\}/);
  expect(fn).not.toBeNull();
  return new Function(`${fn?.[0]}\nreturn spaceIconSvg;`)() as (
    kind: string,
    opts?: { decorative?: boolean },
  ) => string;
}

describe("cockpit-validation: icons, assets, and accessible names", () => {
  it("requests the logo at the URL the static resolver serves", () => {
    expect(dashboardHtml).toContain('href="/logo.svg"');
    expect(dashboardHtml).toContain('src="/logo.svg"');
    expect(dashboardHtml).not.toContain("/dashboard/logo.svg");
    // Decorative next to the visible product name, so it carries no alt text.
    expect(dashboardHtml).toMatch(
      /<img class="logo" src="\/logo\.svg"[^>]*alt=""[^>]*aria-hidden="true"/,
    );
  });

  it("ships the space icon set with a name for every kind", () => {
    // Runs the shipped function rather than reading its source, so an icon
    // that loses its accessible name fails here.
    const spaceIconSvg = loadSpaceIconSvg();
    const names: Record<string, string> = {
      "current-mission": "Current mission",
      monitor: "Monitor",
      "field-report": "Field Report",
      checklist: "Checklist",
      "more-sections": "More sections",
    };
    for (const [kind, name] of Object.entries(names)) {
      const decorative = spaceIconSvg(kind);
      expect(decorative, `${kind} must render`).toContain('<svg class="space-icon"');
      expect(decorative).toContain('aria-hidden="true"');
      expect(decorative).not.toContain('role="img"');

      const labelled = spaceIconSvg(kind, { decorative: false });
      expect(labelled).toContain('role="img"');
      expect(labelled).toContain(`aria-label="${name}"`);
      expect(labelled).toContain(`title="${name}"`);
    }
    expect(spaceIconSvg("not-a-kind")).toBe("");
    // Inline SVG only: no icon font, sprite fetch, or frontend dependency.
    expect(dashboardHtml).not.toMatch(/font-awesome|material-icons|iconify/i);
  });

  it("gives every terminal expand control a name that says which terminal", () => {
    expect(dashboardHtml).toMatch(
      /class="terminal-expand-btn"[^>]*aria-label="Expand the captured output for terminal \$\{escapeAttr\(t\.id\)\}"/,
    );
    expect(dashboardHtml).toMatch(
      /class="terminal-expand-btn"[^>]*title="Expand the captured output for terminal \$\{escapeAttr\(t\.id\)\}"/,
    );
  });
});

describe("plugin-ux-validation: hardening regressions", () => {
  it("degrades a failed snapshot into empty panels instead of a render error", () => {
    // The panel reads every collection unconditionally, so the fallback
    // payload has to carry them all.
    const fallback = serveSource.match(/version: 'error',[\s\S]*?missionControl: null,\s*\}\);/);
    expect(fallback).not.toBeNull();
    for (const key of [
      "plans: []",
      "agents: []",
      "commands: []",
      "skills: []",
      "terminals: []",
      "processes: []",
    ]) {
      expect(fallback?.[0]).toContain(key);
    }
  });

  it("keeps XSS escape helpers and uses them for dynamic labels", () => {
    expect(dashboardHtml).toContain("function escapeHtml(value)");
    expect(dashboardHtml).toContain("function escapeAttr(value)");
    expect(dashboardHtml).toContain("function escapeJsString(value)");
    expect(dashboardHtml).toMatch(/escapeHtml\(ev\.label\)/);
    expect(dashboardHtml).toMatch(/escapeHtml\(item\.label/);
  });

  it("keeps serve.mjs read-only (GET/SSE only, no mutation routes)", () => {
    expect(serveSource).toContain("/api/events");
    expect(serveSource).toContain("/dashboard-data.json");
    expect(serveSource).not.toMatch(/req\.method\s*===\s*['"]POST['"]/);
    expect(serveSource).not.toMatch(/writeFileSync|mkdirSync|rmSync|unlinkSync/);
    expect(serveSource).toContain("resolveBindHost");
    expect(serveSource).toContain("applyCorsHeaders");
    expect(serveSource).toContain("resolveDashboardStatic");
  });

  it("preserves loopback default bind and localhost CORS allowlist", () => {
    expect(resolveBindHost(undefined)).toBe(DEFAULT_HOST);
    expect(DEFAULT_HOST).toBe("127.0.0.1");
    expect(isAllowedOrigin("http://127.0.0.1:3333", 3333)).toBe(true);
    expect(isAllowedOrigin("http://evil.example:3333", 3333)).toBe(false);
    const cfg = allowlistConfig({
      onboarded: true,
      secretToken: "nope",
      onboarding: { status: "complete", contractVersion: 2, checks: [{ id: "x" }] },
    });
    expect(cfg).not.toHaveProperty("secretToken");
    expect(cfg.onboarding).not.toHaveProperty("checks");
  });
});

describe("plugin-ux-validation: fixture-backed classification + activity", () => {
  const plans = [
    {
      id: "active-plan",
      file: "active-plan.plan.md",
      path: ".cursor/plans/active-plan.plan.md",
      overview: "Active",
      modifiedAt: "2026-07-24T20:00:00.000Z",
      todos: {
        total: 2,
        completed: 0,
        pending: 1,
        inProgress: 1,
        items: [
          { id: "plugin-ux-validation", content: "Validate", status: "in_progress" },
          { id: "next-todo", content: "Next", status: "pending" },
        ],
      },
    },
    {
      id: "parked-plan",
      file: "parked-plan.plan.md",
      path: ".cursor/plans/parked-plan.plan.md",
      overview: "Parked",
      modifiedAt: "2026-07-24T18:00:00.000Z",
      todos: {
        total: 1,
        completed: 1,
        pending: 0,
        inProgress: 0,
        items: [{ id: "done", content: "Done", status: "completed" }],
      },
    },
    {
      id: "incomplete-plan",
      file: "incomplete-plan.plan.md",
      path: ".cursor/plans/incomplete-plan.plan.md",
      overview: "Incomplete",
      modifiedAt: "2026-07-20T12:00:00.000Z",
      todos: {
        total: 2,
        completed: 1,
        pending: 1,
        inProgress: 0,
        items: [
          { id: "a", content: "A", status: "completed" },
          { id: "b", content: "B", status: "pending" },
        ],
      },
    },
  ];

  it("classifies lifecycle states from HANDOFF + todos", () => {
    const handoff = {
      plan: "active-plan.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: ["parked-plan.plan.md"],
      nextTodos: "`plugin-ux-validation`",
    };
    expect(classifyPlan(plans[0], handoff)).toBe("executing");
    expect(classifyPlan(plans[1], handoff)).toBe("parked");
    expect(classifyPlan(plans[2], handoff)).toBe("incomplete");
  });

  it("builds semantic activity without refresh/process noise kinds", () => {
    const handoff = parseHandoffMarkdown(`# Handoff
- **Plan:** \`active-plan.plan.md\`
- **Mode:** Night shift: /run-plan orchestrated
- **Next to-dos:** \`plugin-ux-validation\`
- **Parked plans:** \`parked-plan.plan.md\`
`);
    const view = buildMissionControlView({
      plans,
      handoff,
      gitLogLines: [
        "4d5a8b3 Merge pull request #207 from agent-kit-startup/feat/cursor-native",
        "abc1234 chore: git staging after tick",
      ],
      readinessPending: [],
    });

    expect(view.now.status).toBe("executing");
    expect(view.now.currentTodo?.id).toBe("plugin-ux-validation");
    expect(view.activity.some((e) => e.kind === "run_plan")).toBe(true);
    expect(view.activity.some((e) => e.kind === "merge")).toBe(true);
    expect(view.activity.some((e) => e.kind === "staging")).toBe(true);
    expect(view.activity.every((e) => !["refresh", "heartbeat", "process"].includes(e.kind))).toBe(
      true,
    );
    expect(view.attention.some((i) => i.kind === "parked" || i.kind === "incomplete")).toBe(false);
    expect(view.checklistNotes.some((i) => i.kind === "parked")).toBe(true);
    expect(view.checklistNotes.some((i) => i.kind === "incomplete")).toBe(true);
  });
});

/**
 * Executes the shipped browser-side reconciliation instead of asserting on its
 * source text, so a Checklist note that duplicates a plan card fails the suite.
 */
function loadChecklistNotesForRender() {
  const order = dashboardHtml.match(/function orderAttentionBySeverity\(items\) \{[\s\S]*?\n\}/);
  const filter = dashboardHtml.match(
    /function checklistNotesForRender\(notes, renderedPlans\) \{[\s\S]*?\n\}/,
  );
  expect(order).not.toBeNull();
  expect(filter).not.toBeNull();
  return new Function(`${order?.[0]}\n${filter?.[0]}\nreturn checklistNotesForRender;`)() as (
    notes: { id: string; severity?: string; planFile?: string }[],
    renderedPlans: { file: string }[],
  ) => { id: string; planFile?: string }[];
}

describe("cockpit checklist: relocated plan-state notes", () => {
  const notes = [
    {
      id: "attention:parked:parked-plan.plan.md",
      severity: "info",
      planFile: "parked-plan.plan.md",
    },
    {
      id: "attention:incomplete:incomplete-plan.plan.md",
      severity: "warning",
      planFile: "incomplete-plan.plan.md",
    },
    { id: "attention:readiness:confirm-provider", severity: "info" },
  ];

  it("renders the relocated notes inside the Checklist panel", () => {
    expect(dashboardHtml).toContain("function renderChecklistNotes(d, renderedPlans)");
    expect(dashboardHtml).toContain("d.missionControl?.checklistNotes");
    expect(dashboardHtml).toContain("Plan states and readiness needing a decision");
    const checklistStart = dashboardHtml.indexOf("function renderRecentPlanCards(d)");
    const checklistSlice = dashboardHtml.slice(checklistStart, checklistStart + 4000);
    expect(checklistSlice).toContain("renderChecklistNotes(d, recent)");
  });

  it("drops a note whose plan already renders as a card, keeping readiness", () => {
    const checklistNotesForRender = loadChecklistNotesForRender();
    const rendered = checklistNotesForRender(notes, [
      { file: "parked-plan.plan.md" },
      { file: "incomplete-plan.plan.md" },
    ]);
    expect(rendered.map((n) => n.id)).toEqual(["attention:readiness:confirm-provider"]);
  });

  it("keeps notes for plans the card limit left out, warnings first", () => {
    const checklistNotesForRender = loadChecklistNotesForRender();
    const rendered = checklistNotesForRender(notes, [{ file: "some-other.plan.md" }]);
    expect(rendered.map((n) => n.id)).toEqual([
      "attention:incomplete:incomplete-plan.plan.md",
      "attention:parked:parked-plan.plan.md",
      "attention:readiness:confirm-provider",
    ]);
    expect(new Set(rendered.map((n) => n.id)).size).toBe(rendered.length);
  });
});

function LIFECYCLE_SORT_RANK_SOURCE() {
  const match = dashboardHtml.match(/const LIFECYCLE_SORT_RANK = \{[\s\S]*?\};/);
  expect(match).not.toBeNull();
  return match?.[0];
}
