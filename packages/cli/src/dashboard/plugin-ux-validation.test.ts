import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOST,
  MAX_GIT_PATH,
  allowlistConfig,
  isAllowedOrigin,
  resolveBindHost,
} from "../../../../dashboard/lib/guards.mjs";
import {
  MONITOR_ACTIVITY_KINDS,
  MONITOR_FEED_CAP,
  buildMissionControlView,
  classifyPlan,
  parseHandoffMarkdown,
} from "../../../../dashboard/lib/semantic-model.mjs";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../..");
const dashboardHtml = readFileSync(resolve(repoRoot, "dashboard/dashboard.html"), "utf8");
const serveSource = readFileSync(resolve(repoRoot, "dashboard/serve.mjs"), "utf8");

/**
 * The Crew Monitor render block only (`#hero-activity` through the Plans
 * section), so a pin about the Crew row cannot be satisfied — or broken — by
 * the Activity tab, which renders a different row from the same helpers.
 */
function crewMonitorFeedBlock(html: string): string {
  const start = html.indexOf('<div class="section-hero" id="hero-activity">');
  if (start < 0) return "";
  const end = html.indexOf('id="section-plans"', start);
  if (end < 0) return "";
  return html.slice(start, end);
}

/** Crew Monitor row return-template only (not CSS / whole-file proximity). */
function crewMonitorRowRenderTemplate(html: string): string {
  const marker = '<div class="monitor-row stagger-fade stagger-${staggerIdx}"';
  const start = html.indexOf(marker);
  if (start < 0) return "";
  const end = html.indexOf("</div>`;", start);
  if (end < 0) return "";
  return html.slice(start, end);
}

/**
 * Structural pin for the design-v2 row order: the team badge is a row sibling at
 * row start, then actor → verb → primary → meta → time. Inverts the previous
 * `expectChipIsRowSiblingBeforeFeedLabel` / `expectChipInsideFeedLabelNotRowSibling`
 * pins at the same strictness.
 *
 * Finding E (close-crew … r1-r3 residuals) showed the old chip helper only locked
 * the avatar→feed-label gap, so `${chipHtml}` after feed-label still passed. The
 * whole-template counts below close that half-locked slot for the badge-era row:
 * `${chipHtml}` / `monitor-row-chip` must be zero anywhere in the row template,
 * and `${badgeHtml}` must appear exactly once.
 *
 * That segment row is the layout the design was commissioned to replace: equal
 * shrink across every segment is what produced `revi…` / `P…` / `8f…`, so a
 * regression back to it must fail here rather than pass quietly. The badge is
 * also NOT the `#631` avatar box returning — it carries the kind colour and the
 * kind gloss, which the avatar never did.
 * Verdict: .cursor/context/mission-control-design/remote/v1/ACCEPTANCE.md
 * ADR: .cursor/memory/decisions/2026-07-27_crew-monitor-vs-plan-monitor-glossary.md
 */
function expectBadgeIsRowSiblingBeforeActor(html: string) {
  const rowTpl = crewMonitorRowRenderTemplate(html);
  expect(
    rowTpl.length,
    "crew row render template not found — update the marker in crewMonitorRowRenderTemplate",
  ).toBeGreaterThan(0);
  // Row order: badge → actor → verb → primary → meta → time, each a direct child.
  expect(rowTpl).toMatch(
    /\$\{badgeHtml\}[\s\S]*?\$\{actorHtml\}[\s\S]*?\$\{verbHtml\}[\s\S]*?<span class="monitor-row-primary"[\s\S]*?<span class="monitor-row-meta"[\s\S]*?<span class="monitor-row-time"/,
  );
  // Nothing renders before the badge inside the row.
  const beforeBadge = rowTpl.slice(0, rowTpl.indexOf("${badgeHtml}"));
  expect(beforeBadge).not.toMatch(/<span/);
  // The v1 segment row must not come back in any form.
  expect(rowTpl).not.toMatch(/feed-label|feed-seg|feed-sep|feedSegSpans|feedLabelHtml/);
  // Whole-template chip lock (finding E): no half-locked sibling slot after feed-label.
  expect(rowTpl.match(/\$\{chipHtml\}/g)?.length ?? 0).toBe(0);
  expect(rowTpl.match(/monitor-row-chip/g)?.length ?? 0).toBe(0);
  expect(rowTpl.match(/monitor-row-icon/g)?.length ?? 0).toBe(0);
  expect(rowTpl).not.toMatch(/info\.icon/);
  // Exactly one badge interpolation owns the kind tint.
  expect(rowTpl.match(/\$\{badgeHtml\}/g)?.length ?? 0).toBe(1);
  // The avatar box stays gone (it is not what the badge is).
  expect(rowTpl).not.toMatch(/monitor-row-avatar|agentInitials/);
}

const lifecycleStates = [
  "executing",
  "awaiting_user",
  "parked",
  "backlog",
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
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.btn-refresh\.is-refreshing \.btn-refresh-icon,[\s\S]*?animation:\s*none !important/,
    );
  });

  it("keeps press/scale :active only on interactive Mission Control controls", () => {
    expect(dashboardHtml).toMatch(/\.health-item:active\s*\{[^}]*transform:\s*scale\(0\.98\)/);
    expect(dashboardHtml).toMatch(/\.empty-state-btn:active\s*\{[^}]*transform:\s*scale\(0\.98\)/);
    expect(dashboardHtml).not.toMatch(/\.card:active\s*\{[^}]*transform:\s*scale\(0\.98\)/);
    expect(dashboardHtml).not.toMatch(/\.plan-card:active\s*\{[^}]*transform:\s*scale\(0\.98\)/);
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.health-item:active,[\s\S]*?\.empty-state-btn:active\s*\{[\s\S]*?transform:\s*none !important/,
    );
    expect(dashboardHtml).not.toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.card:active,[\s\S]*?\.plan-card:active,/,
    );
  });

  it("keeps an icon-only header-height refresh control with accessible states", () => {
    expect(dashboardHtml).toMatch(
      /id="refreshBtn"[^>]*(aria-label="Refresh"[^>]*title="Refresh"|title="Refresh"[^>]*aria-label="Refresh")/,
    );
    expect(dashboardHtml).toMatch(
      /\.btn-refresh\s*\{[^}]*width:\s*var\(--mc-header-control-size\)[^}]*height:\s*var\(--mc-header-control-size\)/,
    );
    expect(dashboardHtml).toMatch(/\.btn-refresh\s*\{[^}]*border:\s*none;/);
    expect(dashboardHtml).toMatch(/\.btn-refresh\s*\{[^}]*background:\s*transparent;/);
    expect(dashboardHtml).toMatch(
      /\.btn-refresh:hover\s*\{[^}]*background:\s*var\(--bg-card-hover\)/,
    );
    expect(dashboardHtml).toContain("transform-origin: 50% 50%");
    expect(dashboardHtml).toMatch(
      /class="btn-refresh-icon"[^>]*viewBox="0 0 16 16"[^>]*stroke-width="1\.5"/,
    );
    expect(dashboardHtml).not.toContain('viewBox="0 0 24 24"');
    expect(dashboardHtml).toContain("@media (prefers-reduced-motion: no-preference)");
    expect(dashboardHtml).toMatch(
      /\.btn-refresh\.is-refreshing\s+\.btn-refresh-icon\s*\{[^}]*animation:\s*spin/,
    );
    expect(dashboardHtml).toContain("btn.classList.add('is-refreshing')");
    expect(dashboardHtml).toContain("btn.setAttribute('aria-label', 'Start server')");
    expect(dashboardHtml).toContain("btn.title = 'Start server'");
    expect(dashboardHtml).not.toContain("btn-refresh-text");
    expect(dashboardHtml).not.toMatch(/refreshBtn[\s\S]{0,80}textContent/);
    expect(dashboardHtml).not.toMatch(/getElementById\('refreshBtn'\)[\s\S]{0,400}inline-spinner/);
  });

  it("insets header icon hitboxes and trails More toward the IDE edge", () => {
    expect(dashboardHtml).toContain("--mc-header-control-size: 24px");
    expect(dashboardHtml).toContain("--mc-header-pad-x-end: 8px");
    expect(dashboardHtml).toMatch(
      /\.header\s*\{[^}]*padding:\s*0 var\(--mc-header-pad-x-end\) 0 var\(--mc-header-pad-x\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.header-home-btn\s*\{[^}]*width:\s*var\(--mc-header-control-size\)[^}]*height:\s*var\(--mc-header-control-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.header-right \.nav-more-btn\s*\{[^}]*width:\s*var\(--mc-header-control-size\)[^}]*height:\s*var\(--mc-header-control-size\)/,
    );
    // positionNavMore stays right-edge anchored (fixed menu from trigger rect).
    expect(dashboardHtml).toContain("function positionNavMore()");
    expect(dashboardHtml).toMatch(/let left = rect\.right - width/);
  });

  it("escapes nav More menu from header overflow via fixed positioning", () => {
    // Absolute menus clip under overflow-hidden ancestors (nav row); a11y tree alone
    // is insufficient — see errors/2026-07-25_dropdown-clipped-by-overflow-hidden-nav-row.md.
    // Mirror: "escapes Checklist Actions menu from panel overflow via fixed positioning".
    expect(dashboardHtml).toMatch(/\.nav-more-menu\s*\{[^}]*position:\s*fixed/);
    expect(dashboardHtml).toContain("function positionNavMore()");
    expect(dashboardHtml).toContain("getBoundingClientRect()");
    expect(dashboardHtml).toMatch(/let left = rect\.right - width/);
    expect(dashboardHtml).toMatch(
      /window\.addEventListener\(\s*['"]resize['"][\s\S]*?positionNavMore/,
    );
    // CSS contract must not reintroduce absolute clip under overflow ancestors.
    expect(dashboardHtml).not.toMatch(/\.nav-more-menu\s*\{[^}]*position:\s*absolute/);
    // MANUAL DOGFOOD GATE (painted clip) — ADR 2026-07-26 keeps string/regex in CI
    // (no JSDOM/Playwright). Structure/CSS above is CI-checkable; painted result is not.
    // After header/nav chrome edits that touch .nav-more-menu / positionNavMore /
    // .top-tabs-row overflow: (1) agent-kit dashboard, (2) open #navMoreBtn,
    // (3) DevTools: compare #navMoreMenu.getBoundingClientRect() to each ancestor
    // with overflow != visible up to body; last .nav-more-item bottom must be inside
    // the menu's visible box (not clipped to the 32px nav row). Screenshot OK.
    // Fail = menu items listed in a11y tree but invisible. See plan
    // mc-nav-more-painted-clip-e2e + errors/2026-07-25_dropdown-clipped-by-overflow-hidden-nav-row.md.
  });

  it("keeps keyboard activation for role=button rows and accordion triggers", () => {
    expect(dashboardHtml).toContain("keydown");
    expect(dashboardHtml).toContain('[role="button"][tabindex="0"]');
    expect(dashboardHtml).toContain("aria-expanded");
    expect(dashboardHtml).toContain("plan-accordion-trigger");
    expect(dashboardHtml).toMatch(/onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '/);
  });

  it("shares Cursor workbench typography for chrome labels and space icons", () => {
    expect(dashboardHtml).toContain(
      '--mc-font-sans: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
    expect(dashboardHtml).toContain("--mc-ui-font-size: 13px");
    expect(dashboardHtml).toContain("--mc-chrome-label-size: 13px");
    expect(dashboardHtml).toContain("--mc-chrome-label-weight: 500");
    expect(dashboardHtml).toContain("--mc-chrome-icon-size: 16px");
    expect(dashboardHtml).toContain("--mc-status-dot-size: 7px");
    expect(dashboardHtml).toContain("--mc-chrome-subtitle-size: 12px");
    expect(dashboardHtml).toContain("--mc-chrome-meta-size: 11px");
    expect(dashboardHtml).toMatch(/font-family:\s*var\(--mc-font-sans\)/);
    expect(dashboardHtml).toMatch(
      /\.top-nav-anchor\s*\{[^}]*font-size:\s*var\(--mc-chrome-label-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.card-title\s*\{[^}]*font-size:\s*var\(--mc-chrome-label-size\)/,
    );
    expect(dashboardHtml).toMatch(/\.space-icon\s*\{[^}]*width:\s*var\(--mc-chrome-icon-size\)/);
    expect(dashboardHtml).toMatch(/\.space-icon\s*\{[^}]*display:\s*block/);
    expect(dashboardHtml).toMatch(
      /\.btn-refresh \.btn-refresh-icon\s*\{[^}]*width:\s*var\(--mc-chrome-icon-size\)[^}]*height:\s*var\(--mc-chrome-icon-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /function spaceIconSvg[\s\S]*?viewBox="0 0 16 16"[\s\S]*?stroke-width="1\.5"/,
    );
    expect(dashboardHtml).toMatch(
      /function nowMetaIconSvg[\s\S]*?viewBox="0 0 16 16"[\s\S]*?stroke-width="1\.5"/,
    );
    expect(dashboardHtml).toMatch(
      /\.empty-state-cta \.empty-state-icon \.space-icon\s*\{[^}]*width:\s*calc\(var\(--mc-chrome-icon-size\) \* 2\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.empty-state-cta\.compact \.empty-state-icon \.space-icon\s*\{[^}]*width:\s*calc\(var\(--mc-chrome-icon-size\) \* 1\.75\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.nav-more-group-label\s*\{[^}]*font-size:\s*var\(--mc-chrome-subtitle-size\)[^}]*font-weight:\s*var\(--mc-chrome-subtitle-weight\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.top-tab-badge\s*\{[^}]*font-size:\s*var\(--mc-chrome-subtitle-size\)[^}]*font-weight:\s*var\(--mc-chrome-subtitle-weight\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.now-meta-icon\s*\{[^}]*width:\s*var\(--mc-chrome-subtitle-size\)[^}]*height:\s*var\(--mc-chrome-subtitle-size\)/,
    );
    expect(dashboardHtml).not.toMatch(/\.space-icon\s*\{[^}]*width:\s*1em/);
    expect(dashboardHtml).not.toMatch(/\.top-tab-badge\s*\{[^}]*font-size:\s*\d+px/);
    expect(dashboardHtml).not.toMatch(/\.top-nav-anchor \.top-tab-badge\s*\{[^}]*font-size:/);
    expect(dashboardHtml).not.toMatch(
      /@media \(max-width: 520px\)[\s\S]*?\.top-tab-badge\s*\{[^}]*font-size:/,
    );
    expect(dashboardHtml).not.toContain(".section-hero .card-title");
    expect(dashboardHtml).not.toMatch(/html,\s*body\s*\{[^}]*'SF Mono'/);
  });

  it("consolidates structure tokens for tabs, headers, and cards", () => {
    expect(dashboardHtml).toContain("--mc-header-height: 32px");
    expect(dashboardHtml).toContain("--mc-header-control-size: 24px");
    expect(dashboardHtml).toContain("--mc-radius-sm: 4px");
    expect(dashboardHtml).toContain("--mc-radius-chrome: 6px");
    expect(dashboardHtml).toContain("--mc-radius: 8px");
    expect(dashboardHtml).toContain("--mc-radius-lg: 12px");
    expect(dashboardHtml).toContain("--mc-radius-pill: 999px");
    expect(dashboardHtml).toContain("--mc-card-padding: 16px");
    expect(dashboardHtml).toContain("--mc-card-padding-dense: 10px 12px");
    expect(dashboardHtml).toContain("--mc-header-pad-x: 24px");
    expect(dashboardHtml).toContain("--mc-header-pad-x-end: 8px");
    expect(dashboardHtml).toContain("--mc-content-pad: 24px");
    expect(dashboardHtml).toContain("--mc-scroll-gutter: 8px");
    expect(dashboardHtml).toContain("--header-height: var(--mc-header-height)");
    expect(dashboardHtml).toContain("--radius: var(--mc-radius)");
    expect(dashboardHtml).toContain("--radius-lg: var(--mc-radius-lg)");
    expect(dashboardHtml).toMatch(
      /\.header\s*\{[^}]*padding:\s*0 var\(--mc-header-pad-x-end\) 0 var\(--mc-header-pad-x\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.header-brand \.logo\s*\{[^}]*width:\s*var\(--mc-chrome-icon-size\)[^}]*height:\s*var\(--mc-chrome-icon-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.dot\s*\{[^}]*width:\s*var\(--mc-status-dot-size\)[^}]*height:\s*var\(--mc-status-dot-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.btn-refresh\s*\{[^}]*width:\s*var\(--mc-header-control-size\)[^}]*height:\s*var\(--mc-header-control-size\)/,
    );
    expect(dashboardHtml).not.toContain("--mc-header-height: 56px");
    expect(dashboardHtml).not.toMatch(/\.header-brand \.logo\s*\{[^}]*width:\s*28px/);
    expect(dashboardHtml).toMatch(
      /\.top-nav-anchor\s*\{[^}]*border-radius:\s*var\(--mc-radius-chrome\)/,
    );
    expect(dashboardHtml).toMatch(/\.card\s*\{[^}]*padding:\s*var\(--mc-card-padding\)/);
    expect(dashboardHtml).toMatch(/\.plan-card\s*\{[^}]*padding:\s*var\(--mc-card-padding\)/);
    // Unified card contract (G9): dense list cards share the dense padding
    // token and the ladder radius; no per-card pixel one-offs.
    expect(dashboardHtml).toMatch(
      /\.agent-card\s*\{[^}]*padding:\s*var\(--mc-card-padding-dense\)/,
    );
    expect(dashboardHtml).toMatch(/\.agent-card\s*\{[^}]*border-radius:\s*var\(--mc-radius\)/);
    expect(dashboardHtml).toMatch(
      /\.command-card\s*\{[^}]*padding:\s*var\(--mc-card-padding-dense\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.skill-card\s*\{[^}]*padding:\s*var\(--mc-card-padding-dense\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.process-card\s*\{[^}]*padding:\s*var\(--mc-card-padding-dense\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.recent-plan-card\s*\{[^}]*padding:\s*var\(--mc-card-padding-dense\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.flight-log-card\s*\{[^}]*padding:\s*var\(--mc-card-padding-dense\)/,
    );
    expect(dashboardHtml).toMatch(/\.flight-log-card\s*\{[^}]*border-radius:\s*var\(--mc-radius\)/);
    expect(dashboardHtml).toMatch(
      /\.memory-panel\s*\{[^}]*border-radius:\s*var\(--mc-radius-lg\)[^}]*padding:\s*var\(--mc-card-padding\)/,
    );
    // Empty states scale with the card density ladder across viewport modes.
    expect(dashboardHtml).toMatch(
      /\.empty-state\s*\{[^}]*padding:\s*calc\(var\(--mc-card-padding\) \* 2\.5\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.empty-state-cta\s*\{[^}]*padding:\s*calc\(var\(--mc-card-padding\) \* 2\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.header-version\s*\{[^}]*font-size:\s*var\(--mc-chrome-meta-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.recent-plan-name\s*\{[^}]*font-size:\s*var\(--mc-chrome-label-size\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.plan-accordion-overview\s*\{[^}]*font-size:\s*var\(--mc-chrome-subtitle-size\)/,
    );
    // Skins stay color/surface swaps; structure tokens live on :root / legacy.
    const cursorBlock = dashboardHtml.match(/html\[data-dashboard-skin="cursor"\]\s*\{([^}]+)\}/);
    expect(cursorBlock).not.toBeNull();
    expect(cursorBlock?.[1]).not.toMatch(/--mc-radius/);
    expect(cursorBlock?.[1]).not.toMatch(/--mc-card-padding/);
    expect(cursorBlock?.[1]).not.toMatch(/--mc-chrome-meta-size/);
    // Status/lifecycle pills squared off to the chrome radius (design v2): the
    // capsule read as a foreign shape next to the chrome it always sits beside.
    // The capsule token stays alive for the queue-role pill below, which is the
    // one pill that must NOT read as a status chip.
    expect(dashboardHtml).toMatch(
      /\.lifecycle-pill\s*\{[^}]*border-radius:\s*var\(--mc-radius-chrome\)/,
    );
    expect(dashboardHtml).not.toMatch(
      /\.lifecycle-pill\s*\{[^}]*border-radius:\s*var\(--mc-radius-pill\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.queue-role-pill\s*\{[^}]*border-radius:\s*var\(--mc-radius-pill\)/,
    );
  });

  it("uses Cockpit anchors plus a more-sections dropdown in the header (no horizontal tab track)", () => {
    expect(dashboardHtml).toContain('class="top-tabs"');
    expect(dashboardHtml).toContain('class="cockpit-anchors"');
    expect(dashboardHtml).toContain('class="top-nav-anchor');
    expect(dashboardHtml).toContain('data-anchor="now-execution-panel"');
    expect(dashboardHtml).toContain('data-anchor="hero-activity"');
    expect(dashboardHtml).toContain('data-anchor="attention-panel"');
    expect(dashboardHtml).toContain('data-anchor="recent-plans-panel"');
    expect(dashboardHtml).toContain("function goCockpitAnchor(");
    expect(dashboardHtml).toMatch(
      /class="header-right"[\s\S]*?id="navMoreBtn"[\s\S]*?id="navMoreMenu"/,
    );
    expect(dashboardHtml).toContain('role="menu"');
    expect(dashboardHtml).toContain("spaceIconSvg('more-sections', { decorative: false })");
    expect(dashboardHtml).toContain("#navMoreMenu .nav-more-item[data-section]");
    // Section icons are injected at runtime; template must not duplicate inline SVG.
    const moreMenuBlock =
      dashboardHtml.match(/id="navMoreMenu"[\s\S]*?id="navSkinsLabel"/)?.[0] ?? "";
    expect(moreMenuBlock.length).toBeGreaterThan(0);
    expect(moreMenuBlock).not.toMatch(/<svg\b/);
    // Nav dots survive only where they signal state (dot semantics table):
    // health (ok/warning/attention) and git (clean/dirty). Terminals and
    // processes carry count badges instead of decorative dots.
    expect(moreMenuBlock).toContain('id="navHealthDot"');
    expect(moreMenuBlock).toContain('id="navGitDot"');
    expect(moreMenuBlock).not.toContain('id="navTerminalsDot"');
    expect(moreMenuBlock).not.toContain('id="navProcessesDot"');
    expect(moreMenuBlock).toContain('id="navTerminalsBadge"');
    expect(moreMenuBlock).toContain('id="navProcessesBadge"');
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
    // Home is the first More-menu item and returns to Overview.
    expect(dashboardHtml).toMatch(
      /id="navMoreMenu"[\s\S]*?data-section="overview"[\s\S]*?data-section="plans"/,
    );
    expect(dashboardHtml).toContain("onclick=\"return showSection('overview')\"");
    expect(dashboardHtml).toContain('aria-label="Home, Overview"');
    expect(dashboardHtml).toMatch(/data-section="overview"[^>]*>[\s\S]*?\bHome\b/);
  });

  it("exposes a primary Home return outside the More menu", () => {
    // Header brand + persistent Home control call goHome → showSection('overview').
    expect(dashboardHtml).toContain('id="headerBrand"');
    expect(dashboardHtml).toContain('id="headerHomeBtn"');
    expect(dashboardHtml).toContain("function goHome()");
    expect(dashboardHtml).toContain("function updateHeaderHomeChrome()");
    expect(dashboardHtml).toContain('onclick="return goHome()"');
    expect(dashboardHtml).toMatch(
      /id="headerBrand"[^>]*aria-label="Home, Overview"|aria-label="Home, Overview"[^>]*id="headerBrand"/,
    );
    expect(dashboardHtml).toMatch(
      /id="headerHomeBtn"[^>]*aria-label="Home, Overview"|aria-label="Home, Overview"[^>]*id="headerHomeBtn"/,
    );
    expect(dashboardHtml).toMatch(
      /class="header-right"[\s\S]*?id="headerHomeBtn"[\s\S]*?id="refreshBtn"[\s\S]*?id="navMoreBtn"/,
    );
    expect(dashboardHtml).toContain("spaceIconSvg('overview', { decorative: true })");
    expect(dashboardHtml).toContain("section-home-back");
    // Overflow Home remains as secondary path.
    expect(dashboardHtml).toMatch(
      /id="navMoreMenu"[\s\S]*?data-section="overview"[\s\S]*?aria-label="Home, Overview"/,
    );
  });

  it("exposes Legacy and Cursor dashboard skins in the More menu with local persistence", () => {
    // Interface Skins group lives in the More menu, separate from Agent Persona packs.
    expect(dashboardHtml).toContain('id="navSkinsLabel"');
    expect(dashboardHtml).toMatch(/navSkinsLabel[\s\S]*?>Skins</);
    expect(dashboardHtml).toContain('data-icon="skins"');
    expect(dashboardHtml).toContain("spaceIconSvg('skins', { decorative: true })");
    expect(dashboardHtml).toContain('data-dashboard-skin-option="legacy"');
    expect(dashboardHtml).toContain('data-dashboard-skin-option="cursor"');
    expect(dashboardHtml).toContain('role="menuitemradio"');
    expect(dashboardHtml).toContain("aria-checked");
    expect(dashboardHtml).toContain("onclick=\"return setDashboardSkin('legacy')\"");
    expect(dashboardHtml).toContain("onclick=\"return setDashboardSkin('cursor')\"");
    // Namespaced localStorage preference; no repo config writes.
    expect(dashboardHtml).toContain("agent-kit:dashboard-skin");
    expect(dashboardHtml).toContain("function applyDashboardSkin(");
    expect(dashboardHtml).toContain("function setDashboardSkin(");
    expect(dashboardHtml).toContain("localStorage.setItem(DASHBOARD_SKIN_KEY");
    expect(dashboardHtml).toContain("localStorage.getItem(key)");
    expect(dashboardHtml).toContain("data-dashboard-skin");
    // Legacy keeps the pre-change palette; Cursor overrides base chrome only.
    expect(dashboardHtml).toContain("--bg-primary: #0b0e14");
    expect(dashboardHtml).toContain('html[data-dashboard-skin="cursor"]');
    expect(dashboardHtml).toContain("--bg-primary: #141414");
    const cursorBlock = dashboardHtml.match(/html\[data-dashboard-skin="cursor"\]\s*\{([^}]+)\}/);
    expect(cursorBlock).not.toBeNull();
    expect(cursorBlock?.[1]).not.toMatch(/--green\s*:/);
    expect(cursorBlock?.[1]).not.toMatch(/--red\s*:/);
    expect(cursorBlock?.[1]).not.toMatch(/--yellow\s*:/);
    expect(cursorBlock?.[1]).not.toMatch(/--blue\s*:/);
    expect(cursorBlock?.[1]).not.toMatch(/--purple\s*:/);
    expect(cursorBlock?.[1]).not.toMatch(/--cyan\s*:/);
    expect(cursorBlock?.[1]).not.toMatch(/--orange\s*:/);
    // Skin options stay in the keyboard-navigable .nav-more-item set.
    expect(dashboardHtml).toMatch(
      /data-dashboard-skin-option="legacy"[^>]*class="nav-more-item"|class="nav-more-item"[^>]*data-dashboard-skin-option="legacy"/,
    );
  });

  it("preserves focus and scroll across SSE re-renders", () => {
    expect(dashboardHtml).toContain("function captureUiState()");
    expect(dashboardHtml).toContain("function restoreUiState(state)");
    expect(dashboardHtml).toContain("data-focus-key");
    expect(dashboardHtml).toContain("openPlanAccordions");
    // Panel inner scroll (.panel-scroll-body) survives live refresh, not only #content.
    expect(dashboardHtml).toContain("function capturePanelScrollOffsets()");
    expect(dashboardHtml).toContain("function restorePanelScrollOffsets(panelScrolls)");
    expect(dashboardHtml).toContain("panelScrolls: capturePanelScrollOffsets()");
    expect(dashboardHtml).toContain("restorePanelScrollOffsets(state.panelScrolls)");
    // Re-open Checklist Actions when the same plan key still exists after render.
    expect(dashboardHtml).toContain("openRecentPlanActionsKey,");
    expect(dashboardHtml).toMatch(
      /state\.openRecentPlanActionsKey[\s\S]*?openRecentPlanActions\(key\)/,
    );
  });

  it("keeps live refresh layout stable without forced content reflow", () => {
    expect(dashboardHtml).not.toContain("contentEl.offsetWidth");
    expect(dashboardHtml).not.toContain("data-refreshing");
    expect(dashboardHtml).not.toContain("header-status-flash");
    expect(dashboardHtml).not.toContain("section-hero.glow");
    expect(dashboardHtml).not.toContain(".count-up");
    expect(dashboardHtml).not.toContain(".section-secondary");
    expect(dashboardHtml).not.toContain(".section-divider");
    expect(dashboardHtml).toMatch(/\.top-tab-badge\s*\{[^}]*font-variant-numeric:\s*tabular-nums/);
  });

  it("keeps keyboard focus visible without blanket outline suppression", () => {
    expect(dashboardHtml).toContain(":focus:not(:focus-visible)");
    expect(dashboardHtml).not.toContain(":focus { outline: none; }");
    expect(dashboardHtml).toContain("button:focus-visible");
    expect(dashboardHtml).toContain('[role="button"]:focus-visible');
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
    // Panel scroll restore must not run while an anchor takeover is active.
    expect(restoreFn?.[0]).toMatch(
      /pendingAnchorScroll\.until[\s\S]*?scrollToCockpitAnchor[\s\S]*?else \{\s*pendingAnchorScroll = null[\s\S]*?restorePanelScrollOffsets/,
    );
    // Manual scrolling releases the takeover instead of fighting the user.
    expect(dashboardHtml).toContain("window.addEventListener('wheel', releaseAnchorScroll");
    expect(dashboardHtml).toContain("window.addEventListener('touchmove', releaseAnchorScroll");
  });

  it("ships empty-state copy for now, activity, attention, and plans", () => {
    expect(dashboardHtml).toContain("function renderEmptyStateCta");
    expect(dashboardHtml).toContain("activity-feed-empty");
    expect(dashboardHtml).toContain("attention-empty");
    // Flight Log empty (Gaps + Warnings + no open triage; attention inbox retired).
    expect(dashboardHtml).toContain("All clear");
    expect(dashboardHtml).toContain("Quiet cockpit. Residuals show up here when Gaps change.");
    expect(dashboardHtml).toContain("function renderFlightLogQuietOpenTriageCard");
    expect(dashboardHtml).toContain("quietOpenTriages");
    expect(dashboardHtml).toContain("Reviews awaiting triage");
    expect(dashboardHtml).toContain("flightLogQuietOpenTriagesCap");
    expect(dashboardHtml).toContain("flightLogKindClassName('prompt')");
    expect(dashboardHtml).toContain("function isFlightLogQuiet(d)");
    expect(dashboardHtml).toContain("function resolveFlightLogCurrent(d)");
    expect(dashboardHtml).toContain("isFlightLogQuiet(d)");
    // Plan:none + Gaps: fingerprint must use the same Gaps fallback as the renderer
    // so quietOpenTriages changes do not flash a non-quiet card (residual B).
    expect(dashboardHtml).toMatch(
      /function resolveFlightLogCurrent\(d\)[\s\S]*?missionControl\?\.now\?\.gaps[\s\S]*?system\?\.handoff\?\.gaps/,
    );
    expect(dashboardHtml).toMatch(
      /function flightLogFingerprint\(d\)[\s\S]*?isFlightLogQuiet\(d\)/,
    );
    // Quiet open-triage stack only inside Gaps+Warnings empty gate (residual E).
    expect(dashboardHtml).toMatch(
      /if\s*\(\s*!hasCurrent\s*&&\s*!hasPast\s*&&\s*!hasWarnings\s*\)\s*\{[\s\S]*?Reviews awaiting triage/,
    );
    expect(dashboardHtml).not.toContain("No pending attention items.");
    expect(dashboardHtml).not.toContain("Review all</button>");
    expect(dashboardHtml).not.toContain("Resolve all</button>");
    // Cap fallback must not hardcode a second SoT literal beside the view field.
    expect(dashboardHtml).not.toMatch(
      /attention\.filter\(\s*\([\s\S]*?kind === 'report'[\s\S]*?\)\.slice\(0,\s*5\)/,
    );
    // Residual E: quietCap ternary must not fall back to literal 5.
    expect(dashboardHtml).not.toMatch(/flightLogQuietOpenTriagesCap[\s\S]{0,220}:\s*5\s*;/);
    expect(dashboardHtml).toMatch(/flightLogQuietOpenTriagesCap[\s\S]{0,220}:\s*0\s*;/);
    expect(dashboardHtml).toContain("No agent activity yet");
    expect(dashboardHtml).toContain("Listening");
    expect(dashboardHtml).toContain("Quiet cockpit");
    expect(dashboardHtml).toContain("No active plan");
    expect(dashboardHtml).toContain("Empty board");
    expect(dashboardHtml).toContain("No plans yet. Copy /start-project");
    expect(dashboardHtml).toContain("Empty hangar");
    expect(dashboardHtml).toContain("No to-dos in this plan");
  });

  it("centers Cockpit section icons in empty-state CTAs via spaceIconSvg", () => {
    expect(dashboardHtml).toContain("empty-state-icon");
    expect(dashboardHtml).toMatch(
      /\.empty-state-cta\s+\.empty-state-icon\s*\{[^}]*justify-content:\s*center/,
    );
    expect(dashboardHtml).toContain("iconKind: 'current-mission'");
    expect(dashboardHtml).toContain("iconKind: 'monitor'");
    expect(dashboardHtml).toContain("iconKind: 'field-report'");
    expect(dashboardHtml).toContain("iconKind: 'checklist'");
    // Four Cockpit heroes + Plans hangar share helper; secondary empties omit iconKind.
    expect(dashboardHtml).toMatch(
      /headline:\s*'Quiet cockpit',\s*\n\s*iconKind:\s*'current-mission'/,
    );
    expect(dashboardHtml).toMatch(/headline:\s*'Listening',\s*\n\s*iconKind:\s*'monitor'/);
    expect(dashboardHtml).toMatch(/headline:\s*'All clear',\s*\n\s*iconKind:\s*'field-report'/);
    expect(dashboardHtml).toMatch(/headline:\s*'Empty board',\s*\n\s*iconKind:\s*'checklist'/);
    expect(dashboardHtml).toMatch(/headline:\s*'Empty hangar',\s*\n\s*iconKind:\s*'checklist'/);
    expect(dashboardHtml).toMatch(
      /headline:\s*'Bare plan',\s*\n\s*support:\s*'No to-dos in this plan\.'/,
    );
    expect(dashboardHtml).not.toMatch(/headline:\s*'Bare plan'[\s\S]{0,80}iconKind:/);
  });

  it("wires empty-state CTAs as copy-only with named paste destinations", () => {
    expect(dashboardHtml).toContain("cta-start-project");
    expect(dashboardHtml).toContain("cta-checklist-start-project");
    expect(dashboardHtml).toContain("cta-plans-start-project");
    expect(dashboardHtml).toContain("cta-agents-path");
    expect(dashboardHtml).toContain("cta-commands-path");
    expect(dashboardHtml).toContain("cta-skills-path");
    expect(dashboardHtml).toContain("cta-dashboard-serve");
    expect(dashboardHtml).toContain("label: 'Copy /start-project'");
    expect(dashboardHtml).toContain("destination: 'chatInput'");
    expect(dashboardHtml).toContain("destination: 'filePicker'");
    expect(dashboardHtml).toContain("destination: 'terminal'");
    // Empty CTA button labels stay clipboard-honest (no Open wording).
    const emptyCtaLabels = [
      "Copy /start-project",
      "Copy .cursor/agents/ path",
      "Copy .cursor/commands/ path",
      "Copy .cursor/skills/ path",
      "Copy serve command",
    ];
    for (const label of emptyCtaLabels) {
      expect(dashboardHtml).toContain(label);
      expect(label).not.toMatch(/\bOpen\b/i);
    }
    // Idle Current mission CTA still targets chatInput via the shared helper.
    expect(dashboardHtml).toMatch(
      /destination:\s*'chatInput',\s*\n\s*label:\s*'Copy \/start-project',\s*\n\s*focusKey:\s*'cta-start-project'/,
    );
  });

  it("renders the Commands tab as an actionable card grid with CRUD CTAs and lock markers", () => {
    // Card grid replaces the flat chip list; decorative row dots stay out.
    expect(dashboardHtml).toContain("command-card");
    expect(dashboardHtml).toContain("command-card-head");
    expect(dashboardHtml).toContain("command-actions");
    expect(dashboardHtml).not.toContain("command-item");
    // Per-card actions are explicit copy-only buttons (clear run/edit/delete affordances).
    expect(dashboardHtml).toContain("Copy run command");
    expect(dashboardHtml).toContain("Copy edit prompt");
    expect(dashboardHtml).toContain("Copy delete prompt");
    // Kit-managed commands get a lock badge and no fake edit/delete affordances.
    expect(dashboardHtml).toContain("command-lock");
    expect(dashboardHtml).toContain("Kit managed");
    expect(dashboardHtml).toContain("read-only here");
    expect(dashboardHtml).toContain("c.kitManaged === true");
    expect(dashboardHtml).toContain('data-kit-managed="true"');
    expect(dashboardHtml).toMatch(/kitManaged\s*\?\s*''\s*:\s*`<button[^`]*Copy edit prompt/);
    expect(dashboardHtml).toMatch(/kitManaged\s*\?\s*''\s*:\s*`<button[^`]*Copy delete prompt/);
    // Create CTA sits on the section header and names the chat input destination.
    expect(dashboardHtml).toContain("command-create-btn");
    expect(dashboardHtml).toContain("cta-command-create");
    expect(dashboardHtml).toContain("Copy create prompt");
    expect(dashboardHtml).toContain("create prompt', 'chatInput'");
    // Edit/delete payloads carry the command file path for the chat agent.
    expect(dashboardHtml).toContain(
      "Edit this slash command file (plain markdown body, no frontmatter):",
    );
    expect(dashboardHtml).toContain("Delete this slash command file after confirming with me:");
    // Subtitle surfaces the editable count next to the total.
    expect(dashboardHtml).toContain("editable</span>");
    expect(dashboardHtml).toContain("commandEditableCount");
  });

  it("renders the Skills tab as an actionable card grid with CRUD CTAs and lock markers", () => {
    // Card grid replaces the flat category chip list; decorative category dots stay out.
    expect(dashboardHtml).toContain("skill-card");
    expect(dashboardHtml).toContain("skill-card-head");
    expect(dashboardHtml).toContain("skill-actions");
    expect(dashboardHtml).not.toContain("skills-category");
    expect(dashboardHtml).not.toContain("skill-tag");
    // Per-card actions are explicit copy-only buttons (clear use/edit/delete affordances).
    expect(dashboardHtml).toContain("Copy use prompt");
    expect(dashboardHtml).toContain("Copy edit prompt");
    expect(dashboardHtml).toContain("Copy delete prompt");
    // Kit-managed skills get a lock badge and no fake edit/delete affordances.
    expect(dashboardHtml).toContain("skill-lock");
    expect(dashboardHtml).toContain("Kit managed");
    expect(dashboardHtml).toContain("read-only here");
    expect(dashboardHtml).toContain("s.kitManaged === true");
    expect(dashboardHtml).toContain('data-kit-managed="true"');
    expect(dashboardHtml).toMatch(/kitManaged\s*\?\s*''\s*:\s*`<button[^`]*Copy edit prompt/);
    expect(dashboardHtml).toMatch(/kitManaged\s*\?\s*''\s*:\s*`<button[^`]*Copy delete prompt/);
    // Create CTA sits on the section header and names the chat input destination.
    expect(dashboardHtml).toContain("skill-create-btn");
    expect(dashboardHtml).toContain("cta-skill-create");
    expect(dashboardHtml).toContain("Copy create prompt");
    expect(dashboardHtml).toContain("create prompt', 'chatInput'");
    // Use/edit/delete payloads carry the skill file or directory path for the chat agent.
    expect(dashboardHtml).toContain("Read this skill file and follow its instructions:");
    expect(dashboardHtml).toContain("Edit this skill file (SKILL.md markdown body):");
    expect(dashboardHtml).toContain("Delete this skill directory after confirming with me:");
    // Subtitle surfaces the editable count next to the total.
    expect(dashboardHtml).toContain("skills · ");
    expect(dashboardHtml).toContain("skillEditableCount");
    // Kit-managed flag is registry-driven in the data layer.
    const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");
    expect(dataSource).toContain("kitSkillDirs");
    expect(dataSource).toMatch(/kitManaged:\s*kitSkillDirs\.has/);
  });

  it("renders the Agents tab as an actionable card grid with CRUD CTAs and lock markers", () => {
    // Card grid replaces the accordion roster; decorative row dots and hash-color icons stay out.
    expect(dashboardHtml).toContain("agent-card");
    expect(dashboardHtml).toContain("agent-card-head");
    expect(dashboardHtml).toContain("agent-actions");
    expect(dashboardHtml).not.toContain("agent-item");
    expect(dashboardHtml).not.toContain("agent-details");
    expect(dashboardHtml).not.toContain("agent-icon");
    expect(dashboardHtml).not.toContain("toggleAgentDetails");
    // Per-card actions are explicit copy-only buttons (clear use/edit/delete affordances).
    expect(dashboardHtml).toContain("Copy use prompt");
    expect(dashboardHtml).toContain("Copy edit prompt");
    expect(dashboardHtml).toContain("Copy delete prompt");
    // Kit-managed agents get a lock badge and no fake edit/delete affordances.
    expect(dashboardHtml).toContain("agent-lock");
    expect(dashboardHtml).toContain("Kit managed");
    expect(dashboardHtml).toContain("read-only here");
    expect(dashboardHtml).toContain("a.kitManaged === true");
    expect(dashboardHtml).toContain('data-kit-managed="true"');
    expect(dashboardHtml).toMatch(/kitManaged\s*\?\s*''\s*:\s*`<button[^`]*Copy edit prompt/);
    expect(dashboardHtml).toMatch(/kitManaged\s*\?\s*''\s*:\s*`<button[^`]*Copy delete prompt/);
    // Create CTA sits on the section header and names the chat input destination.
    expect(dashboardHtml).toContain("agent-create-btn");
    expect(dashboardHtml).toContain("cta-agent-create");
    expect(dashboardHtml).toContain("Copy create prompt");
    // Use/edit/delete payloads carry the agent file path for the chat agent.
    expect(dashboardHtml).toContain("Use this agent definition when it matches the task:");
    expect(dashboardHtml).toContain("Edit this agent definition file (markdown body):");
    expect(dashboardHtml).toContain("Delete this agent definition file after confirming with me:");
    // Subtitle surfaces the editable count next to the total.
    expect(dashboardHtml).toContain("agents · ");
    expect(dashboardHtml).toContain("agentEditableCount");
    // Neutral identity monogram per card (initials, no rainbow hash colors).
    expect(dashboardHtml).toContain("agent-monogram");
    expect(dashboardHtml).not.toContain("'#3b82f6','#a855f7','#22c55e'");
    // Kit-managed flag is registry-driven in the data layer.
    const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");
    expect(dataSource).toContain("kitAgentPaths");
    expect(dataSource).toMatch(/a\.kitManaged\s*=\s*kitAgentPaths\.has/);
  });

  it("renders Crew Monitor rows as badge-first timestamped rows with no kind glyph", () => {
    // Per entry: team badge at row start + actor + verb + primary + refs + time.
    expect(dashboardHtml).not.toContain("monitor-row-avatar");
    // agentInitials survives for the Agents card monogram; the Crew row monograms
    // a spaced display role instead, so the two must stay separate functions.
    expect(dashboardHtml).toContain("function agentInitials(id)");
    expect(dashboardHtml).toContain("function crewActorInitials(role)");
    expect(dashboardHtml).toContain("function crewEventActor(ev)");
    expect(dashboardHtml).toContain("function crewEventTime(ev, info)");
    expect(dashboardHtml).toContain("function parseCrewRow(ev)");
    // WIRE resolution is unchanged and still mirrors briefActivityActor():
    // kit agent, else Eng (delivery), else SQ when a plan is present, else Eng.
    // The lexicon is a display layer on top; it must not be folded in here.
    expect(dashboardHtml).toContain("if (ev && ev.agent) return String(ev.agent);");
    expect(dashboardHtml).toContain("if (ev && ev.kind === 'delivery') return 'Eng';");
    expect(dashboardHtml).toContain("if (ev && ev.refs && ev.refs.plan) return 'SQ';");
    expect(dashboardHtml).toContain("return 'Eng';");
    // Display masks live in a map, never as returns out of crewEventActor.
    expect(dashboardHtml).not.toContain("return 'Engineering Manager';");
    expect(dashboardHtml).not.toContain("return 'Platform Engineer';");
    expect(dashboardHtml).not.toContain("return 'Squad';");
    // The v1 segment row is gone: no equal-shrink spans, no separator spans.
    expect(dashboardHtml).not.toContain("feed-seg-actor");
    expect(dashboardHtml).not.toContain("feed-seg-verb");
    expect(dashboardHtml).not.toContain("feed-seg-plan");
    expect(dashboardHtml).not.toContain("feed-seg-mid");
    expect(dashboardHtml).not.toContain('<span class="feed-sep" aria-hidden="true"> · </span>');
    // Label parsing and the truncation-safe plan ref survive the rewrite.
    expect(dashboardHtml).toContain(".split(' · ')");
    expect(dashboardHtml).toContain("ev.labelFull || ev.label || ''");
    expect(dashboardHtml).toContain("ev.refs && ev.refs.plan");
    // Row order + structural pin: badge is a row sibling at row start.
    expectBadgeIsRowSiblingBeforeActor(dashboardHtml);
    // Timestamp fallback: first-seen stamp when the emitter omits `at`.
    expect(dashboardHtml).toContain("semanticSeenAt.get(ev.id)");
    expect(dashboardHtml).toContain("${crewEventTime(ev, info)}");
    // Inside the Crew Monitor block, info.bg is interpolated exactly once: the
    // team badge tint. It must not spread to a row background or a second chip.
    // (The Activity tab's .activity-icon has its own, deliberate, tint.)
    expect(crewMonitorFeedBlock(dashboardHtml).match(/\$\{info\.bg\}/g)?.length ?? 0).toBe(1);
  });

  it("splits the Eng collision into distinct display roles without a wire change", () => {
    // Six consecutive `Eng · merged` rows were the worst case in the shipped
    // feed. `kind` carries the split; no new emitted field is required, and the
    // frozen label contract keeps the raw token in labelFull.
    expect(dashboardHtml).toContain("function crewActorEngRole(ev)");
    expect(dashboardHtml).toContain(
      "return ev && ev.kind === 'delivery' ? 'DevOps' : 'Tech Lead';",
    );
    expect(dashboardHtml).toContain("function crewActorRole(ev, raw)");
    // Resolution order: per-event role -> Eng split -> mask -> raw token.
    expect(dashboardHtml).toMatch(
      /function crewActorRole\(ev, raw\) \{[\s\S]*?if \(ev && ev\.role\) return String\(ev\.role\);[\s\S]*?if \(token === 'Eng'\) return crewActorEngRole\(ev\);[\s\S]*?return CREW_ACTOR_MASK\[token\] \|\| token;/,
    );
    // Closed-set and open-set masks, per the operator lexicon.
    for (const [wire, role] of [
      ["'docs-repo'", "Tech Writer"],
      ["explore", "Product Analyst"],
      ["generalPurpose", "Analyst"],
      ["SQ", "Scrum Master"],
      ["Dev", "Developer"],
      ["PO", "Product Owner"],
      ["PM", "Project Manager"],
    ] as const) {
      expect(dashboardHtml).toMatch(new RegExp(`${wire}:\\s*'${role}'`));
    }
    // Initials overrides: Developer and DevOps would otherwise collide on DE.
    expect(dashboardHtml).toContain("{ Developer: 'DV', DevOps: 'DO' }");
    // Kind glosses follow the same lexicon (badge tooltip is the kind cue now).
    expect(dashboardHtml).toMatch(/run_plan:.*gloss: 'Project Manager - live execution'/);
    expect(dashboardHtml).toMatch(/handoff:.*gloss: 'Project Manager - awaiting gate'/);
    expect(dashboardHtml).toMatch(/agent_step:.*gloss: 'Developer - task unit'/);
    expect(dashboardHtml).toMatch(/plan_progress:.*gloss: 'Product Owner - milestone'/);
    expect(dashboardHtml).toMatch(/subagent:.*gloss: 'Developer - subagent run'/);
    // The short masks must not leak back into a rendered role.
    expect(dashboardHtml).not.toMatch(/gloss: 'PM - /);
    expect(dashboardHtml).not.toMatch(/gloss: 'Dev - /);
    expect(dashboardHtml).not.toMatch(/gloss: 'PO - /);
  });

  it("holds Crew Monitor columns steady with one flexible field per row", () => {
    // The layout contract that replaced the equal-shrink segment row: exactly
    // one field may ellipsis. A second one reintroduces the fragment bug.
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-primary\s*\{[^}]*flex:\s*1 1 auto/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-primary\s*\{[^}]*text-overflow:\s*ellipsis/,
    );
    // Column stability: fixed bases, not min-width floors a long id can push past.
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-badge\s*\{[^}]*flex:\s*0 0 18px/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-actor\s*\{[^}]*flex:\s*0 0 9\.5em/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-verb\s*\{[^}]*flex:\s*0 0 6\.5em/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-time\s*\{[^}]*text-align:\s*right/,
    );
    // Ref chips are fixed content: they may never ellipsis (half a SHA is worse
    // than no SHA), so nowrap is the pin and text-overflow must stay off them.
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-ref\s*\{[^}]*white-space:\s*nowrap/,
    );
    expect(dashboardHtml).not.toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-ref\s*\{[^}]*text-overflow/,
    );
  });

  it("compacts the Crew row by container width, dropping whole fields only", () => {
    // Container queries, not viewport media queries: the Crew Monitor sits in a
    // 2x2 cockpit grid and a narrow plugin shell, so the feed's own width is the
    // one that matters.
    expect(dashboardHtml).toMatch(/\.monitor-cq\s*\{[^}]*container-type:\s*inline-size/);
    expect(dashboardHtml).toContain('class="live-activity-feed monitor-cq"');
    // The ladder, in order. Every step hides a field whole.
    expect(dashboardHtml).toMatch(
      /@container \(max-width: 720px\) \{[^}]*\.monitor-row-plan-name \{ display: none/,
    );
    expect(dashboardHtml).toMatch(
      /@container \(max-width: 560px\) \{[\s\S]*?\.monitor-row-ref\.ref-sha \{ display: none/,
    );
    expect(dashboardHtml).toMatch(
      /@container \(max-width: 450px\) \{[\s\S]*?\.monitor-row-verb em \{ display: none/,
    );
    expect(dashboardHtml).toMatch(
      /@container \(max-width: 360px\) \{[\s\S]*?\.monitor-row-meta \{ display: none/,
    );
    // Delta A: the actor drops WHOLE at ≤560px. Narrowing its basis while it
    // still ellipsises would render `Project Man…` — the exact fragment failure
    // the redesign exists to remove, reintroduced by the compaction ladder.
    expect(dashboardHtml).toMatch(
      /@container \(max-width: 560px\) \{[\s\S]*?\.monitor-row-actor \{ display: none/,
    );
    expect(dashboardHtml).not.toMatch(/\.monitor-row-actor \{ flex-basis: 6\.5em/);
    expect(dashboardHtml).not.toMatch(/\.monitor-row-actor \{ flex-basis: 5\.5em/);
    // Delta C: the plan chip is fixed content. A width cap plus ellipsis on it
    // clipped real basenames at FULL width (271px of name against a 240px cap),
    // which is the fragment bug reappearing on the widest layout.
    expect(dashboardHtml).not.toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-plan-name\s*\{[^}]*max-width/,
    );
    expect(dashboardHtml).not.toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-plan-name\s*\{[^}]*text-overflow/,
    );
    // The superseded viewport rule must not come back alongside the ladder.
    expect(dashboardHtml).not.toMatch(/@media[\s\S]{0,400}\.monitor-row \.feed-seg-actor/);
  });

  it("offers compact and comfortable Crew Monitor density with a viewport auto-pick", () => {
    // Root data attribute restored before first paint, like the skin preference.
    expect(dashboardHtml).toContain("agent-kit:monitor-density");
    expect(dashboardHtml).toContain("data-monitor-density");
    expect(dashboardHtml).toContain("const MONITOR_DENSITIES = ['compact', 'comfortable']");
    expect(dashboardHtml).toContain("function autoMonitorDensity()");
    expect(dashboardHtml).toContain("function applyMonitorDensity(density, opts)");
    expect(dashboardHtml).toContain("function toggleMonitorDensity()");
    // Auto-pick threshold lives in one named constant, not a bare literal.
    expect(dashboardHtml).toContain("const MONITOR_DENSITY_COMFORTABLE_MIN_WIDTH = 900");
    expect(dashboardHtml).toMatch(
      /\(window\.innerWidth \|\| 0\) >= MONITOR_DENSITY_COMFORTABLE_MIN_WIDTH/,
    );
    // Blocked storage must degrade, never throw (private mode).
    expect(dashboardHtml).toMatch(
      /function getStoredMonitorDensity\(\) \{[\s\S]*?catch \(e\) \{[\s\S]*?return null;/,
    );
    // Operator control in the Crew Monitor header, with pressed state.
    expect(dashboardHtml).toContain("data-monitor-density-toggle");
    expect(dashboardHtml).toContain('onclick="toggleMonitorDensity()"');
    expect(dashboardHtml).toMatch(/aria-pressed="\$\{currentMonitorDensity\(\)/);
    // Comfortable is a second layout, not a taller first one: the row wraps and
    // the primary field reflows to a clamped full-width second line.
    expect(dashboardHtml).toMatch(
      /html\[data-monitor-density="comfortable"\] \.live-activity-feed \.monitor-row\s*\{[^}]*flex-wrap:\s*wrap/,
    );
    expect(dashboardHtml).toMatch(
      /html\[data-monitor-density="comfortable"\] \.live-activity-feed \.monitor-row \.monitor-row-primary\s*\{[^}]*flex:\s*1 0 100%/,
    );
    expect(dashboardHtml).toMatch(
      /html\[data-monitor-density="comfortable"\] \.live-activity-feed \.monitor-row \.monitor-row-primary\s*\{[^}]*-webkit-line-clamp:\s*2/,
    );
    expect(dashboardHtml).toMatch(
      /html\[data-monitor-density="comfortable"\] \.live-activity-feed \.monitor-row \.monitor-row-primary\s*\{[^}]*white-space:\s*normal/,
    );
    // Compact keeps the single-line ellipsis contract on the same field.
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-primary\s*\{[^}]*white-space:\s*nowrap/,
    );
    // The title tooltip is required in BOTH modes: display label is still capped
    // at MAX_SEMANTIC_LABEL upstream, so a second line is not a substitute for
    // it. It rides on the primary span, because an actionable row's own title is
    // already taken by the copy-path/copy-sha affordance and a duplicate title
    // attribute on one element is silently dropped.
    expect(dashboardHtml).toContain(
      '<span class="monitor-row-primary" title="${escapeAttr(feedTitle)}">${escapeHtml(row.primary)}</span>',
    );
    expect(dashboardHtml).toContain("const rowTitle = actionAttrs ? '' :");
    expect(dashboardHtml).toContain("ev.sourcePath ? `\\n${ev.sourcePath}` : ''");
  });

  it("keeps the Activity tab on the plain activity-label (no Crew row columns)", () => {
    // Contract: Crew Monitor row columns stay scoped; Activity tab is plain.
    expect(dashboardHtml).toContain('id="section-activity"');
    expect(dashboardHtml).toContain('<span class="activity-label">${escapeHtml(ev.label)}</span>');
    expect(dashboardHtml).not.toMatch(
      /id="section-activity"[\s\S]*monitor-row-primary[\s\S]*<\/div>\s*<\/div>\s*`/,
    );
    // Crew CSS must stay under .live-activity-feed .monitor-row, not .activity-label.
    expect(dashboardHtml).toMatch(/\.live-activity-feed \.monitor-row \.monitor-row-plan/);
    expect(dashboardHtml).not.toMatch(/\.activity-label[\s\S]{0,80}monitor-row-/);
    // The Activity tab keeps the kind glyph the Crew row dropped, so semanticEventInfo
    // must keep emitting icons even though no Crew row renders one.
    expect(dashboardHtml).toMatch(/function activityEventInfo\(ev\)/);
    expect(dashboardHtml).toMatch(/run_plan:\s+\{ icon: '\\u25b6'/);
  });

  it("renders Flight Log Gaps stack (live + earlier) without Field Report review CTAs", () => {
    expect(dashboardHtml).toContain("function renderFlightLogCard(entry, idx)");
    expect(dashboardHtml).toContain("function renderAttentionPanel(d, attentionChanged)");
    expect(dashboardHtml).toContain("flight-log-stack");
    expect(dashboardHtml).toContain("flight-log-card-current");
    expect(dashboardHtml).toContain("flight-log-card-past");
    expect(dashboardHtml).toContain("flight-log-kind-residual");
    expect(dashboardHtml).toContain("flight-log-kind-advice");
    expect(dashboardHtml).toContain("flight-log-kind-ok");
    expect(dashboardHtml).toContain("data-flight-log-kind");
    expect(dashboardHtml).toContain("function flightLogMessageKind(text, opts");
    expect(dashboardHtml).toContain("'NOW'");
    expect(dashboardHtml).toContain("'Earlier'");
    expect(dashboardHtml).toContain("variant === 'current' ? 'NOW' : 'Earlier'");
    // Quiet placeholder (past empty, warnings present): label + a11y stay NOW, not Live.
    expect(dashboardHtml).toContain('<span class="flight-log-card-label">NOW</span>');
    expect(dashboardHtml).toContain('aria-label="No Gaps now"');
    expect(dashboardHtml).not.toContain('aria-label="No live Gaps"');
    expect(dashboardHtml).not.toContain("Current Gaps");
    expect(dashboardHtml).not.toContain("Past Gaps");
    expect(dashboardHtml).not.toContain("Copy text");
    expect(dashboardHtml).toContain("flight-log-action-");
    expect(dashboardHtml).not.toContain("Review all</button>");
    expect(dashboardHtml).not.toContain("Resolve all</button>");
    expect(dashboardHtml).not.toContain("vscode://");
    expect(dashboardHtml).not.toContain("cursor://");
  });

  it("behaviourally exercises Flight Log quiet-gate helpers (five monitor scenarios)", () => {
    const sources = [
      /function resolveFlightLogCurrent\(d\) \{[\s\S]*?\n\}/,
      /function flightLogHasPastEntries\(fl\) \{[\s\S]*?\n\}/,
      /function flightLogHasWarningEntries\(fl\) \{[\s\S]*?\n\}/,
      /function isFlightLogQuiet\(d\) \{[\s\S]*?\n\}/,
    ].map((re) => {
      const match = dashboardHtml.match(re);
      expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
      return match?.[0];
    });
    const {
      resolveFlightLogCurrent,
      flightLogHasPastEntries,
      flightLogHasWarningEntries,
      isFlightLogQuiet,
    } = new Function(
      `${sources.join("\n")}\nreturn { resolveFlightLogCurrent, flightLogHasPastEntries, flightLogHasWarningEntries, isFlightLogQuiet };`,
    )() as {
      resolveFlightLogCurrent: (d: unknown) => string | null;
      flightLogHasPastEntries: (fl: unknown) => boolean;
      flightLogHasWarningEntries: (fl: unknown) => boolean;
      isFlightLogQuiet: (d: unknown) => boolean;
    };

    // 1) Plan:none + handoff Gaps → residual-B case (not quiet; current from handoff)
    const handoffGaps = {
      system: { handoff: { gaps: "Need triage on shell quote strip" } },
      missionControl: { flightLog: { current: null, past: [], warnings: [] } },
    };
    expect(isFlightLogQuiet(handoffGaps)).toBe(false);
    expect(resolveFlightLogCurrent(handoffGaps)).toBe("Need triage on shell quote strip");

    // 2) Genuinely quiet
    const quiet = {
      missionControl: { flightLog: { current: null, past: [], warnings: [] } },
    };
    expect(isFlightLogQuiet(quiet)).toBe(true);
    expect(resolveFlightLogCurrent(quiet)).toBeNull();

    // 3) Gaps from missionControl.now (first fallback rung)
    const nowGaps = {
      missionControl: {
        now: { gaps: "API/usage limit hard stop" },
        flightLog: { current: null, past: [], warnings: [] },
      },
    };
    expect(isFlightLogQuiet(nowGaps)).toBe(false);
    expect(resolveFlightLogCurrent(nowGaps)).toBe("API/usage limit hard stop");

    // 4) Past entries present → not quiet; no current
    const withPast = {
      missionControl: {
        flightLog: {
          current: null,
          past: [{ text: "Earlier residual closed" }],
          warnings: [],
        },
      },
    };
    expect(isFlightLogQuiet(withPast)).toBe(false);
    expect(resolveFlightLogCurrent(withPast)).toBeNull();
    expect(flightLogHasPastEntries(withPast.missionControl.flightLog)).toBe(true);

    // 5) Text-less warning dropped (mirrors render-side filter) → quiet
    const textlessWarning = {
      missionControl: {
        flightLog: {
          current: null,
          past: [],
          warnings: [{ kind: "cadence", text: "   " }],
        },
      },
    };
    expect(flightLogHasWarningEntries(textlessWarning.missionControl.flightLog)).toBe(false);
    expect(isFlightLogQuiet(textlessWarning)).toBe(true);
    expect(resolveFlightLogCurrent(textlessWarning)).toBeNull();
  });

  it("pins Flight Log OK-normalize regex parity and CSS kind rules", () => {
    // Shared classifier rule groups must stay aligned across semantic-model.mjs
    // classifyFlightLogMessageKind and the inline dashboard.html flightLogMessageKind
    // (close-queue F1 / residual F). Scope to classifier bodies so normalizeHandoffGaps
    // copies cannot satisfy the .mjs half.
    const semanticModel = readFileSync(
      resolve(repoRoot, "dashboard/lib/semantic-model.mjs"),
      "utf8",
    );
    const classifyStart = semanticModel.indexOf("export function classifyFlightLogMessageKind");
    expect(classifyStart).toBeGreaterThanOrEqual(0);
    const classifyEnd = semanticModel.indexOf(
      "\nexport function flightLogKindClass",
      classifyStart,
    );
    expect(classifyEnd).toBeGreaterThan(classifyStart);
    const classifyBody = semanticModel.slice(classifyStart, classifyEnd);

    const htmlKindStart = dashboardHtml.indexOf("function flightLogMessageKind(text");
    expect(htmlKindStart).toBeGreaterThanOrEqual(0);
    const htmlKindEnd = dashboardHtml.indexOf("\nfunction flightLogKindClassName", htmlKindStart);
    expect(htmlKindEnd).toBeGreaterThan(htmlKindStart);
    const htmlKindBody = dashboardHtml.slice(htmlKindStart, htmlKindEnd);

    const sharedLiterals = [
      "/^(none|n\\/a)$/i",
      "/^(none|n\\/a)\\s*[.:,;\\/(\\-–—…]/i",
      "/^([-–—.…]|empty|no gaps?|cleared|all clear|ok)$/i",
      "/\\bAPI\\s*\\/\\s*usage\\s+limit\\b|\\bAPI\\s+usage\\s+limit\\b|\\bSTOPPED:\\s*API\\b/i",
      "/\\b(hard.?stop|quota\\s+pause)\\b/i",
      "/\\b(confirm|ask questions|hitl|\\bpaste\\b|choose\\b|approve\\b|operator yes)\\b/i",
      "/\\b(tip:|advice:|consider\\b|recommends?\\b|recommended\\b|prefer\\b)/i",
    ];
    for (const lit of sharedLiterals) {
      expect(classifyBody).toContain(lit);
      expect(htmlKindBody).toContain(lit);
    }

    // CSS rules must exist for every emitted kind class on Live + Earlier (monitor E).
    for (const kind of ["residual", "advice", "ok", "warning"] as const) {
      expect(dashboardHtml).toContain(`.flight-log-card-current.flight-log-kind-${kind}`);
      expect(dashboardHtml).toContain(`.flight-log-card-past.flight-log-kind-${kind}`);
    }
  });

  it("pins Flight Log kind-aware hover/focus chrome (not yellow-only via unset --accent)", () => {
    // Regression: shared hover must not fall back to yellow via unset --accent (whitespace-tolerant).
    expect(dashboardHtml).not.toMatch(
      /border-color:\s*var\(\s*--accent\s*,\s*var\(\s*--yellow\s*\)\s*\)\s*;/,
    );
    expect(dashboardHtml).not.toMatch(
      /outline:\s*2px\s+solid\s+var\(\s*--accent\s*,\s*var\(\s*--yellow\s*\)\s*\)\s*;/,
    );
    // Base fallback must stay visible (not same as rest border ≈1.1:1).
    expect(dashboardHtml).toMatch(
      /\.flight-log-card:hover,\s*\n\.flight-log-card:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--border-active\)/,
    );

    const kindHoverTokens: Array<{ kind: string; token: string }> = [
      { kind: "ok", token: "var(--green)" },
      { kind: "advice", token: "var(--blue)" },
      { kind: "residual", token: "var(--yellow)" },
      { kind: "warning", token: "var(--orange, var(--yellow))" },
    ];
    for (const { kind, token } of kindHoverTokens) {
      expect(dashboardHtml).toContain(`.flight-log-card-current.flight-log-kind-${kind}:hover`);
      expect(dashboardHtml).toContain(
        `.flight-log-card-current.flight-log-kind-${kind}:focus-visible`,
      );
      expect(dashboardHtml).toContain(`.flight-log-card-past.flight-log-kind-${kind}:hover`);
      expect(dashboardHtml).toContain(
        `.flight-log-card-past.flight-log-kind-${kind}:focus-visible`,
      );
      // NOW (current) hover/focus outline + border follow the kind palette token.
      const liveHoverBlock = dashboardHtml.match(
        new RegExp(
          `\\.flight-log-card-current\\.flight-log-kind-${kind}:hover,\\s*` +
            `\\.flight-log-card-current\\.flight-log-kind-${kind}:focus-visible\\s*\\{[^}]+\\}`,
        ),
      );
      expect(liveHoverBlock?.[0]).toContain(`outline-color: ${token}`);
      expect(liveHoverBlock?.[0]).toContain(`border-color: ${token}`);
      // Earlier: muted color-mix on hover; full kind token on keyboard focus.
      const pastHoverBlock = dashboardHtml.match(
        new RegExp(`\\.flight-log-card-past\\.flight-log-kind-${kind}:hover\\s*\\{[^}]+\\}`),
      );
      expect(pastHoverBlock?.[0]).toMatch(/outline-color:\s*color-mix\(/);
      expect(pastHoverBlock?.[0]).toMatch(/border-color:\s*color-mix\(/);
      const pastFocusBlock = dashboardHtml.match(
        new RegExp(
          `\\.flight-log-card-past\\.flight-log-kind-${kind}:focus-visible\\s*\\{[^}]+\\}`,
        ),
      );
      expect(pastFocusBlock?.[0]).toContain(`outline-color: ${token}`);
    }
    expect(dashboardHtml).toContain(".flight-log-card-warning:hover");
    expect(dashboardHtml).toContain(".flight-log-card-warning:focus-visible");

    // Every flight-log-card root template emits a kind class or the warning class.
    const cardRoots = [
      ...dashboardHtml.matchAll(/(?:class="|`)flight-log-card(?![a-z-])[^"'`]*/g),
    ].map((m) => m[0]);
    expect(cardRoots.length).toBeGreaterThan(0);
    for (const tpl of cardRoots) {
      expect(/flight-log-kind-|flight-log-card-warning|\$\{kindClass\}/.test(tpl)).toBe(true);
    }
  });

  it("renders Flight Log operator Warnings lane without cadence Review/Resolve CTAs", () => {
    expect(dashboardHtml).toContain("function renderFlightLogWarningCard(warning, idx)");
    expect(dashboardHtml).toContain("flight-log-warnings");
    expect(dashboardHtml).toContain("flight-log-card-warning");
    expect(dashboardHtml).toContain("fl?.warnings");
    expect(dashboardHtml).not.toContain("Review all</button>");
    expect(dashboardHtml).not.toContain("Resolve all</button>");
    expect(dashboardHtml).not.toContain("attention:cadence:");
  });

  it("uses clipboard glyph for Flight Log icon (not PTT radio)", () => {
    // Clipboard board + clip; reject retired PTT side paddle path.
    expect(dashboardHtml).toMatch(
      /'field-report':\s*\n\s*'<rect x="4\.5" y="3\.5" width="7" height="10"/,
    );
    expect(dashboardHtml).toContain("Clipboard (Flight Log)");
    expect(dashboardHtml).not.toContain("H3.2v3.5H5");
    expect(dashboardHtml).not.toContain("PTT paddle");
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

  it("uses a green executing badge without glow or companion status dot", () => {
    // Executing cue is green fill + ▶ mark (not blue, not glow/pulse).
    expect(dashboardHtml).toMatch(/\.now-status-executing\s*\{[^}]*var\(--green\)/);
    expect(dashboardHtml).not.toMatch(/\.now-status-executing\s*\{[^}]*var\(--blue\)/);
    expect(dashboardHtml).not.toMatch(/\.now-status-executing\s*\{[^}]*box-shadow/);
    expect(dashboardHtml).not.toContain("@keyframes now-status-live-pulse");
    expect(dashboardHtml).not.toMatch(/\.now-status-live\s*\{/);
    expect(dashboardHtml).not.toContain("live: true");
    // Companion status dot beside the badge is gone from the current-work header.
    const nowStatusMetaFn = dashboardHtml.match(/function nowStatusMeta\([\s\S]*?\n\}/);
    expect(nowStatusMetaFn).not.toBeNull();
    expect(nowStatusMetaFn?.[0]).not.toContain("dot:");
    expect(nowStatusMetaFn?.[0]).toContain("live: false");
    expect(nowStatusMetaFn?.[0]).not.toContain("live: true");
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    expect(nowPanelFn?.[0]).not.toMatch(/class="dot \$\{meta\.dot\}"/);
    expect(nowPanelFn?.[0]).not.toContain("meta.dot");
    // Non-executing states stay distinct via mark + shape, not color alone.
    expect(dashboardHtml).toContain("mark: '\\u25B6'");
    expect(dashboardHtml).toContain("mark: '\\u23EF'");
    expect(dashboardHtml).toContain("mark: '\\u2713'");
    expect(dashboardHtml).toContain("mark: '\\u25CB'");
    expect(dashboardHtml).toMatch(/\.now-status-completed\s*\{[^}]*var\(--green\)/);
    // border-radius inherited from .now-status (--mc-radius-chrome, design v2);
    // no explicit idle override. Idle's non-color cue is the ○ mark alone now
    // that the radius no longer separates it from the solid chips.
    expect(dashboardHtml).toMatch(
      /\.now-status\s*\{[^}]*border-radius:\s*var\(--mc-radius-chrome\)/,
    );
    expect(dashboardHtml).not.toMatch(/\.now-status-idle\s*\{[^}]*border-radius/);
  });

  it("shimmers the current stepbar segment under prefers-reduced-motion no-preference", () => {
    expect(dashboardHtml).toContain("@keyframes now-stepbar-shimmer");
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.now-stepbar-seg-current\s*\{[\s\S]*?animation:\s*now-stepbar-shimmer/,
    );
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.now-stepbar-seg-current[\s\S]*?animation:\s*none !important/,
    );
  });

  it("shows portfolio progress bars with executing-only reduced-motion-safe shimmer", () => {
    expect(dashboardHtml).toContain("@keyframes plan-progress-shimmer");
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: no-preference\)[\s\S]*?\.plan-progress-fill\.is-executing\s*\{[\s\S]*?animation:\s*plan-progress-shimmer/,
    );
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.plan-progress-fill\.is-executing,[\s\S]*?animation:\s*none !important/,
    );

    const checklistRenderer = dashboardHtml.match(
      /function renderRecentPlanCards\([\s\S]*?(?=\nfunction renderPlansAccordion)/,
    )?.[0];
    const plansRenderer = dashboardHtml.match(
      /function renderPlansAccordion\([\s\S]*?(?=\nfunction \w+)/,
    )?.[0];
    expect(checklistRenderer).toContain('class="progress-bar plan-progress-bar"');
    expect(checklistRenderer).toContain('style="width:${pct}%"');
    expect(checklistRenderer).toContain("${life.key === 'executing' ? ' is-executing' : ''}");
    expect(plansRenderer).toMatch(
      /class="plan-accordion-trigger"[\s\S]*?class="progress-bar plan-progress-bar"[\s\S]*?<\/button>/,
    );
    expect(plansRenderer).toContain("${life.key === 'executing' ? ' is-executing' : ''}");
    expect(plansRenderer).not.toMatch(
      /class="plan-accordion-panel"[\s\S]*?class="progress-bar plan-progress-bar"/,
    );
    // Shimmer keys on lifecycle only — queueRole never attaches is-executing
    // (queue-mode COMPLETED + EXECUTING dual pills must not shimmer a done bar).
    expect(dashboardHtml).not.toMatch(/queueRole[^\n]*is-executing/);
  });

  it("renders a readable 6px progress track with non-error fill colors", () => {
    // Track must stay visibly a track at 0% (Phase 0 contract item 5):
    // 6px var(--border-active) with rounded ends, not the old 4px
    // var(--border) hairline that vanished against the card background.
    const track = dashboardHtml.match(/\.progress-bar\s*\{([^}]+)\}/)?.[1];
    expect(track).toBeTruthy();
    expect(track).toContain("height: 6px");
    expect(track).toContain("background: var(--border-active)");
    expect(track).toContain("border-radius: 3px");
    expect(track).not.toContain("height: 4px");
    // Progress is never an error signal: green only at 100%, neutral blue
    // otherwise — no red/yellow low-progress branches.
    const colorFn = dashboardHtml.match(/function progressColor\(pct\)\s*\{([\s\S]*?)\n\}/)?.[1];
    expect(colorFn).toBeTruthy();
    expect(colorFn).toContain("return pct >= 100 ? 'green' : 'blue';");
    expect(colorFn).not.toContain("red");
    expect(colorFn).not.toContain("yellow");
  });

  it("renders current-mission status badges as solid fills with no outline", () => {
    const base = dashboardHtml.match(/\.now-status\s*\{([^}]+)\}/);
    expect(base).not.toBeNull();
    expect(base?.[1]).toMatch(/border:\s*none/);
    expect(base?.[1]).not.toMatch(/border:\s*1px\s+solid/);
    expect(base?.[1]).toMatch(/background:\s*var\(--bg-card\)/);
    // Visual casing is CSS uppercase; nowStatusMeta labels stay Title Case.
    expect(base?.[1]).toMatch(/text-transform:\s*uppercase/);
    for (const [key, color] of [
      ["executing", "green"],
      ["awaiting", "yellow"],
      ["completed", "green"],
    ] as const) {
      expect(dashboardHtml, `.now-status-${key} must use a solid ${color} surface`).toMatch(
        new RegExp(`\\.now-status-${key}\\s*\\{[^}]*background:\\s*var\\(--${color}-bg\\)`),
      );
      expect(dashboardHtml).not.toMatch(
        new RegExp(`\\.now-status-${key}\\s*\\{[^}]*border-(style|color):`),
      );
    }
    // Idle keeps the pill radius as its shape cue on a filled surface.
    expect(dashboardHtml).toMatch(/\.now-status-idle\s*\{[^}]*background:\s*var\(--bg-card\)/);
    // Executing glow/pulse is gone; solid fill only (no live-pulse keyframes).
    expect(dashboardHtml).not.toContain("@keyframes now-status-live-pulse");
    expect(dashboardHtml).not.toMatch(/\.now-status-executing\s*\{[^}]*box-shadow/);
  });

  it("pins the busy-outside-plan chip chrome on Current mission and Flight Log", () => {
    // Advice-family blue tokens on the pinned pill ladder; text-only (no dot, no icon).
    expect(dashboardHtml).toMatch(/\.mc-busy-chip\s*\{[^}]*color:\s*var\(--blue\)/);
    expect(dashboardHtml).toMatch(/\.mc-busy-chip\s*\{[^}]*background:\s*var\(--blue-bg\)/);
    expect(dashboardHtml).toMatch(
      /\.mc-busy-chip\s*\{[^}]*border-radius:\s*var\(--mc-radius-chrome\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.mc-busy-chip\s*\{[^}]*font-size:\s*var\(--mc-chrome-meta-size\)/,
    );
    expect(dashboardHtml).not.toMatch(/\.mc-busy-chip\s*\{[^}]*box-shadow/);
    expect(dashboardHtml).not.toMatch(/\.mc-busy-chip[^{]*:hover/);
    const chipFn = dashboardHtml.match(/function renderBusyOutsideChip\([\s\S]*?\n\}/);
    expect(chipFn).not.toBeNull();
    expect(chipFn?.[0]).toContain("busyOutsidePlan?.active");
    expect(chipFn?.[0]).not.toContain("spaceIconSvg");
    expect(chipFn?.[0]).not.toContain("flight-log-card");
    // Both headers render the chip; SSE fingerprints flip on the busy flag.
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn?.[0]).toContain("renderBusyOutsideChip(now)");
    const attentionFn = dashboardHtml.match(/function renderAttentionPanel\([\s\S]*?\n\}/);
    expect(attentionFn?.[0]).toContain("renderBusyOutsideChip(d.missionControl?.now)");
    expect(dashboardHtml).toMatch(/busyOutsidePlan: now\.busyOutsidePlan\?\.active === true/);
    const flightLogFingerprintFn = dashboardHtml.match(
      /function flightLogFingerprint\([\s\S]*?\n\}/,
    );
    expect(flightLogFingerprintFn?.[0]).toContain("busyOutsidePlan");
  });

  it("demotes Mode and Updated to icon-led discreet meta with accessible names", () => {
    expect(dashboardHtml).toContain("function renderNowMeta(modeLabel, updatedSource, now)");
    expect(dashboardHtml).toContain("function nowMetaIconSvg(kind, opts)");
    expect(dashboardHtml).toContain('class="now-meta"');
    expect(dashboardHtml).toContain("now-meta-icon");
    // Icons keep accessible names and tooltips (no bold Mode:/Updated: labels).
    expect(dashboardHtml).toContain('aria-label="Mode"');
    expect(dashboardHtml).toContain('aria-label="Updated"');
    expect(dashboardHtml).toContain('aria-label="Elapsed"');
    expect(dashboardHtml).toContain('title="Mode"');
    expect(dashboardHtml).toContain('title="Updated"');
    expect(dashboardHtml).toContain('title="Elapsed"');
    expect(dashboardHtml).toContain("title=\"${escapeAttr('Mode: ' + displayMode)}\"");
    expect(dashboardHtml).toContain("title=\"${escapeAttr('Updated: ' + updatedPlain)}\"");
    // Old full-weight labeled rows are gone from the now panel.
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    expect(nowPanelFn?.[0]).toContain("renderNowMeta(modeLabel, updatedSource, now)");
    expect(nowPanelFn?.[0]).not.toContain('now-meta-label">Mode:');
    expect(nowPanelFn?.[0]).not.toContain('now-meta-label">Updated:');
    expect(dashboardHtml).not.toContain("now-meta-label");
    expect(dashboardHtml).not.toContain("now-meta-row");
    // Inline SVG only (no icon font / dependency).
    expect(dashboardHtml).toMatch(/nowMetaIconSvg[\s\S]*?<svg class="now-meta-icon"/);
    expect(dashboardHtml).not.toMatch(/font-awesome|material-icons|iconify/i);
  });

  it("hosts HANDOFF Gaps in Flight Log (not Current mission)", () => {
    expect(dashboardHtml).toContain("function renderNowGaps(_gapsText)");
    expect(dashboardHtml).toContain("function renderFlightLogCard(entry, idx)");
    expect(dashboardHtml).toContain("flight-log-card-current");
    expect(dashboardHtml).toContain("missionControl?.flightLog");
    // Gaps strip retired from Current mission body.
    expect(dashboardHtml).not.toContain("${renderNowGaps(gapsText)}");
    expect(dashboardHtml).not.toContain("now-gaps-label");
    expect(dashboardHtml).not.toContain("now-gaps-text");
  });

  it("keeps Current Mission Spotlight hierarchy: compact Previous/Next, Current full body", () => {
    expect(dashboardHtml).toMatch(
      /\.now-step-previous \.now-step-text,\s*\n\s*\.now-step-next \.now-step-text\s*\{[^}]*-webkit-line-clamp:\s*1/,
    );
    expect(dashboardHtml).toMatch(
      /\.now-step-current \.now-step-text\s*\{[^}]*-webkit-line-clamp:\s*3/,
    );
    expect(dashboardHtml).toMatch(/\.now-meta\s*\{[^}]*border-top:\s*1px solid var\(--border\)/);
  });

  it("shows discreet Current mission elapsed timers and omits them when idle", () => {
    expect(dashboardHtml).toContain("function formatElapsedCompact(ms)");
    expect(dashboardHtml).toContain("function formatElapsedPlain(ms)");
    expect(dashboardHtml).toContain("function computeNowTimingElapsed(now)");
    expect(dashboardHtml).toContain("function syncNowTimingTick(now)");
    expect(dashboardHtml).toContain("data-now-timing-value");
    expect(dashboardHtml).toContain("now-meta-timing");
    expect(dashboardHtml).toContain("total \\u00b7");
    expect(dashboardHtml).toContain("this step");
    expect(dashboardHtml).toContain("Total elapsed");
    // Idle empty card stops the tick and has no timing chrome in that branch.
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn?.[0]).toContain("stopNowTimingTick()");
    expect(nowPanelFn?.[0]).toContain("No active plan");
    expect(nowPanelFn?.[0]).not.toMatch(/No active plan[\s\S]*data-now-timing-value/);
    // Live tick is text-only (interval), not a CSS animation on the meta row.
    expect(dashboardHtml).toContain("setInterval(tick, 1000)");
    expect(dashboardHtml).not.toMatch(/now-meta-timing[^{]*\{[^}]*animation:/);
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
    expect(dashboardHtml).toContain("function copyToastMessage(subject, destination, text)");
    expect(dashboardHtml).toContain("function copyActionTitle(subject, destination, text)");
    expect(dashboardHtml).toContain("function copyForPaste(text, subject, destination)");
    expect(dashboardHtml).not.toContain("function copyFromDatasetButton(el)");
    expect(dashboardHtml).toContain("function isPasteOnlyShellTarget(text)");
    expect(dashboardHtml).toMatch(
      /Copied \$\{subject\}\. Paste into the \$\{pasteDestinationLabel\(destination\)\}\./,
    );
    expect(dashboardHtml).toMatch(
      /Copy \$\{subject\}\. Paste into the \$\{pasteDestinationLabel\(destination\)\}\./,
    );
    expect(dashboardHtml).toContain(
      "paste-only prepares a second interactive paste; review does not start from this panel",
    );
    // Past-chat picker title/aria uses mirrored PROMPT_RESUME_GUIDANCE; toast stays subject-prefixed.
    expect(dashboardHtml).toContain("const PROMPT_RESUME_GUIDANCE =");
    expect(dashboardHtml).toMatch(
      /if \(destination === 'pastChatPicker'\) \{\s*return PROMPT_RESUME_GUIDANCE;/,
    );
    expect(dashboardHtml).toContain(
      "Paste into the past-chat picker to resume that chat, then answer the pending question.",
    );
    expect(dashboardHtml).toMatch(/destination === 'pastChatPicker'/);
    // Path actions copy for the file picker; they never claim a native open.
    expect(dashboardHtml).toContain("const PATH_COPY_LABEL = 'Copy path'");
    expect(dashboardHtml).toContain("function copyRepoPath(relPath)");
    expect(dashboardHtml).toContain("function copyGitStagingCommand()");
    expect(dashboardHtml).not.toContain("canAttemptNativeOpen");
    expect(dashboardHtml).not.toContain("pathActionLabel");
    expect(dashboardHtml).not.toContain("attemptProtocolOpen");
    expect(dashboardHtml).not.toContain("Requested editor open:");
    expect(dashboardHtml).not.toContain("function buildEditorFileUris");
    expect(dashboardHtml).not.toContain("vscode://");
    expect(dashboardHtml).not.toContain("cursor://");
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
    expect(dashboardHtml).not.toContain("function copyFromDatasetButton(el)");
    expect(dashboardHtml).not.toContain("data-copy-text=");
    // Inline handlers are escaped for the JS string and the HTML attribute.
    expect(dashboardHtml).toMatch(
      /return escapeAttr\(\s*`copyForPaste\('\$\{escapeJsString\(text\)/,
    );
    expect(dashboardHtml).toMatch(
      /return escapeAttr\(`copyRepoPath\('\$\{escapeJsString\(relPath\)/,
    );
  });
});

describe("plugin-ux-validation: unified Activity feed", () => {
  it("merges the full semantic stream with deduped client diagnostics", () => {
    expect(dashboardHtml).toContain("function unifiedActivityEvents(semanticEvents)");
    expect(dashboardHtml).toContain("const byId = new Map()");
    expect(dashboardHtml).toContain("if (!ev?.id || byId.has(ev.id)) continue");
    expect(dashboardHtml).toContain("for (const ev of activityLog)");
    expect(dashboardHtml).toMatch(/bTime - aTime[\s\S]*?\.slice\(0, 100\)/);
    expect(dashboardHtml).toContain("const semanticEvents = semanticFeedEvents(d)");
  });

  it("keeps Monitor curated while Activity renders all event kinds", () => {
    // Live-actions allowlist: tick/handoff/delivery + agent_step denser feed,
    // plus the 2026-08-05 real-time kinds (Task workers, background reviews).
    expect(dashboardHtml).toMatch(
      /const MONITOR_ACTIVITY_KINDS = new Set\(\[\s*'run_plan', 'handoff', 'delivery', 'agent_step', 'subagent', 'plan_review',\s*\]\)/,
    );
    // HTML allowlist mirrors the semantic-model SoT exactly (order included).
    expect(MONITOR_ACTIVITY_KINDS).toEqual([
      "run_plan",
      "handoff",
      "delivery",
      "agent_step",
      "subagent",
      "plan_review",
    ]);
    // Cap SoT is MONITOR_FEED_CAP via missionControl.monitorFeedCap (no HTML literal).
    expect(dashboardHtml).not.toMatch(/const MONITOR_FEED_CAP\s*=/);
    expect(dashboardHtml).toContain("function monitorFeedCap(d)");
    expect(dashboardHtml).toContain(".slice(0, monitorFeedCap(d))");
    expect(dashboardHtml).toContain("d?.missionControl?.monitorFeedCap");
    expect(buildMissionControlView({}).monitorFeedCap).toBe(MONITOR_FEED_CAP);
    expect(MONITOR_FEED_CAP).toBe(20);
    expect(dashboardHtml).toContain("agent_step:");
    // plan_progress stays off the Monitor hero allowlist
    expect(dashboardHtml).not.toMatch(
      /const MONITOR_ACTIVITY_KINDS = new Set\(\[[^\]]*plan_progress[^\]]*\]\)/,
    );
    for (const kind of ["agent", "skill", "command", "memory"]) {
      expect(dashboardHtml).toMatch(new RegExp(`${kind}:\\s+\\{[^}]*tag:\\s*'${kind}'`));
    }
    expect(dashboardHtml).toContain("${filteredActivityEvents.map((ev, idx) => {");
  });

  it("renders flat single-roll Monitor rows with distinct resting kind colors", () => {
    expect(dashboardHtml).toContain("monitor-row");
    // The kind glyph and its chip wrapper are gone from the Crew row entirely
    // (design v2): kind is carried by the badge tint + the badge tooltip gloss.
    expect(dashboardHtml).not.toContain("monitor-row-chip");
    expect(dashboardHtml).not.toContain("monitor-row-icon");
    expect(dashboardHtml).toContain("monitor-row-badge");
    expect(dashboardHtml).toContain("function semanticEventTime(ev, _info)");
    expect(dashboardHtml).toMatch(
      /function semanticEventTime\(ev, _info\) \{[\s\S]*?if \(ev\.at\) return escapeHtml\(ev\.at\);\s*return '';/,
    );
    expect(dashboardHtml).not.toContain("monitor-agent-header");
    expect(dashboardHtml).not.toContain("monitor-sub-row");
    expect(dashboardHtml).not.toContain("agent-plan-context");
    // Single flat list: no group-by iteration
    expect(dashboardHtml).not.toContain("const groups = {}");
    // Return-brief: no resting kind-tag text; actor folded into label (no identity column)
    expect(dashboardHtml).not.toContain("monitor-row-tag");
    expect(dashboardHtml).not.toContain("monitor-row-identity");
    expect(dashboardHtml).not.toContain("const showIdentity = !prevRaw || rawIdentity !== prevRaw");
    // Team badge: fixed 18px square, --mc-radius-sm so it never reads as a status
    // pill (those squared off to --mc-radius-chrome in the same pass), tinted
    // *-bg fill with the solid semantic color on the initials.
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-badge\s*\{[^}]*width:\s*18px/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-badge\s*\{[^}]*height:\s*18px/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-badge\s*\{[^}]*border-radius:\s*var\(--mc-radius-sm\)/,
    );
    expect(dashboardHtml).toContain('style="background:${info.bg};color:${info.color}"');
    // No resting hover/focus width expand on the badge (the #631 avatar behaviour).
    expect(dashboardHtml).not.toMatch(
      /\.live-activity-feed \.monitor-row:hover \.monitor-row-badge/,
    );
    expect(dashboardHtml).not.toMatch(
      /\.live-activity-feed \.monitor-row:focus-within \.monitor-row-badge/,
    );
    // Verb state icon replaced the 6px dot; stroke weight is optically
    // compensated for the 12px render, on the dashboard's own 16 grid (the
    // design's 24-grid Feather shapes were redrawn, not imported — the file
    // keeps one icon geometry, pinned by the viewBox check on the refresh test).
    expect(dashboardHtml).toContain("const CREW_VERB_ICON = {");
    expect(dashboardHtml).toContain(
      'viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"',
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-verb-icon\s*\{[^}]*stroke-width:\s*1\.6/,
    );
    for (const [verb, icon] of [
      ["running", "play"],
      ["awaiting", "pause"],
      ["done", "check"],
      ["failed", "x"],
      ["merged", "git-merge"],
      ["parked", "circle-slash"],
    ] as const) {
      expect(dashboardHtml).toMatch(new RegExp(`${verb}:\\s*'${icon}'`));
    }
    expect(dashboardHtml).toMatch(
      /run_plan:\s+\{[^}]*color:\s*'var\(--green\)'[^}]*bg:\s*'var\(--green-bg\)'/,
    );
    expect(dashboardHtml).toMatch(
      /handoff:\s+\{[^}]*color:\s*'var\(--yellow\)'[^}]*bg:\s*'var\(--yellow-bg\)'/,
    );
    expect(dashboardHtml).toMatch(
      /plan_progress:\s+\{[^}]*color:\s*'var\(--orange\)'[^}]*bg:\s*'var\(--orange-bg\)'/,
    );
    // delivery cyan breaks green wash with run_plan (base / pr / ship fallback)
    expect(dashboardHtml).toMatch(
      /delivery:\s+\{[^}]*color:\s*'var\(--cyan\)'[^}]*bg:\s*'var\(--cyan-bg\)'/,
    );
    // Delivery subtype chips: distinct solid fills by refs.commitType
    expect(dashboardHtml).toContain("function semanticEventInfo(kind, commitType)");
    expect(dashboardHtml).toContain("semanticEventInfo(ev.kind, ev.refs?.commitType)");
    expect(dashboardHtml).toMatch(
      /feat:\s+\{[^}]*color:\s*'var\(--purple\)'[^}]*bg:\s*'var\(--purple-bg\)'/,
    );
    expect(dashboardHtml).toMatch(
      /fix:\s+\{[^}]*color:\s*'var\(--red\)'[^}]*bg:\s*'var\(--red-bg\)'/,
    );
    expect(dashboardHtml).toMatch(
      /docs:\s+\{[^}]*color:\s*'var\(--blue\)'[^}]*bg:\s*'var\(--blue-bg\)'/,
    );
    expect(dashboardHtml).toMatch(
      /chore:\s+\{[^}]*color:\s*'var\(--orange\)'[^}]*bg:\s*'var\(--orange-bg\)'/,
    );
    // Locked BMP delivery glyphs (feat✦ fix⚙ docs✎ chore⚒ pr⑂ ship✈)
    expect(dashboardHtml).toMatch(/feat:\s+\{\s*icon:\s*'\\u2726'/);
    expect(dashboardHtml).toMatch(/fix:\s+\{\s*icon:\s*'\\u2699'/);
    expect(dashboardHtml).toMatch(/docs:\s+\{\s*icon:\s*'\\u270e'/);
    expect(dashboardHtml).toMatch(/chore:\s+\{\s*icon:\s*'\\u2692'/);
    expect(dashboardHtml).toMatch(/pr:\s+\{\s*icon:\s*'\\u2442'/);
    expect(dashboardHtml).toMatch(/ship:\s+\{\s*icon:\s*'\\u2708'/);
    // Glosses follow the operator lexicon (design v2): full roles, no short masks.
    expect(dashboardHtml).toContain("gloss: 'DevOps - feat'");
    expect(dashboardHtml).toContain("gloss: 'Project Manager - live execution'");
    expect(dashboardHtml).toContain("gloss: 'Project Manager - awaiting gate'");
    expect(dashboardHtml).toContain("gloss: 'Developer - task unit'");
    expect(dashboardHtml).toContain("gloss: 'Product Owner - milestone'");
    expect(dashboardHtml).toContain("gloss: 'DevOps - merged unit'");
    // `shipped` is retired from the verb list and the gloss pack (2026-08-05).
    expect(dashboardHtml).not.toContain("shipped unit");
    // New live kinds carry their own lexicon gloss.
    expect(dashboardHtml).toContain("gloss: 'Developer - subagent run'");
    expect(dashboardHtml).toContain("gloss: 'QA - review evidence'");
    expect(dashboardHtml).toContain("kindGloss: gloss");
    // The time column is pushed right by the primary field's flex, not by an
    // auto margin: with a wrapping comfortable row, margin-left:auto on the
    // time would drag it onto the second line.
    expect(dashboardHtml).not.toMatch(
      /\.live-activity-feed \.monitor-row \.monitor-row-time\s*\{[^}]*margin-left:\s*auto/,
    );
    // Column order + structural pin (render block; not whole-file CSS proximity).
    expectBadgeIsRowSiblingBeforeActor(dashboardHtml);
    expect(dashboardHtml).toContain("const badgeHtml =");
    // Hover affordance on flat rows (skin tokens only)
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed \.monitor-row\[role="button"\]:hover\s*\{[^}]*background:\s*var\(--bg-card-hover\)/,
    );
    // Stagger wired for flat rows
    expect(dashboardHtml).toMatch(/\.monitor-row\.stagger-fade\s*\{/);
    expect(dashboardHtml).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.monitor-row\.stagger-fade,[\s\S]*?animation:\s*none !important/,
    );
  });

  it("renders bounded escaped labels, source labels, accents, and copy-only targets", () => {
    expect(dashboardHtml).toContain("const MAX_ACTIVITY_LABEL = 200");
    expect(dashboardHtml).toContain("${escapeHtml(ev.source)}");
    expect(dashboardHtml).toContain("${escapeHtml(ev.label)}");
    expect(dashboardHtml).toContain("const info = activityEventInfo(ev)");
    expect(dashboardHtml).toContain("activityTargetAttributes(ev, 'unified-activity')");
    expect(dashboardHtml).toContain(
      "activityTargetAttributes(ev, 'monitor-activity', { kindGloss: gloss })",
    );
    expect(dashboardHtml).toContain("pathActionTitle(pathTarget)");
    expect(dashboardHtml).toContain("copyActionTitle(`commit ${shaTarget}`, 'terminal')");
    expect(dashboardHtml).not.toContain("Open path for");
  });

  it("restores copy-only keyboard attrs on delivery rows via refs.sha", () => {
    const activityTargetAttributes = loadActivityTargetAttributes();
    const delivery = {
      id: "delivery:merge:321",
      kind: "delivery",
      label: "Merged PR #321 → 528901c.",
      refs: { sha: "528901c", commits: ["528901c"], pr: 321, plan: null },
    };
    const attrs = activityTargetAttributes(delivery, "monitor-activity");
    expect(attrs).toMatch(/\brole="button"/);
    expect(attrs).toMatch(/\btabindex="0"/);
    expect(attrs).toMatch(/aria-label="Copy commit sha for: Merged PR #321 → 528901c\."/);
    // Handler is attribute-escaped (`&#39;` for quotes); still copy-only, no navigation.
    expect(attrs).toMatch(/activateSemanticTarget\(&#39;528901c&#39;\)/);
    expect(attrs).not.toMatch(/\b(open|navigate)\b|href=/i);

    const withoutSha = activityTargetAttributes(
      { ...delivery, refs: { commits: ["528901c"], pr: 321, plan: null } },
      "monitor-activity",
    );
    expect(withoutSha).toBe("");
  });

  it("uses stable diagnostic ids and a summarized refresh heartbeat", () => {
    for (const idPrefix of [
      "diag:process:started:",
      "diag:process:stopped:",
      "diag:terminal:added:",
      "diag:terminal:activity:",
      "diag:terminal:removed:",
      "diag:health:",
      "diag:git_dirty:",
    ]) {
      expect(dashboardHtml).toContain(idPrefix);
    }
    expect(dashboardHtml).toContain("Last refreshed ${escapeHtml(relativeTime(d.generatedAt))}");
    expect(dashboardHtml).not.toContain("addActivity('Data refreshed'");
  });

  it("filters the unified Activity feed by source chips", () => {
    expect(dashboardHtml).toContain("const ACTIVITY_SOURCE_FILTERS = [");
    expect(dashboardHtml).toContain("function filterUnifiedActivityEvents(events, filterId)");
    expect(dashboardHtml).toContain("function setActivitySourceFilter(filterId)");
    expect(dashboardHtml).toContain('role="radiogroup"');
    expect(dashboardHtml).toContain('aria-label="Filter activity by source"');
    expect(dashboardHtml).toContain("onActivityFilterKeydown(event)");
    expect(dashboardHtml).toContain(".activity-filter-chip:focus-visible");
    for (const label of [
      "All",
      "Plans",
      "Git",
      "Agents",
      "Skills",
      "Commands",
      "Memory",
      "Terminals",
      "Processes",
    ]) {
      expect(dashboardHtml).toContain(`label: '${label}'`);
    }
    expect(dashboardHtml).toContain("sources: ['plans', 'handoff']");
    expect(dashboardHtml).toContain(
      "filterUnifiedActivityEvents(unifiedEvents, activitySourceFilter)",
    );
    expect(dashboardHtml).toContain("No activity for this source");
    expect(dashboardHtml).toContain("No meaningful activity recorded yet");
  });

  it("sets navActivityBadge from the unified feed count", () => {
    expect(dashboardHtml).toContain("navActivityBadge.textContent = unifiedEvents.length");
    expect(dashboardHtml).not.toContain("navActivityBadge.textContent = activityLog.length");
  });
});

describe("plugin-ux-validation: SSE + overview model wiring", () => {
  it("uses EventSource with polling fallback when SSE degrades", () => {
    expect(dashboardHtml).toContain("function connectSSE()");
    expect(dashboardHtml).toContain("new EventSource(withMissionControlAuth('/api/events'))");
    expect(dashboardHtml).toContain("syncPollingWithSseMode");
    expect(dashboardHtml).toContain("sseMode = 'polling'");
    expect(dashboardHtml).toContain("startAutoRefresh");
    expect(dashboardHtml).toMatch(
      /if \(!force && sseMode === 'live' && !sseReconnecting && !sseSilentFallback && data\) return/,
    );
  });

  it("re-renders now + Flight Log from missionControl fingerprints on each snapshot", () => {
    expect(dashboardHtml).toContain("function nowFingerprint(now)");
    expect(dashboardHtml).toContain("function flightLogFingerprint(d)");
    expect(dashboardHtml).not.toContain("attentionFingerprint");
    expect(dashboardHtml).toContain("renderNowExecutionPanel");
    expect(dashboardHtml).toContain("d.missionControl?.now");
    expect(dashboardHtml).toContain("d.missionControl?.flightLog");
    expect(dashboardHtml).toContain("d.missionControl?.activity");
  });

  it("does not label completed or idle plans as Active plan in current mission", () => {
    expect(dashboardHtml).not.toContain("overview-inventory-note");
    expect(dashboardHtml).not.toContain("Active plan:");
    expect(dashboardHtml).not.toContain("Completed plan:");
    expect(dashboardHtml).not.toContain("Last plan (exhausted)");
    expect(dashboardHtml).toMatch(/status === 'executing' \|\| status === 'awaiting_user'/);
    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    expect(nowPanelFn?.[0]).toContain("isLive || isCompleted");
    expect(nowPanelFn?.[0]).toContain("No active plan");
  });

  it("renders completed missions as a populated Current mission card, not IDLE empty", () => {
    const nowStatusMetaFn = dashboardHtml.match(/function nowStatusMeta\([\s\S]*?\n\}/);
    expect(nowStatusMetaFn).not.toBeNull();
    expect(nowStatusMetaFn?.[0]).toContain("status === 'completed'");
    expect(nowStatusMetaFn?.[0]).toContain("key: 'completed'");
    expect(nowStatusMetaFn?.[0]).toContain("label: 'Completed'");
    expect(nowStatusMetaFn?.[0]).toContain("mark: '\\u2713'");
    // completed must not reuse the idle meta object
    expect(nowStatusMetaFn?.[0]).not.toContain("label: 'Idle', mark: '\\u2713'");
    expect(nowStatusMetaFn?.[0]).not.toContain("key: 'idle', label: 'Completed'");

    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    const panel = nowPanelFn?.[0] ?? "";
    expect(panel).toContain("isCompleted");
    expect(panel).toContain("showMission");
    expect(panel).toContain("isLive || isCompleted");
    // Empty path is reserved for !showMission (no completed/live mission).
    expect(panel).toContain("if (!showMission)");
    expect(panel).toContain("No active plan");
    expect(panel).toContain("Quiet cockpit");
    // Idle label lives in nowStatusMeta; empty card still emits meta.label via escapeHtml.
    expect(panel).toContain("${escapeHtml(meta.label)}");
    // Populated path keeps progress, stepper, and copy-only actions for completed too.
    expect(panel).toContain("renderNowStepBar(now)");
    expect(panel).toContain("renderNowStepper(now, handoff, status, meta)");
    expect(panel).toContain("Copy plan path");
    expect(panel).toContain("Copy /git-staging");
    expect(panel).not.toContain("Last plan (exhausted)");
  });

  it("adds mode-aware manual next-step CTAs on Current mission (idle stays start-project)", () => {
    expect(dashboardHtml).toContain("function isManualPlanMode(modeLabel)");
    expect(dashboardHtml).toContain("function continuePlanPasteText(planName)");
    expect(dashboardHtml).toContain("function copyContinuePlanCommand(planName)");
    expect(dashboardHtml).toContain("function renderNowModeHint(modeLabel)");
    expect(dashboardHtml).toContain("now-mode-hint");
    expect(dashboardHtml).toContain("cta-copy-continue-plan");
    expect(dashboardHtml).toContain("Copy /continue-plan");

    const nowPanelFn = dashboardHtml.match(/function renderNowExecutionPanel\([\s\S]*?\n\}/);
    expect(nowPanelFn).not.toBeNull();
    const panel = nowPanelFn?.[0] ?? "";
    expect(panel).toContain("renderNowModeHint(modeLabel)");
    expect(panel).toContain("isManualPlanMode(modeLabel)");
    expect(panel).toContain("copyContinuePlanCommand");
    // Idle empty card: start-project only (no continue-plan on quiet cockpit).
    expect(panel).toContain("Quiet cockpit");
    expect(panel).toContain("Copy /start-project");
    expect(panel).toContain("if (!showMission)");
    // Manual CTA is gated; always keep staging on populated mission.
    expect(panel).toContain("Copy /git-staging");

    const sources = [
      /function isManualPlanMode\(modeLabel\) \{[\s\S]*?\n\}/,
      /function continuePlanPasteText\(planName\) \{[\s\S]*?\n\}/,
      /function renderNowModeHint\(modeLabel\) \{[\s\S]*?\n\}/,
    ].map((re) => {
      const match = dashboardHtml.match(re);
      expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
      return match?.[0];
    });
    const { isManualPlanMode, continuePlanPasteText, renderNowModeHint } = new Function(
      `${sources.join("\n")}\nreturn { isManualPlanMode, continuePlanPasteText, renderNowModeHint };`,
    )() as {
      isManualPlanMode: (mode: string | null | undefined) => boolean;
      continuePlanPasteText: (plan: string) => string;
      renderNowModeHint: (mode: string | null | undefined) => string;
    };

    expect(isManualPlanMode("manual")).toBe(true);
    expect(isManualPlanMode("continue-plan")).toBe(true);
    expect(isManualPlanMode("manual - waiting")).toBe(true);
    expect(isManualPlanMode("run-plan (orchestrated)")).toBe(false);
    expect(isManualPlanMode("run-plan-all")).toBe(false);
    expect(isManualPlanMode(null)).toBe(false);
    expect(isManualPlanMode("")).toBe(false);

    expect(continuePlanPasteText("demo.plan.md")).toBe("/continue-plan demo.plan.md");
    expect(continuePlanPasteText("")).toBe("/continue-plan");

    expect(renderNowModeHint("manual")).toContain("now-mode-hint");
    expect(renderNowModeHint("manual")).toContain("new conversation");
    expect(renderNowModeHint("run-plan (orchestrated)")).toBe("");
  });

  it("maps Current mission Mode to operator-friendly display labels (raw HANDOFF unchanged)", () => {
    expect(dashboardHtml).toContain("function formatModeDisplayLabel(modeLabel)");
    expect(dashboardHtml).toContain("function mapModeDisplayCore(core)");
    expect(dashboardHtml).toContain("formatModeDisplayLabel(modeLabel)");
    expect(dashboardHtml).toContain("now-meta-icon-executing");
    expect(dashboardHtml).toMatch(
      /\.now-meta-icon\.now-meta-icon-executing\s*\{[^}]*animation:\s*spin/,
    );
    expect(dashboardHtml).toContain("opts.executing");
    expect(dashboardHtml).toContain("(now?.status || '') === 'executing'");

    const sources = [
      /function mapModeDisplayCore\(core\) \{[\s\S]*?\n\}/,
      /function formatModeDisplayLabel\(modeLabel\) \{[\s\S]*?\n\}/,
    ].map((re) => {
      const match = dashboardHtml.match(re);
      expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
      return match?.[0];
    });
    const { formatModeDisplayLabel } = new Function(
      `${sources.join("\n")}\nreturn { formatModeDisplayLabel };`,
    )() as {
      formatModeDisplayLabel: (mode: string | null | undefined) => string;
    };

    expect(formatModeDisplayLabel("run-plan (orchestrated)")).toBe("auto mode (orchestrated)");
    expect(formatModeDisplayLabel("run-plan (in-session loop)")).toBe(
      "auto mode (in-session loop)",
    );
    expect(formatModeDisplayLabel("run-plan")).toBe("auto mode");
    expect(formatModeDisplayLabel("run-plan-all")).toBe("run all (batch auto mode)");
    expect(formatModeDisplayLabel("manual")).toBe("human-in-the-loop (manual)");
    expect(formatModeDisplayLabel("continue-plan")).toBe("human-in-the-loop (manual)");
    expect(formatModeDisplayLabel("run-plan (orchestrated) — STOPPED: API/usage limit")).toBe(
      "auto mode (orchestrated) — STOPPED: API/usage limit",
    );
    expect(formatModeDisplayLabel("STOPPED (run-plan orchestrated; plan exhausted)")).toContain(
      "STOPPED",
    );
    expect(formatModeDisplayLabel(null)).toBe("");
    expect(formatModeDisplayLabel("")).toBe("");
  });

  it("orders overview as current mission → flight log → checklist → crew monitor", () => {
    const overviewStart = dashboardHtml.indexOf('id="section-overview"');
    expect(overviewStart).toBeGreaterThan(-1);
    const overviewSlice = dashboardHtml.slice(overviewStart, overviewStart + 4000);
    const nowIdx = overviewSlice.indexOf("renderNowExecutionPanel");
    const attentionIdx = overviewSlice.indexOf("renderAttentionPanel");
    const recentIdx = overviewSlice.indexOf("renderRecentPlanCards");
    const activityIdx = overviewSlice.indexOf('id="hero-activity"');
    expect(nowIdx).toBeGreaterThan(-1);
    expect(attentionIdx).toBeGreaterThan(nowIdx);
    expect(recentIdx).toBeGreaterThan(attentionIdx);
    expect(activityIdx).toBeGreaterThan(recentIdx);
  });

  it("locks desktop one-fold at min-width 1024px with a 2x2 overview grid", () => {
    expect(dashboardHtml).toContain("@media (min-width: 1024px)");
    expect(dashboardHtml).toMatch(
      /\.overview-stack\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column/,
    );
    expect(dashboardHtml).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?#section-overview\.active \.overview-stack\s*\{[^}]*display:\s*grid/,
    );
    expect(dashboardHtml).toMatch(
      /#section-overview\.active \.overview-stack\s*\{[^}]*height:\s*100%/,
    );
    expect(dashboardHtml).toMatch(
      /#section-overview\.active \.overview-stack\s*\{[^}]*overflow:\s*hidden/,
    );
    // Grid-area pins scoped to the one-fold block (residual B): future grid
    // extensions elsewhere in the file must not false-pass or false-fail these.
    const oneFold = dashboardHtml.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\n\}\n\n\/\* ===== Recent plan cards/,
    );
    expect(oneFold).not.toBeNull();
    const block = oneFold?.[0] ?? "";
    expect(block).toContain("grid-template-areas:");
    expect(block).toContain('"now attention"');
    expect(block).toContain('"checklist monitor"');
    expect(dashboardHtml).toMatch(
      /#section-overview\.active \.overview-stack\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/,
    );
    expect(block).toMatch(
      /#section-overview\.active #now-execution-panel\s*\{[^}]*grid-area:\s*now/,
    );
    expect(block).toMatch(/#section-overview\.active #hero-activity\s*\{[^}]*grid-area:\s*monitor/);
    expect(block).toMatch(
      /#section-overview\.active #attention-panel\s*\{[^}]*grid-area:\s*attention/,
    );
    expect(block).toMatch(
      /#section-overview\.active #recent-plans-panel\s*\{[^}]*grid-area:\s*checklist/,
    );
  });

  it("collapses the overview to a two-column IA grid at mid widths (701-1023px)", () => {
    const mid = dashboardHtml.match(
      /@media \(min-width: 701px\) and \(max-width: 1023px\)\s*\{[\s\S]*?\n\}\n\n\/\* Desktop one-fold/,
    );
    expect(mid).not.toBeNull();
    const block = mid?.[0] ?? "";
    expect(block).toMatch(/#section-overview\.active \.overview-stack\s*\{[^}]*display:\s*grid/);
    expect(block).toMatch(
      /#section-overview\.active \.overview-stack\s*\{[^}]*grid-template-columns:\s*1fr 1fr/,
    );
    // Row-major collapse follows the locked IA: Current mission -> Flight Log
    // -> Checklist -> Crew monitor.
    expect(block).toContain("grid-template-areas:");
    expect(block).toContain('"now now"');
    expect(block).toContain('"attention checklist"');
    expect(block).toContain('"monitor monitor"');
    expect(block).toMatch(
      /#section-overview\.active #now-execution-panel\s*\{[^}]*grid-area:\s*now/,
    );
    expect(block).toMatch(
      /#section-overview\.active #attention-panel\s*\{[^}]*grid-area:\s*attention/,
    );
    expect(block).toMatch(
      /#section-overview\.active #recent-plans-panel\s*\{[^}]*grid-area:\s*checklist/,
    );
    expect(block).toMatch(/#section-overview\.active #hero-activity\s*\{[^}]*grid-area:\s*monitor/);
    // Mid grid is stacked (page scrolls): the one-fold height lock stays at >=1024px.
    expect(block).not.toMatch(/height:\s*100%/);
    expect(block).not.toMatch(/overflow:\s*hidden/);
    // Mobile stack stays DOM-order flex; no CSS order property anywhere on the stack.
    expect(dashboardHtml).not.toMatch(/\.overview-stack\s*\{[^}]*order:/);
  });

  it("adds a very thin sidebar mode (~<340px) with single-column card grids", () => {
    expect(dashboardHtml).toContain("@media (max-width: 339px)");
    const thin = dashboardHtml.match(/@media \(max-width: 339px\)\s*\{[\s\S]*?\n\}\n/);
    expect(thin).not.toBeNull();
    const block = thin?.[0] ?? "";
    expect(block).toContain("--mc-card-padding: 10px");
    expect(block).toContain("--mc-content-pad: 8px");
    expect(block).toMatch(
      /\.health-grid,[\s\S]*?\.agent-grid\s*\{[^}]*grid-template-columns:\s*1fr;/,
    );
    // Thin mode tightens the shared ladder; it does not fork it with new tokens.
    expect(block).not.toMatch(
      /--mc-(?!card-padding|header-pad-x|header-pad-x-end|content-pad)[a-z-]+:/,
    );
  });

  it("adds a fullscreen viewport mode toggle with floating exit and Escape restore", () => {
    expect(dashboardHtml).toMatch(/class="header-right"[\s\S]*?id="fullscreenToggleBtn"/);
    expect(dashboardHtml).toMatch(/id="fullscreenToggleBtn"[^>]*aria-pressed="false"/);
    expect(dashboardHtml).toContain('id="fullscreenExitBtn"');
    expect(dashboardHtml).toMatch(/id="fullscreenExitBtn"[^>]*hidden/);
    expect(dashboardHtml).toContain("function toggleMcFullscreen(");
    expect(dashboardHtml).toMatch(
      /addEventListener\('keydown'[\s\S]*?classList\.contains\('mc-fullscreen'\)/,
    );
    expect(dashboardHtml).toContain("Layered Escape");
    expect(dashboardHtml).toContain("isNavMoreOpen()");
    expect(dashboardHtml).toMatch(/body\.mc-fullscreen \.top-tabs-row\s*\{[^}]*padding-right:/);
    expect(dashboardHtml).toMatch(/body\.mc-fullscreen \.header\s*\{[^}]*display:\s*none/);
    expect(dashboardHtml).toMatch(/\.fullscreen-exit-btn\[hidden\]\s*\{[^}]*display:\s*none/);
    // Fullscreen controls follow the chrome icon contract (16px, stroke 1.5, currentColor).
    const enterBtn = dashboardHtml.match(/id="fullscreenToggleBtn"[^>]*>([\s\S]*?)<\/button>/);
    expect(enterBtn).not.toBeNull();
    expect(enterBtn?.[1]).toContain('stroke="currentColor"');
    expect(enterBtn?.[1]).toContain('stroke-width="1.5"');
    expect(enterBtn?.[1]).toContain('width="16" height="16"');
    // Skin-neutral: fullscreen chrome uses shared surface tokens only.
    const fsCss = dashboardHtml.match(/\.fullscreen-exit-btn\s*\{[\s\S]*?\n\}/);
    expect(fsCss?.[0]).toContain("var(--bg-secondary)");
    expect(fsCss?.[0]).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("routes header transport health tone through healthSeverityChrome", () => {
    expect(dashboardHtml).toContain("function updateTransportChrome()");
    expect(dashboardHtml).toContain("const healthChrome = healthSeverityChrome(healthStatus);");
    expect(dashboardHtml).toContain("const healthTone = healthChrome.tone;");
  });

  it("hides the Cockpit subheader on desktop; More menu stays in the header", () => {
    const oneFold = dashboardHtml.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\n\}\n\n\/\* ===== Recent plan cards/,
    );
    expect(oneFold).not.toBeNull();
    const block = oneFold?.[0] ?? "";
    expect(block).toMatch(/\.top-tabs\s*\{[^}]*display:\s*none/);
    expect(dashboardHtml).toContain('class="cockpit-anchors"');
    expect(dashboardHtml).toMatch(/class="header-right"[\s\S]*?id="navMoreBtn"/);
    expect(dashboardHtml).toContain("goCockpitAnchor");
  });

  it("hides .content page scroll only for desktop overview; base scroll stays auto", () => {
    expect(dashboardHtml).toMatch(/\.content\s*\{[^}]*overflow-y:\s*auto/);
    expect(dashboardHtml).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?\.content:has\(#section-overview\.active\)\s*\{[^}]*overflow-y:\s*hidden/,
    );
    // One-fold scroll lock is scoped to overview via :has; non-overview keeps base auto.
    expect(dashboardHtml).not.toMatch(
      /@media \(min-width: 1024px\)[\s\S]*?\.content\s*\{[^}]*overflow-y:\s*hidden/,
    );
  });

  it("bounds the desktop overview to one viewport fold (no page scroll at >=1024px)", () => {
    // Viewport-level fold contract, asserted on the full CSS containment chain:
    // viewport -> html/body (100%) -> .content (bounded flex, scroll-locked on
    // overview) -> overview stack (grid, clipped) -> panels (clipped, inner
    // scroll). Breaking any link reintroduces page scroll at >=1024px.
    expect(dashboardHtml).toMatch(/html,\s*body\s*\{[^}]*height:\s*100%/);
    expect(dashboardHtml).toMatch(/\nbody\s*\{[^}]*display:\s*flex;\s*flex-direction:\s*column/);
    expect(dashboardHtml).toMatch(/\.content\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0/);

    const oneFold = dashboardHtml.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\n\}\n\n\/\* ===== Recent plan cards/,
    );
    expect(oneFold).not.toBeNull();
    const block = oneFold?.[0] ?? "";
    expect(block).toMatch(
      /\.content:has\(#section-overview\.active\)\s*\{[^}]*overflow-y:\s*hidden/,
    );
    expect(block).toMatch(/#section-overview\.active\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0/);
    expect(block).toMatch(
      /#section-overview\.active \.overview-stack\s*\{[^}]*height:\s*100%;[^}]*overflow:\s*hidden/,
    );
    // All four fold panels clip; overflow scrolls inside a panel, never the page.
    expect(block).toMatch(
      /#now-execution-panel,[\s\S]*?#recent-plans-panel\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/,
    );
    expect(block).toMatch(/#hero-activity\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden/);
    // No fixed pixel height inside the one-fold block may push past the fold.
    expect(block).not.toMatch(/(?:min-|max-)?height:\s*\d+px/);
  });

  it("scrolls Current mission, Crew Monitor, Flight Log, and Checklist inside desktop fold panels", () => {
    const oneFold = dashboardHtml.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\n\}\n\n\/\* ===== Recent plan cards/,
    );
    expect(oneFold).not.toBeNull();
    const block = oneFold?.[0] ?? "";
    // Monitor feed: fill cell, drop fixed max-height, scroll internally.
    expect(block).toMatch(
      /#section-overview\.active #hero-activity \.live-activity-feed\s*\{[^}]*flex:\s*1 1 auto/,
    );
    expect(block).toMatch(
      /#section-overview\.active #hero-activity \.live-activity-feed\s*\{[^}]*max-height:\s*none/,
    );
    expect(block).toMatch(
      /#section-overview\.active #hero-activity \.live-activity-feed\s*\{[^}]*overflow-y:\s*auto/,
    );
    // Current mission + Field Report + Checklist: body scroller, not the page.
    expect(block).toMatch(
      /#section-overview\.active \.panel-scroll-body\s*\{[^}]*overflow-y:\s*auto/,
    );
    expect(block).toMatch(
      /#section-overview\.active \.panel-scroll-body\s*\{[^}]*overscroll-behavior:\s*contain/,
    );
    expect(dashboardHtml).toContain('class="panel-scroll-body"');
    expect(dashboardHtml).toMatch(/id="now-execution-panel"[\s\S]*?class="panel-scroll-body"/);
    // Base (sub-desktop) feed max-height stays; one-fold override is media-scoped.
    expect(dashboardHtml).toMatch(/\.live-activity-feed\s*\{[^}]*max-height:\s*320px/);
    // panel-scroll-body overflow must not appear outside the 1024px block.
    const outside = dashboardHtml.replace(block, "");
    expect(outside).not.toMatch(
      /#section-overview\.active \.panel-scroll-body\s*\{[^}]*overflow-y:\s*auto/,
    );
  });

  it("keeps a right scroll gutter so inner boxes clear the 6px thumb", () => {
    // Token + asymmetric padding on primary scroll surfaces; padding does not
    // change capturePanelScrollOffsets / restorePanelScrollOffsets (scrollTop API).
    expect(dashboardHtml).toContain("--mc-scroll-gutter: 8px");
    expect(dashboardHtml).toMatch(
      /\.content\s*\{[^}]*padding-right:\s*calc\(var\(--mc-content-pad\) \+ var\(--mc-scroll-gutter\)\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.live-activity-feed\s*\{[^}]*padding-right:\s*var\(--mc-scroll-gutter\)/,
    );
    expect(dashboardHtml).toMatch(
      /#section-overview\.active \.panel-scroll-body\s*\{[^}]*padding-right:\s*var\(--mc-scroll-gutter\)/,
    );
    expect(dashboardHtml).toContain("function capturePanelScrollOffsets()");
    expect(dashboardHtml).toContain("function restorePanelScrollOffsets(");
  });

  it("tightens desktop overview density only inside the 1024px one-fold media query", () => {
    const oneFold = dashboardHtml.match(
      /@media \(min-width: 1024px\)\s*\{[\s\S]*?\n\}\n\n\/\* ===== Recent plan cards/,
    );
    expect(oneFold).not.toBeNull();
    const block = oneFold?.[0] ?? "";
    expect(block).toMatch(
      /#section-overview\.active \.overview-stack\s*\{[^}]*gap:\s*var\(--mc-space-md\)/,
    );
    expect(block).toMatch(
      /\.content:has\(#section-overview\.active\)\s*\{[^}]*padding:\s*var\(--mc-space-lg\)/,
    );
    // Base stack gap and card padding remain for widths below the breakpoint.
    expect(dashboardHtml).toMatch(/\.overview-stack\s*\{[^}]*gap:\s*12px/);
    expect(dashboardHtml).toMatch(/:root,[\s\S]*?--mc-card-padding:\s*16px/);
  });

  it("keeps one-fold panel scroll compatible with skins, focus rings, and copy-only controls", () => {
    expect(dashboardHtml).toContain('html[data-dashboard-skin="legacy"]');
    expect(dashboardHtml).toContain('html[data-dashboard-skin="cursor"]');
    expect(dashboardHtml).toContain("button:focus-visible");
    expect(dashboardHtml).toContain(".recent-plan-actions-btn:focus-visible");
    expect(dashboardHtml).toContain("@media (prefers-reduced-motion: reduce)");
    // Panel wrappers are layout-only; copy handlers stay on interactive controls.
    expect(dashboardHtml).not.toMatch(/panel-scroll-body[^>]*(?:onclick|copyForPaste)/);
    expect(dashboardHtml).toContain("copyRepoPathHandler");
    expect(dashboardHtml).toContain("copyForPasteHandler");
  });

  it("names the Cockpit page and its four sections consistently with the nav", () => {
    // Headings are the shipped Phase 2 names, each led by its icon.
    for (const heading of [
      "${spaceIconSvg('current-mission')}Current mission",
      "${spaceIconSvg('monitor')}Crew Monitor",
      "${spaceIconSvg('field-report')}Flight Log",
      "${spaceIconSvg('checklist')}Checklist",
    ]) {
      expect(dashboardHtml).toContain(heading);
    }
    // Primary nav first label matches Current mission; order: mission → Flight Log → Checklist → Crew.
    expect(dashboardHtml).toContain('class="top-nav-anchor-label">Current mission</span>');
    const navBlock = dashboardHtml.match(
      /class="cockpit-anchors"[\s\S]*?<\/div>\s*<\/div>\s*<\/nav>/,
    );
    expect(navBlock).not.toBeNull();
    const navHtml = navBlock?.[0] ?? "";
    const missionNav = navHtml.indexOf(">Current mission</span>");
    const flightNav = navHtml.indexOf(">Flight Log</span>");
    const checklistNav = navHtml.indexOf(">Checklist</span>");
    const crewNav = navHtml.indexOf(">Crew Monitor</span>");
    expect(missionNav).toBeGreaterThan(-1);
    expect(flightNav).toBeGreaterThan(missionNav);
    expect(checklistNav).toBeGreaterThan(flightNav);
    expect(crewNav).toBeGreaterThan(checklistNav);
    expect(dashboardHtml).not.toContain('class="top-nav-anchor-label">Cockpit</span>');
    expect(dashboardHtml).not.toMatch(/<span class="dot dot-blue"><\/span>\s*Cockpit/);
    expect(dashboardHtml).not.toMatch(/<span class="dot dot-blue"><\/span>\s*Overview/);
    // No prose pointing at navigation the panel no longer ships.
    expect(dashboardHtml).not.toContain("Inventory tabs");
    expect(dashboardHtml).toMatch(
      /class="nav-more-menu"[^>]*role="menu"[^>]*aria-label="More sections"/,
    );
  });

  it("applies the dot semantics table: dots only signal good / important / attention", () => {
    // Section titles carry no identity dots; the label text is the identity.
    const sectionTitles = dashboardHtml.match(/<div class="section-title">[\s\S]*?<\/div>/g) ?? [];
    expect(sectionTitles.length).toBeGreaterThan(0);
    for (const title of sectionTitles) {
      expect(title).not.toContain('class="dot');
    }
    expect(dashboardHtml).not.toContain(".section-title .dot");
    // Decorative per-row dots are stripped (skills categories, processes labels).
    expect(dashboardHtml).not.toContain("skill-cat-dot");
    expect(dashboardHtml).not.toContain("live-pulse-dot");
    expect(dashboardHtml).not.toContain("navTerminalsDot");
    expect(dashboardHtml).not.toContain("navProcessesDot");
    // Plan to-do dots survive only for good (completed) and attention (cancelled).
    const statusDotFn = dashboardHtml.match(/function statusDot\(status\) \{[\s\S]*?\n\}/);
    expect(statusDotFn).not.toBeNull();
    expect(statusDotFn?.[0]).toContain("completed: 'dot-green'");
    expect(statusDotFn?.[0]).toContain("cancelled: 'dot-red'");
    expect(statusDotFn?.[0]).not.toContain("in_progress");
    expect(statusDotFn?.[0]).not.toContain("pending");
    // Surviving state dots stay paired with labels: health checks keep severity text.
    expect(dashboardHtml).toContain("healthDotClass");
    expect(dashboardHtml).toContain("health-item-sev");
  });

  it("syncs tabs with the URL hash for deep-linkable navigation", () => {
    expect(dashboardHtml).toContain("function sectionFromHash()");
    expect(dashboardHtml).toContain("function syncSectionHash(id)");
    expect(dashboardHtml).toContain("window.addEventListener('hashchange'");
    expect(dashboardHtml).toContain("history.replaceState");
    expect(dashboardHtml).toContain("let activeSectionId = sectionFromHash()");
  });

  it("does not offer a Copy start header control (terminal: npm run dashboard / agent-kit dashboard)", () => {
    expect(dashboardHtml).not.toContain("btn-copy-start");
    expect(dashboardHtml).not.toContain("copyStartCommand");
    expect(dashboardHtml).not.toContain("serverOfflineAction");
    expect(dashboardHtml).not.toContain("Copy start");
  });

  it("visually distinguishes all plan lifecycle states", () => {
    const visualKeys = ["executing", "awaiting", "parked", "backlog", "incomplete", "completed"];
    for (const key of visualKeys) {
      expect(dashboardHtml).toContain(`lifecycle-pill-${key}`);
    }
    // Card markup still emits lifecycle class hooks; color is pills only (no left-bar CSS).
    expect(dashboardHtml).toContain('class="recent-plan-card recent-plan-card-${life.key}"');
    for (const state of lifecycleStates) {
      expect(LIFECYCLE_SORT_RANK_SOURCE()).toContain(`${state}:`);
    }
    expect(dashboardHtml).toContain("awaiting_user: { key: 'awaiting'");
  });

  it("distinguishes all six plan lifecycle keys without relying on color alone", () => {
    // Class presence + fill color is not enough: each visual key must carry a
    // non-color cue (unique visible label; mark in lifecycleMeta; label in aria).
    // Marks follow the frozen character-mark table (no emojis; unique per state).
    const nonColorCues: Array<{ key: string; label: string; mark: string }> = [
      { key: "executing", label: "Executing", mark: "\\u25B6" },
      { key: "awaiting", label: "Awaiting", mark: "\\u23EF" },
      { key: "parked", label: "Parked", mark: "\\u20E0" },
      { key: "backlog", label: "Backlog", mark: "\\u23F9" },
      { key: "incomplete", label: "Incomplete", mark: "\\u26A0" },
      { key: "completed", label: "Completed", mark: "\\u2713" },
    ];
    expect(nonColorCues).toHaveLength(6);
    expect(new Set(nonColorCues.map((c) => c.label)).size).toBe(6);
    expect(new Set(nonColorCues.map((c) => c.key)).size).toBe(6);

    const lifecycleMetaFn = dashboardHtml.match(
      /function lifecycleMeta\(lifecycle\) \{[\s\S]*?\n\}/,
    );
    expect(lifecycleMetaFn).not.toBeNull();
    const meta = lifecycleMetaFn?.[0] ?? "";

    for (const { key, label, mark } of nonColorCues) {
      expect(meta, `${key} must map a unique label`).toContain(`key: '${key}'`);
      expect(meta).toContain(`label: '${label}'`);
      expect(meta).toContain(`mark: '${mark}'`);
      expect(dashboardHtml).toContain(`lifecycle-pill-${key}`);
    }

    // Checklist + Plans pills emit the label text (not color-only chrome).
    expect(dashboardHtml).toContain("${escapeHtml(life.label)}");
    // Card aria-label includes the lifecycle label so AT gets the same cue.
    expect(dashboardHtml).toContain(
      'aria-label="Plan ${escapeAttr(p.id)} (${escapeAttr(p.progressLabel)}, ${escapeAttr(life.label)})"',
    );
    // Checklist pill markup emits the character mark (not just the meta map).
    expect(dashboardHtml).toContain(
      '<span class="lifecycle-pill-mark" aria-hidden="true">${life.mark}</span>',
    );
  });

  it("renders lifecycle labels as solid fills with no outline", () => {
    // Lifecycle pill base: solid fill, no perimeter stroke.
    const sharedBase = dashboardHtml.match(/\.lifecycle-pill\s*\{([^}]+)\}/);
    expect(sharedBase).not.toBeNull();
    expect(sharedBase?.[1]).toMatch(/border:\s*none/);
    expect(sharedBase?.[1]).not.toMatch(/border:\s*1px\s+solid/);
    // Visual casing is CSS uppercase; JS label maps stay Title Case.
    expect(sharedBase?.[1]).toMatch(/text-transform:\s*uppercase/);
    // Type aligns to the Cursor chrome meta ladder, not a hard-coded 10px.
    expect(sharedBase?.[1]).toMatch(/font-size:\s*var\(--mc-chrome-meta-size\)/);
    expect(sharedBase?.[1]).not.toMatch(/font-size:\s*10px/);

    // Lifecycle variants carry a solid semantic surface + matching text color.
    const lifecycleFills: Array<[string, string]> = [
      ["executing", "blue"],
      ["awaiting", "yellow"],
      ["parked", "purple"],
      ["backlog", "cyan"],
      ["incomplete", "orange"],
      ["completed", "green"],
    ];
    for (const [key, color] of lifecycleFills) {
      expect(dashboardHtml).toMatch(
        new RegExp(
          `\\.lifecycle-pill-${key}\\s*\\{[^}]*background:\\s*var\\(--${color}-bg\\)[^}]*color:\\s*var\\(--${color}\\)`,
        ),
      );
    }

    // Retired FR attention-severity chip CSS must stay gone.
    expect(dashboardHtml).not.toMatch(/\.attention-severity(-\w+)?\s*\{/);
    // Orange semantic surface token exists for incomplete fills.
    expect(dashboardHtml).toContain("--orange-bg:");

    // Queue-role pill: stroke-free, transparent fill (color + mark cue only).
    const queueRoleBase = dashboardHtml.match(/\.queue-role-pill\s*\{([^}]+)\}/);
    expect(queueRoleBase).not.toBeNull();
    expect(queueRoleBase?.[1]).toMatch(/border:\s*none/);
    expect(queueRoleBase?.[1]).not.toMatch(/border:\s*1px\s+solid/);
    expect(queueRoleBase?.[1]).toMatch(/background:\s*transparent/);
    expect(queueRoleBase?.[1]).toMatch(/text-transform:\s*uppercase/);
    // Queue-role variants: color token + transparent background (no *-bg fill).
    const queueRoleColors: Array<[string, string]> = [
      ["next-up", "blue"],
      ["queued", "cyan"],
      ["executing", "blue"],
      ["done", "green"],
    ];
    for (const [key, color] of queueRoleColors) {
      expect(dashboardHtml).toMatch(
        new RegExp(
          `\\.queue-role-pill-${key}\\s*\\{[^}]*color:\\s*var\\(--${color}\\)[^}]*background:\\s*transparent`,
        ),
      );
      expect(dashboardHtml).not.toMatch(
        new RegExp(`\\.queue-role-pill-${key}\\s*\\{[^}]*var\\(--${color}-bg`),
      );
    }
  });

  it("presentation contract: no Checklist/Field Report/Monitor activity left bars; muted active nav", () => {
    // Activity type is icon/label only; no colored left rail on .activity-item.
    expect(dashboardHtml).not.toMatch(/\.activity-item\.activity-\w+\s*\{[^}]*border-left/);
    expect(dashboardHtml).not.toMatch(/style="[^"]*border-left:\s*3px\s+solid\s+\$\{info\.color\}/);
    expect(dashboardHtml).not.toContain("activityClass(");
    expect(dashboardHtml).not.toMatch(/activity-item \$\{activityClass/);

    // Retired FR attention-item stack CSS must stay gone (Flight Log uses flight-log-*).
    expect(dashboardHtml).not.toMatch(/\.attention-item\s*\{/);
    expect(dashboardHtml).not.toContain("attention-item-${sev.key}");
    expect(dashboardHtml).not.toContain("attention-item-action");
    expect(dashboardHtml).not.toContain("attention-item-warning");
    expect(dashboardHtml).not.toContain("attention-item-info");
    expect(dashboardHtml).not.toContain("attention-severity-${sev.key}");

    const recentCardBlock = dashboardHtml.match(/\.recent-plan-card\s*\{[^}]+\}/);
    expect(recentCardBlock).not.toBeNull();
    expect(recentCardBlock?.[0]).not.toMatch(/border-left/);
    expect(dashboardHtml).not.toMatch(/\.recent-plan-card-\w+\s*\{[^}]*border-left/);

    const activeAnchor = dashboardHtml.match(/\.top-nav-anchor\.active\s*\{[^}]+\}/);
    expect(activeAnchor).not.toBeNull();
    expect(activeAnchor?.[0]).toMatch(/border-color:\s*transparent/);
    expect(activeAnchor?.[0]).not.toMatch(/border-color:\s*var\(--blue\)/);
    expect(activeAnchor?.[0]).toMatch(/background:\s*var\(--bg-card-hover\)/);
    expect(dashboardHtml).toContain(".top-nav-anchor:focus-visible");
    expect(dashboardHtml).toContain('aria-current="true"');
  });
});

/** Executes the shipped activity row attribute builder (copy-only contract). */
function loadActivityTargetAttributes() {
  const sources = [
    /function escapeHtml\(value\) \{[\s\S]*?\n\}/,
    /function escapeAttr\(value\) \{[\s\S]*?\n\}/,
    /function escapeJsString\(value\) \{[\s\S]*?\n\}/,
    /const PASTE_DESTINATIONS = \{[\s\S]*?\};/,
    /function pasteDestinationLabel\(destination\) \{[\s\S]*?\n\}/,
    /function isPasteOnlyShellTarget\(text\) \{[\s\S]*?\n\}/,
    /const PROMPT_RESUME_GUIDANCE =\s*[\s\S]*?;/,
    /function copyActionTitle\(subject, destination, text\) \{[\s\S]*?\n\}/,
    /function pathActionTitle\(relPath\) \{[\s\S]*?\n\}/,
    /function isSafeRepoRelativePath\(relPath\) \{[\s\S]*?\n\}/,
    /function looksLikeCommitSha\(target\) \{[\s\S]*?\n\}/,
    /function activityTargetAttributes\(ev, focusPrefix, opts\) \{[\s\S]*?\n\}/,
  ].map((re) => {
    const match = dashboardHtml.match(re);
    expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
    return match?.[0];
  });
  return new Function(`${sources.join("\n")}\nreturn activityTargetAttributes;`)() as (
    ev: {
      id?: string;
      label?: string;
      sourcePath?: string | null;
      refs?: { sha?: string; [key: string]: unknown };
    },
    focusPrefix: string,
    opts?: { kindGloss?: string },
  ) => string;
}

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
    expect(dashboardHtml).toContain("/logo-cursor.svg");
    expect(dashboardHtml).not.toContain("/dashboard/logo.svg");
    // Decorative next to the visible product name, so it carries no alt text.
    expect(dashboardHtml).toMatch(
      /<img class="logo"[^>]*id="headerLogo"[^>]*src="\/logo\.svg"[^>]*alt=""[^>]*aria-hidden="true"|<img class="logo"[^>]*src="\/logo\.svg"[^>]*id="headerLogo"[^>]*alt=""[^>]*aria-hidden="true"/,
    );
  });

  it("switches header and favicon assets by interface skin", () => {
    expect(dashboardHtml).toContain("logo-cursor.svg");
    expect(dashboardHtml).toMatch(/headerLogo[\s\S]*logo-cursor\.svg|logoSrc = next === 'cursor'/);
    expect(dashboardHtml).toContain("getElementById('favicon')");
    expect(dashboardHtml).toContain("getElementById('headerLogo')");
  });

  it("ships the space icon set with a name for every kind", () => {
    // Runs the shipped function rather than reading its source, so an icon
    // that loses its accessible name fails here.
    const spaceIconSvg = loadSpaceIconSvg();
    const names: Record<string, string> = {
      "current-mission": "Current mission",
      monitor: "Crew Monitor",
      "field-report": "Flight Log",
      checklist: "Checklist",
      "more-sections": "More sections",
      // More-menu section icons (12 kinds) + skins affordance
      overview: "Home",
      plans: "Plans",
      activity: "Activity",
      agents: "Agents",
      skills: "Skills",
      skins: "Skins",
      commands: "Commands",
      health: "Health",
      git: "Git",
      memory: "Memory",
      terminals: "Terminals",
      processes: "Processes",
      config: "Config",
    };
    for (const [kind, name] of Object.entries(names)) {
      const decorative = spaceIconSvg(kind);
      expect(decorative, `${kind} must render`).toContain('<svg class="space-icon"');
      expect(decorative).toContain('aria-hidden="true"');
      expect(decorative).not.toContain('role="img"');
      expect(decorative).toContain('stroke-width="1.5"');

      const labelled = spaceIconSvg(kind, { decorative: false });
      expect(labelled).toContain('role="img"');
      expect(labelled).toContain(`aria-label="${name}"`);
      expect(labelled).toContain(`title="${name}"`);
    }
    // Home house: roof meets walls (no split roof/base gap); door interior stays above the stroke floor.
    const home = spaceIconSvg("overview");
    expect(home).toContain("M2.5 7.5L8 2.75l5.5 4.75");
    expect(home).toContain("M4.25 7.75v6.5h7.5v-6.5");
    expect(home).toContain("M6.5 14.25v-3.25h3v3.25");
    expect(home).not.toContain("M4.5 10v4h3M11.5 10v4h-3");
    expect(home).not.toContain("M6.75 14.25v-3.25h2.5v3.25");
    // Skins palette swatches (not Skills gear).
    const skins = spaceIconSvg("skins");
    expect(skins).toContain('<rect x="2.5" y="3.5"');
    expect(skins).not.toContain("M10.5 8a2.5 2.5 0 000-2.5");
    // Flight Log clipboard kind contract preserved.
    const flightLog = spaceIconSvg("field-report");
    expect(flightLog).toContain('<rect x="4.5" y="3.5" width="7" height="10"');
    expect(spaceIconSvg("not-a-kind")).toBe("");
    // Inline SVG only: no icon font, sprite fetch, or frontend dependency.
    expect(dashboardHtml).not.toMatch(/font-awesome|material-icons|iconify/i);
  });

  it("keeps every space-icon glyph at or above the stroke-1.5 legibility floor", () => {
    const spaceIconSvg = loadSpaceIconSvg();
    const kinds = [
      "current-mission",
      "monitor",
      "field-report",
      "checklist",
      "more-sections",
      "overview",
      "plans",
      "activity",
      "agents",
      "skills",
      "skins",
      "commands",
      "health",
      "git",
      "memory",
      "terminals",
      "processes",
      "config",
    ];
    // No stroked circle may be smaller than the stroke that draws it
    // (filled accents opt out via stroke="none" and stay solid at any size).
    for (const kind of kinds) {
      const svg = spaceIconSvg(kind);
      for (const m of svg.matchAll(/<circle[^>]*\sr="([\d.]+)"([^>]*)\/?>/g)) {
        if ((m[2] || "").includes('stroke="none"')) continue;
        expect(
          Number(m[1]),
          `${kind} stroked circle radius ${m[1]} is below the stroke-1.5 floor`,
        ).toBeGreaterThan(0.75);
      }
    }
    // Radar: two rings (1.25 clearance), no centre dot below the floor.
    const radar = spaceIconSvg("monitor");
    expect(radar).toContain('<circle cx="8" cy="8" r="2.75"/>');
    expect(radar).not.toContain('<circle cx="8" cy="8" r="1.5"/>');
    expect(radar).not.toContain('r=".55"');
    // Gear: spokes sit outside the ring instead of arcs burying into it.
    const gear = spaceIconSvg("skills");
    expect(gear).toContain('<circle cx="8" cy="8" r="2"/>');
    expect(gear).toContain("M8 5V3.5");
    expect(gear).not.toContain("M10.5 8a2.5 2.5 0 000-2.5");
    // Rocket window: solid dot, not a sub-stroke ring.
    const rocket = spaceIconSvg("current-mission");
    expect(rocket).toContain('<circle cx="8" cy="7.5" r="1" fill="currentColor" stroke="none"/>');
    expect(rocket).not.toContain('r=".9"');
    // Chip: two internal lines with 1.5 clearance, not three at 0.5.
    const chip = spaceIconSvg("memory");
    expect(chip).toContain("M6 6.5h4M6 9.5h2.5");
    expect(chip).not.toContain("M6 8.5h4");
    // Home door interior pin (paired with overview glyph contract).
    const home = spaceIconSvg("overview");
    // Ellipsis: adjacent dots must clear each other (no tangency or fusion).
    const more = spaceIconSvg("more-sections");
    const dots = [...more.matchAll(/<circle cx="([\d.]+)" cy="8" r="([\d.]+)"([^>]*)\/?>/g)].map(
      (m) => ({
        cx: Number(m[1]),
        reach: Number(m[2]) + ((m[3] || "").includes('stroke="none"') ? 0 : 0.75),
      }),
    );
    expect(dots).toHaveLength(3);
    for (let i = 1; i < dots.length; i++) {
      const gap = dots[i].cx - dots[i - 1].cx - dots[i].reach - dots[i - 1].reach;
      expect(gap, `more-sections dots ${i - 1}/${i} fuse (gap ${gap})`).toBeGreaterThanOrEqual(1);
    }
    // Chip internal lines: vertical clearance between the two strokes is ≥ 1 unit.
    const chipPaths = [...chip.matchAll(/M6 ([\d.]+)h/g)].map((m) => Number(m[1]));
    expect(chipPaths.length).toBeGreaterThanOrEqual(2);
    expect(chipPaths[1] - chipPaths[0], "memory chip line clearance").toBeGreaterThanOrEqual(1);
    // Home door interior: opening height stays above the stroke floor (≥ 1 unit usable).
    expect(home).toMatch(/M6\.5 14\.25v-([\d.]+)h/);
    const doorDrop = Number(home.match(/M6\.5 14\.25v-([\d.]+)h/)?.[1] || 0);
    expect(doorDrop, "overview door interior height").toBeGreaterThanOrEqual(3);
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
    const fallback = serveSource.match(
      /version: ['"]error['"],[\s\S]*?missionControl: null,\s*\}\);/,
    );
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

  it("binds the client isSafeRepoRelativePath path cap to guards.mjs MAX_GIT_PATH", () => {
    // The client copy of isSafeRepoRelativePath hardcodes its length cap and
    // carries a "Keep in sync with dashboard/lib/guards.mjs" comment. Assert the
    // literal bound matches the exported constant so the two cannot drift.
    const clientFn = dashboardHtml.match(
      /function isSafeRepoRelativePath\(relPath\) \{[\s\S]*?\n\}/,
    );
    expect(clientFn).not.toBeNull();
    const boundMatch = clientFn?.[0].match(/p\.length > (\d+)/);
    expect(boundMatch, "client path cap literal must exist").not.toBeNull();
    expect(Number(boundMatch?.[1])).toBe(MAX_GIT_PATH);
  });

  it("keeps XSS escape helpers and uses them for dynamic labels", () => {
    expect(dashboardHtml).toContain("function escapeHtml(value)");
    expect(dashboardHtml).toContain("function escapeAttr(value)");
    expect(dashboardHtml).toContain("function escapeJsString(value)");
    expect(dashboardHtml).toMatch(/escapeHtml\(ev\.label\)/);
    // Flight Log cards escape Gaps text and source path.
    expect(dashboardHtml).toMatch(/escapeHtml\(text\)/);
    expect(dashboardHtml).toMatch(/escapeHtml\(sourcePath\)/);
  });

  it("keeps serve.mjs mutation surface limited to loopback allowlisted /api/config", () => {
    expect(serveSource).toContain("/api/events");
    expect(serveSource).toContain("/dashboard-data.json");
    expect(serveSource).toContain("/api/config");
    expect(serveSource).toContain("handleConfigWrite");
    expect(serveSource).toContain("validateConfigWriteBody");
    expect(serveSource).toContain("isLoopbackAddress");
    expect(serveSource).toContain("resolveBroadcastAuth");
    expect(serveSource).toContain("authorizeMissionControlRequest");
    expect(serveSource).toMatch(/req\.method\s*===\s*['"]PUT['"]/);
    expect(serveSource).toMatch(/req\.method\s*===\s*['"]PATCH['"]/);
    expect(serveSource).not.toMatch(/req\.method\s*===\s*['"]POST['"]/);
    expect(serveSource).toContain("writeFileSync");
    expect(serveSource).not.toMatch(/rmSync|unlinkSync/);
    expect(serveSource).toContain("applyCorsHeaders");
    expect(serveSource).toContain("resolveDashboardStatic");
  });

  it("wires broadcast token helpers into the panel client", () => {
    expect(dashboardHtml).toContain("function withMissionControlAuth(");
    expect(dashboardHtml).toContain("function missionControlAuthToken(");
    expect(dashboardHtml).toContain("withMissionControlAuth('/api/events')");
  });

  it("exposes Config in the More menu with a Save form bound to /api/config", () => {
    expect(dashboardHtml).toContain('data-section="config"');
    expect(dashboardHtml).toContain("onclick=\"return showSection('config')\"");
    expect(dashboardHtml).toContain('aria-label="Config section"');
    expect(dashboardHtml).toMatch(/data-section="config"[^>]*>[\s\S]*?\bConfig\b/);
    // Home stays first; Config sits before Skins separator.
    expect(dashboardHtml).toMatch(
      /id="navMoreMenu"[\s\S]*?data-section="overview"[\s\S]*?data-section="config"[\s\S]*?id="navSkinsLabel"/,
    );
    expect(dashboardHtml).toContain('id="section-config"');
    expect(dashboardHtml).toContain("function saveMissionConfig(");
    expect(dashboardHtml).toContain("/api/config");
    expect(dashboardHtml).toMatch(/method:\s*['"]PATCH['"]/);
    expect(dashboardHtml).toContain('id="config-save-btn"');
  });

  it("pins Config tab chrome: grid layout, Save on top, trimmed hints", () => {
    // Grid layout, not vertical-only.
    expect(dashboardHtml).toMatch(
      /\.config-form\s*\{[^}]*display:\s*grid[^}]*grid-template-columns/,
    );
    // Save Configuration pinned in a top actions bar, before the first fieldset.
    expect(dashboardHtml).toContain('class="config-actions"');
    expect(dashboardHtml).toMatch(
      /<form class="config-form"[\s\S]*?config-save-btn[\s\S]*?config-fieldset/,
    );
    expect(dashboardHtml.indexOf('id="config-save-btn"')).toBeLessThan(
      dashboardHtml.indexOf("Read-only"),
    );
    // Wide fieldsets span the grid; persona mode selects use a two-column grid.
    expect(dashboardHtml).toContain("config-fieldset-wide");
    expect(dashboardHtml).toContain("config-grid-2");
    // Helper-text slop stays trimmed.
    expect(dashboardHtml).not.toContain("What it does:");
    expect(dashboardHtml).not.toContain("0 disables cooldown (default for named-model runs)");
  });

  it("pins Config tab copy-CRUD fallback: per-fieldset snippets, copy-only, dead-control hints", () => {
    // One copy-snippet button per writable fieldset (Read-only fieldset has none).
    expect(dashboardHtml).toContain('data-focus-key="config-copy-session"');
    expect(dashboardHtml).toContain('data-focus-key="config-copy-updateCheck"');
    expect(dashboardHtml).toContain('data-focus-key="config-copy-audits"');
    expect(dashboardHtml).toContain('data-focus-key="config-copy-personas"');
    // Never-writable knobs still get copy-only static snippets (allowlist unchanged).
    expect(dashboardHtml).toContain('data-focus-key="config-copy-updateApply"');
    expect(dashboardHtml).toContain('data-focus-key="config-copy-dogfood"');
    expect(dashboardHtml).toContain("function copyStaticConfigSnippet(");
    expect(dashboardHtml).toContain("CONFIG_STATIC_SNIPPETS");
    expect(dashboardHtml.match(/btn-config-copy/g)?.length).toBeGreaterThanOrEqual(6);
    // Snippet builder shares the save payload and stays copy-only (no fetch).
    expect(dashboardHtml).toContain("function collectMissionConfigPayload(");
    expect(dashboardHtml).toContain("function copyConfigSnippet(");
    const copyFn = dashboardHtml.match(/function copyConfigSnippet\([\s\S]*?\n\}/)?.[0];
    expect(copyFn).toBeTruthy();
    expect(copyFn).toContain("copyToClipboard");
    expect(copyFn).not.toContain("fetch(");
    expect(copyFn).not.toContain("/api/config");
    const staticFn = dashboardHtml.match(/function copyStaticConfigSnippet\([\s\S]*?\n\}/)?.[0];
    expect(staticFn).toBeTruthy();
    expect(staticFn).not.toContain("fetch(");
    expect(staticFn).not.toContain("/api/config");
    // Clipboard failure toast truncates long snippets instead of dumping the full body.
    expect(dashboardHtml).toContain("const preview = raw.length > 120");
    // Audits backend cascade is writable (auto / claude / cursor); updateApply.auto never writable.
    expect(dashboardHtml).toContain("auto uses Claude when usable, else Cursor Agent.");
    expect(dashboardHtml).not.toContain("claude is the only backend today.");
    expect(dashboardHtml).toContain('option value="auto"');
    expect(dashboardHtml).toContain('option value="cursor"');
    expect(dashboardHtml).toContain('id="config-epr-reviewerModel"');
    expect(dashboardHtml).toContain('id="config-epr-waitSlice"');
    expect(dashboardHtml).toContain("updateApply.auto is never writable here.");
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
    // Contract change: parked + zero open → completed (was parked).
    expect(classifyPlan(plans[1], handoff)).toBe("completed");
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
        // Unshipped staging stays as a raw row; merge below becomes delivery only.
        "abc1234 chore: git staging after tick",
        "4d5a8b3 Merge pull request #207 from agent-kit-startup/feat/cursor-native",
      ],
      readinessPending: [],
    });

    expect(view.now.status).toBe("executing");
    expect(view.now.currentTodo?.id).toBe("plugin-ux-validation");
    expect(view.activity.some((e) => e.kind === "run_plan")).toBe(true);
    // Disposition E: drop raw merge rows superseded by delivery (Monitor keeps delivery).
    expect(view.activity.some((e) => e.kind === "delivery")).toBe(true);
    expect(view.activity.some((e) => e.kind === "merge")).toBe(false);
    expect(view.activity.some((e) => e.kind === "staging")).toBe(true);
    const deliveryShas = new Set(
      view.activity.filter((e) => e.kind === "delivery").flatMap((e) => e.refs?.commits || []),
    );
    const gitShas = view.activity
      .filter((e) => e.kind === "merge" || e.kind === "commit" || e.kind === "staging")
      .map((e) => e.refs?.sha)
      .filter(Boolean);
    expect(gitShas.every((sha) => !deliveryShas.has(sha))).toBe(true);
    expect(view.activity.every((e) => !["refresh", "heartbeat", "process"].includes(e.kind))).toBe(
      true,
    );
    // Without agentPrompts input, no prompt rows; plan-state NOTES stay off Field Report.
    expect(view.attention.some((i) => i.kind === "prompt")).toBe(false);
    expect(view.attention.some((i) => i.kind === "parked")).toBe(false);
    expect(view.attention.some((i) => i.kind === "incomplete")).toBe(false);
    expect(view.checklistNotes).toEqual([]);
    expect(view.plans.find((p) => p.file === "parked-plan.plan.md")?.parked).toBe(true);
  });

  it("attributes each delivery from its merge branch, never the active plan", () => {
    const handoff = parseHandoffMarkdown(`# Handoff
- **Plan:** \`active-plan.plan.md\`
- **Mode:** Night shift: /run-plan orchestrated
- **Next to-dos:** \`plugin-ux-validation\`
`);
    const view = buildMissionControlView({
      plans: [
        ...plans,
        {
          id: "monitor-agent-activity-focus",
          file: "monitor-agent-activity-focus.plan.md",
          path: ".cursor/plans/monitor-agent-activity-focus.plan.md",
          overview: "Monitor focus",
          agent: "monitor-agent-activity-focus",
          todos: {
            total: 1,
            completed: 1,
            pending: 0,
            inProgress: 0,
            items: [{ id: "done", content: "Done", status: "completed" }],
          },
        },
      ],
      handoff,
      gitLogLines: [
        "e1182a1 Merge pull request #325 from agent-kit-startup/docs/index-one-fold-monitors",
        "cbc68ca docs(memory): index desktop one-fold and field-report monitors",
        "528901c Merge pull request #321 from agent-kit-startup/feat/monitor-agent-activity-focus",
        "6051036 feat(dashboard): refocus Monitor hero on agent activity",
        "fbde80a Merge pull request #317 from agent-kit-startup/update/field-report-flat-list",
      ],
      readinessPending: [],
    });

    const deliveries = view.activity.filter((e) => e.kind === "delivery");
    expect(deliveries).toHaveLength(3);
    expect(
      deliveries.map((e) => ({
        pr: e.refs?.pr,
        sha: e.refs?.sha,
        plan: e.refs?.plan,
        agent: e.agent,
      })),
    ).toEqual([
      { pr: 325, sha: "e1182a1", plan: null, agent: null },
      {
        pr: 321,
        sha: "528901c",
        plan: "monitor-agent-activity-focus.plan.md",
        // Plan-slug agent is invalid; kit agent id required.
        agent: null,
      },
      { pr: 317, sha: "fbde80a", plan: null, agent: null },
    ]);
    // Merge-anchored coalesce: the feature commit beneath a merge is absorbed
    // into that merge's delivery instead of being dropped from the Monitor.
    const pr321 = deliveries.find((e) => e.refs?.pr === 321);
    expect(pr321?.refs?.commits).toEqual(["528901c", "6051036"]);
    expect(deliveries.every((e) => e.refs?.plan !== "active-plan.plan.md")).toBe(true);
    // Unified Activity: each merge SHA appears once (as delivery, not also as merge).
    expect(view.activity.some((e) => e.kind === "merge")).toBe(false);
    expect(view.activity.some((e) => e.kind === "commit" && e.refs?.sha === "6051036")).toBe(false);
  });

  it("keeps open parked plans as parked and does not force exhausted HANDOFF to executing", () => {
    const openParked = {
      id: "parked-open",
      file: "parked-open.plan.md",
      path: ".cursor/plans/parked-open.plan.md",
      overview: "Open parked",
      todos: {
        total: 1,
        completed: 0,
        pending: 1,
        inProgress: 0,
        items: [{ id: "left", content: "Left", status: "pending" }],
      },
    };
    const doneActive = {
      id: "exhausted-plan",
      file: "exhausted-plan.plan.md",
      path: ".cursor/plans/exhausted-plan.plan.md",
      overview: "Exhausted",
      todos: {
        total: 1,
        completed: 1,
        pending: 0,
        inProgress: 0,
        items: [{ id: "done", content: "Done", status: "completed" }],
      },
    };
    expect(
      classifyPlan(openParked, {
        plan: "exhausted-plan.plan.md",
        parkedPlans: ["parked-open.plan.md"],
      }),
    ).toBe("parked");
    const now = buildMissionControlView({
      plans: [doneActive, openParked],
      handoff: {
        plan: "exhausted-plan.plan.md",
        mode: "STOPPED (run-plan orchestrated; plan exhausted)",
        parkedPlans: ["parked-open.plan.md"],
      },
    }).now;
    expect(now.status).toBe("completed");
    expect(now.status).not.toBe("idle");
    expect(now.status).not.toBe("executing");
    expect(now.planFile).toBe("exhausted-plan.plan.md");
    expect(now.planId).toBe("exhausted-plan");
    expect(now.progress).toEqual({ completed: 1, total: 1 });
    expect(now.lifecycle).toBe("completed");
  });

  it("completed mission contract: idle only when HANDOFF has no plan reference", () => {
    const view = buildMissionControlView({
      plans: [
        {
          id: "any-plan",
          file: "any-plan.plan.md",
          path: ".cursor/plans/any-plan.plan.md",
          overview: "Any",
          todos: {
            total: 1,
            completed: 1,
            pending: 0,
            inProgress: 0,
            items: [{ id: "done", content: "Done", status: "completed" }],
          },
        },
      ],
      handoff: null,
    });
    expect(view.now.status).toBe("idle");
    expect(view.now.planId).toBeNull();
    expect(view.now.planFile).toBeNull();
    expect(view.now.planPath).toBeNull();
    expect(view.now.progress).toEqual({ completed: 0, total: 0 });
  });
});

describe("cockpit checklist: plan cards only (notes moved to Field Report)", () => {
  it("Checklist Actions menu includes Run (manual)/(auto)/Edit/Cancel plus Copy path", () => {
    const checklistRenderer = dashboardHtml.match(
      /function renderRecentPlanCards\([\s\S]*?(?=\nfunction renderPlansAccordion)/,
    )?.[0];
    expect(checklistRenderer).toBeTruthy();
    expect(checklistRenderer).toContain("checklistPlanActionCommands");
    expect(checklistRenderer).toContain("toggleRecentPlanActions");
    expect(checklistRenderer).toContain("copyChecklistPlanAction");
    expect(checklistRenderer).toContain("copyChecklistPlanPath");
    expect(checklistRenderer).toContain('aria-haspopup="menu"');
    expect(checklistRenderer).toContain(">Actions</button>");
    expect(checklistRenderer).toContain(">Run (manual)</button>");
    expect(checklistRenderer).toContain(">Run (auto)</button>");
    expect(checklistRenderer).toContain(">Edit</button>");
    expect(checklistRenderer).toContain(">Cancel</button>");
    expect(checklistRenderer).toContain("${PATH_COPY_LABEL}");
    // Locked clipboard destinations (basename from plan.file).
    expect(dashboardHtml).toContain("runManual: `/continue-plan ${basename}`");
    expect(dashboardHtml).toContain("runAuto: `/run-plan ${basename}`");
    expect(dashboardHtml).toContain("edit: `/backlog-edit ${basename}`");
    expect(dashboardHtml).toContain("cancel: `/archive-plan ${basename}`");
    // Copy path uses path clipboard (filePicker), not chat paste helper.
    expect(dashboardHtml).toContain("function copyChecklistPlanPath(relPath)");
    expect(dashboardHtml).toMatch(
      /function copyChecklistPlanPath\(relPath\) \{[\s\S]*?copyRepoPath\(relPath\)/,
    );
    // Whole-card path-copy remains removed from Checklist (menu item only).
    expect(checklistRenderer).not.toContain("copyRepoPathHandler");
    // Plans accordion / Field Report path copy remain.
    expect(dashboardHtml).toContain("Copy plan path");
    expect(dashboardHtml).toContain("const PATH_COPY_LABEL = 'Copy path'");
  });

  it("renders Run all on Checklist header that copies /run-plan-all for chat paste", () => {
    const checklistRenderer = dashboardHtml.match(
      /function renderRecentPlanCards\([\s\S]*?(?=\nfunction renderPlansAccordion)/,
    )?.[0];
    expect(checklistRenderer).toBeTruthy();
    expect(checklistRenderer).toContain(">Run all</button>");
    expect(checklistRenderer).toContain('data-focus-key="checklist-add-all"');
    expect(checklistRenderer).toContain("copyForPasteHandler('/run-plan-all'");
    expect(checklistRenderer).toContain("copyActionTitle('/run-plan-all', 'chatInput')");
    // Shared button on empty (0) and populated (N of M) header branches.
    expect(checklistRenderer).toContain("${addAllBtn}");
    const emptyHeader = checklistRenderer?.match(
      /style="margin-left:auto">0<\/span>\s*\$\{addAllBtn\}/,
    );
    const populatedHeader = checklistRenderer?.match(
      /\$\{recent\.length\} of \$\{sorted\.length\}<\/span>\s*\$\{addAllBtn\}/,
    );
    expect(emptyHeader).toBeTruthy();
    expect(populatedHeader).toBeTruthy();
  });

  it("escapes Checklist Actions menu from panel overflow via fixed positioning", () => {
    // Same class of bug as nav More: absolute menus clip under overflow ancestors;
    // a11y tree alone is not sufficient (see memory error 2026-07-25).
    expect(dashboardHtml).toMatch(/\.recent-plan-actions-menu\s*\{[^}]*position:\s*fixed/);
    expect(dashboardHtml).toContain("function positionRecentPlanActions()");
    expect(dashboardHtml).toContain("getBoundingClientRect()");
    expect(dashboardHtml).toContain("positionRecentPlanActions()");
    // Prefer above; flip below when space above is tight (first card).
    expect(dashboardHtml).toContain("openAbove");
    expect(dashboardHtml).toContain("spaceAbove");
    expect(dashboardHtml).toContain("spaceBelow");
    // Reposition while open (resize + captured scroll on Checklist body).
    expect(dashboardHtml).toMatch(
      /window\.addEventListener\(\s*['"]resize['"][\s\S]*?positionRecentPlanActions/,
    );
    expect(dashboardHtml).toMatch(
      /addEventListener\(\s*['"]scroll['"][\s\S]*?positionRecentPlanActions[\s\S]*?true/,
    );
    // CSS contract must not reintroduce absolute upward-only clip.
    expect(dashboardHtml).not.toMatch(
      /\.recent-plan-actions-menu\s*\{[^}]*position:\s*absolute[^}]*bottom:\s*calc/,
    );
    // Painted clip still needs screenshot/rect dogfood; structure/CSS is harness-checkable.
  });

  it("removes the Checklist notes group and label from the panel", () => {
    expect(dashboardHtml).not.toContain("function renderChecklistNotes(d, renderedPlans)");
    expect(dashboardHtml).not.toContain("function checklistNotesForRender");
    expect(dashboardHtml).not.toContain("d.missionControl?.checklistNotes");
    expect(dashboardHtml).not.toContain("Plan states and readiness needing a decision");
    const checklistRenderer = dashboardHtml.match(
      /function renderRecentPlanCards\([\s\S]*?(?=\nfunction renderPlansAccordion)/,
    )?.[0];
    expect(checklistRenderer).toBeTruthy();
    expect(checklistRenderer).not.toContain("renderChecklistNotes");
    expect(checklistRenderer).toContain("recent-plans-grid");
  });

  it("does not keep orphaned Field Report attention filter helpers", () => {
    expect(dashboardHtml).not.toContain("const FIELD_REPORT_KINDS = new Set([");
    expect(dashboardHtml).not.toContain("function fieldReportItemsForRender(items)");
    expect(dashboardHtml).not.toContain("function orderAttentionBySeverity(items)");
    expect(dashboardHtml).not.toContain("function renderAttentionItem(item, idx)");
    expect(dashboardHtml).toContain("function renderAttentionPanel(d, attentionChanged)");
    expect(dashboardHtml).toContain("function flightLogFingerprint(d)");
  });
});

describe("plans tab v2: actionable rows, live status bar, next action", () => {
  const plansRenderer = () =>
    dashboardHtml.match(/function renderPlansAccordion\([\s\S]*?(?=\nfunction \w+)/)?.[0];

  it("derives the live status bar from frontmatter to-do counts, not enriched labels", () => {
    // To-do items are the source of truth for counts (summary fields are only
    // a fallback when items are absent).
    expect(dashboardHtml).toContain("items.filter((t) => t.status === 'completed').length");
    expect(dashboardHtml).toContain("items.filter((t) => t.status === 'in_progress').length");
    expect(dashboardHtml).toContain("progressLabel: `${completed} of ${total} complete`");
    expect(dashboardHtml).not.toContain("progressLabel: enriched.progress?.label");
    expect(dashboardHtml).toContain("progressInProgress: inProgress");
    expect(dashboardHtml).toContain("nextActionTodo,");
    // Bar carries real progressbar semantics with the live value.
    const renderer = plansRenderer();
    expect(renderer).toBeTruthy();
    expect(renderer).toContain('role="progressbar"');
    expect(renderer).toContain('aria-valuenow="${pct}"');
    expect(renderer).toContain('aria-valuemax="100"');
    expect(renderer).toContain('aria-valuetext="${escapeAttr(p.progressLabel)}"');
    expect(renderer).not.toContain('role="img"');
    // Live signals stay visible as text: in-progress count and next to-do id.
    expect(renderer).toContain("${p.progressInProgress} in progress");
    expect(renderer).toContain("Next: <code>${escapeHtml(p.nextActionTodo.id)}</code>");
  });

  it("fills progress from terminal to-dos and mirrors todoStats in the fallback lifecycle", () => {
    // Phase 0 contract (align-with-todoStats): the fill numerator counts
    // terminal to-dos (completed + cancelled, the TERMINAL_TODO_STATUSES set)
    // so the bar reaches 100% whenever the lifecycle pill says COMPLETED.
    expect(dashboardHtml).toContain("items.filter((t) => t.status === 'cancelled').length");
    expect(dashboardHtml).toContain("Math.round(((completed + cancelled) / total) * 100)");
    expect(dashboardHtml).not.toContain("Math.round((completed / total) * 100)");
    // The label keeps the honest completed-only count and surfaces cancelled
    // explicitly — only when cancelled > 0.
    expect(dashboardHtml).toContain(
      "progressLabel: `${completed} of ${total} complete` + (cancelled > 0 ? ` · ${cancelled} cancelled` : '')",
    );
    expect(dashboardHtml).toContain("progressCancelled: cancelled,");
    // Fallback lifecycle (no missionControl enrichment) mirrors
    // todoStats.open === 0: terminal work exhausting the list is completed.
    expect(dashboardHtml).toContain(
      "if (total > 0 && completed + cancelled >= total && inProgress === 0) {",
    );
    expect(dashboardHtml).not.toContain("if (total > 0 && completed >= total && inProgress === 0)");
  });

  it("computes the next actionable to-do (in_progress first, else first pending)", () => {
    expect(dashboardHtml).toContain("function planNextActionTodo(items)");
    expect(dashboardHtml).toContain("items.find((t) => t.status === 'in_progress')");
    expect(dashboardHtml).toContain("items.find((t) => t.status === 'pending')");
    const renderer = plansRenderer();
    expect(renderer).toContain('class="plan-next-action"');
    expect(renderer).toContain("Next action:");
  });

  it("renders status-aware copy-only actions naming the chat input as paste destination", () => {
    expect(dashboardHtml).toContain("function planTabActions(p)");
    // Per-lifecycle affordances: active/incomplete resume, backlog runs/edits,
    // parked resumes, completed opens (copy path) / archives.
    expect(dashboardHtml).toContain("case 'executing':");
    expect(dashboardHtml).toContain("case 'awaiting_user':");
    expect(dashboardHtml).toContain("case 'backlog':");
    expect(dashboardHtml).toContain("case 'parked':");
    expect(dashboardHtml).toContain("case 'incomplete':");
    expect(dashboardHtml).toContain("case 'completed':");
    // Locked clipboard labels and commands (basename from plan.file).
    expect(dashboardHtml).toContain("Copy resume prompt");
    expect(dashboardHtml).toContain("Copy run command");
    expect(dashboardHtml).toContain("Copy edit command");
    expect(dashboardHtml).toContain("Copy archive command");
    expect(dashboardHtml).toContain("Copy plan path");
    expect(dashboardHtml).toContain("command: `/continue-plan ${basename}`");
    expect(dashboardHtml).toContain("command: `/run-plan ${basename}`");
    expect(dashboardHtml).toContain("command: `/backlog-edit ${basename}`");
    expect(dashboardHtml).toContain("command: `/archive-plan ${basename}`");
    // Chat commands go through the chat-input paste helpers; path stays a
    // file-picker copy. First action per row is visually primary.
    expect(dashboardHtml).toContain(
      "copyForPasteHandler(action.command, action.command, 'chatInput')",
    );
    expect(dashboardHtml).toContain("copyActionTitle(action.command, 'chatInput')");
    expect(dashboardHtml).toContain("copyRepoPathHandler(p.path)");
    expect(dashboardHtml).toContain("plan-action-primary");
    const renderer = plansRenderer();
    expect(renderer).toContain(
      "planTabActions(p).map((action, idx) => renderPlanTabActionButton(action, p, key, idx))",
    );
  });

  it("keeps to-do status dots limited to good/attention states (status via label)", () => {
    const statusDot = dashboardHtml.match(/function statusDot\(status\) \{[\s\S]*?\n\}/)?.[0];
    expect(statusDot).toBeTruthy();
    expect(statusDot).toContain("completed: 'dot-green'");
    expect(statusDot).toContain("cancelled: 'dot-red'");
    expect(statusDot).not.toContain("pending");
    expect(statusDot).not.toContain("in_progress");
  });
});

function LIFECYCLE_SORT_RANK_SOURCE() {
  const match = dashboardHtml.match(/const LIFECYCLE_SORT_RANK = \{[\s\S]*?\};/);
  expect(match).not.toBeNull();
  return match?.[0];
}

function QUEUE_ROLE_SORT_RANK_SOURCE() {
  const match = dashboardHtml.match(/const QUEUE_ROLE_SORT_RANK = \{[\s\S]*?\};/);
  expect(match).not.toBeNull();
  return match?.[0];
}

type StepperNow = ReturnType<typeof buildMissionControlView>["now"];

/**
 * Executes the shipped stepper renderers against real view-model output, so a
 * completed mission that regains a pending-looking step fails the suite.
 */
function loadNowStepRenderers() {
  const sources = [
    /function escapeHtml\(value\) \{[\s\S]*?\n\}/,
    /function escapeAttr\(value\) \{[\s\S]*?\n\}/,
    /function formatElapsedCompact\(ms\) \{[\s\S]*?\n\}/,
    /function formatElapsedPlain\(ms\) \{[\s\S]*?\n\}/,
    /function previousStageElapsedTitle\(now\) \{[\s\S]*?\n\}/,
    /function nowStepTodoText\(todo\) \{[\s\S]*?\n\}/,
    /function nowNextUpText\(nextUpPlan\) \{[\s\S]*?\n\}/,
    /function renderNowStepBar\(now\) \{[\s\S]*?\n\}/,
    /function renderNowCompletedStepper\(now\) \{[\s\S]*?\n\}/,
    /function renderNowStepper\(now, handoff, status, meta\) \{[\s\S]*?\n\}/,
  ].map((re) => {
    const match = dashboardHtml.match(re);
    expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
    return match?.[0];
  });
  return new Function(
    `${sources.join("\n")}\nreturn { renderNowStepBar, renderNowStepper };`,
  )() as {
    renderNowStepBar: (now: StepperNow) => string;
    renderNowStepper: (
      now: StepperNow,
      handoff: unknown,
      status: string,
      meta: { mark: string },
    ) => string;
  };
}

describe("current mission: completed stepper semantics", () => {
  const completedPlan = {
    id: "exhausted-plan",
    file: "exhausted-plan.plan.md",
    path: ".cursor/plans/exhausted-plan.plan.md",
    overview: "Everything shipped",
    modifiedAt: "2026-07-25T12:00:00.000Z",
    todos: {
      total: 3,
      completed: 3,
      pending: 0,
      inProgress: 0,
      items: [
        { id: "phase-zero", content: "Contract", status: "completed" },
        { id: "phase-one", content: "Completed render", status: "completed" },
        { id: "phase-two", content: "Terminal step semantics", status: "completed" },
      ],
    },
  };
  const completedHandoff = {
    plan: "exhausted-plan.plan.md",
    planPath: ".cursor/plans/exhausted-plan.plan.md",
    mode: "STOPPED (run-plan orchestrated; plan exhausted)",
    parkedPlans: [],
    nextTodos: "`phase-two`",
    instruction: "Open a new conversation and pick the next plan.",
  };

  function completedNow() {
    const now = buildMissionControlView({
      plans: [completedPlan],
      handoff: completedHandoff,
    }).now;
    expect(now.status).toBe("completed");
    return now;
  }

  it("renders the final completed to-do as the terminal step", () => {
    const { renderNowStepper } = loadNowStepRenderers();
    const html = renderNowStepper(completedNow(), completedHandoff, "completed", {
      mark: "\u2713",
    });
    expect(html).toContain("now-stepper-complete");
    expect(html).toContain("now-step-final");
    expect(html).toContain("now-step-done");
    expect(html).toContain("Final step");
    expect(html).toContain("phase-two");
    expect(html).toContain("Terminal step semantics");
    expect(html).toContain("\u2713");
  });

  it("states no next action instead of a pending-looking empty step", () => {
    const { renderNowStepper } = loadNowStepRenderers();
    const html = renderNowStepper(completedNow(), completedHandoff, "completed", {
      mark: "\u2713",
    });
    expect(html).toContain("now-step-terminal");
    expect(html).toContain("None: mission complete (3 of 3 steps done)");
    expect(html).not.toContain("now-step-empty");
    expect(html).not.toContain("now-step-current");
    expect(html).not.toContain('now-step-label">Current');
    expect(html).not.toContain("None \u2014 last step");
    expect(html).not.toContain("Awaiting user decision");
    // A finished run must not promote the handoff instruction as work left.
    expect(html).not.toContain("pick the next plan");
  });

  it("keeps accessibility labels aligned with the completed state", () => {
    const { renderNowStepper, renderNowStepBar } = loadNowStepRenderers();
    const now = completedNow();
    const html = renderNowStepper(now, completedHandoff, "completed", { mark: "\u2713" });
    expect(html).toContain(
      'aria-label="Mission complete: final step done, no next step (3 of 3 steps done)"',
    );
    expect(html).not.toContain("Work progression");

    const bar = renderNowStepBar(now);
    expect(bar).toContain('aria-label="Step progress: 3 of 3 steps complete"');
    expect(bar).not.toContain("in progress");
    expect(bar).not.toContain("now-stepbar-seg-current");
    expect(bar.match(/now-stepbar-seg-done/g)?.length).toBe(3);
    expect(bar).toContain(">3 of 3<");
  });

  it("names the run queue next-up plan on the completed Next row", () => {
    const { renderNowStepper } = loadNowStepRenderers();
    const queueHandoff = {
      ...completedHandoff,
      mode: "run-plan-all",
      runQueue: ["exhausted-plan.plan.md", "next-plan.plan.md"],
      queueCursor: 0,
      queueCursorPlan: "exhausted-plan.plan.md",
      queueStatus: "running",
      queueOutcomes: {},
    };
    const now = buildMissionControlView({
      plans: [completedPlan],
      handoff: queueHandoff,
    }).now;
    expect(now.status).toBe("completed");
    expect(now.nextUpPlan).toBe("next-plan.plan.md");
    const html = renderNowStepper(now, queueHandoff, "completed", { mark: "\u2713" });
    expect(html).toContain('now-step-label">Next up<');
    expect(html).toContain("next-plan.plan.md");
    expect(html).toContain("next plan in the run queue");
    expect(html).not.toContain("None: mission complete");
    expect(html).not.toContain("now-step-terminal");
    expect(html).toContain(
      'aria-label="Mission complete: final step done, next up next-plan.plan.md (3 of 3 steps done)"',
    );
  });

  it("keeps None: mission complete when the queue has no further plan", () => {
    const { renderNowStepper } = loadNowStepRenderers();
    const lastInQueueHandoff = {
      ...completedHandoff,
      mode: "run-plan-all",
      runQueue: ["earlier.plan.md", "exhausted-plan.plan.md"],
      queueCursor: 1,
      queueCursorPlan: "exhausted-plan.plan.md",
      queueStatus: "running",
      queueOutcomes: { "earlier.plan.md": "completed" },
    };
    const now = buildMissionControlView({
      plans: [completedPlan],
      handoff: lastInQueueHandoff,
    }).now;
    expect(now.status).toBe("completed");
    expect(now.nextUpPlan).toBeNull();
    const html = renderNowStepper(now, lastInQueueHandoff, "completed", { mark: "\u2713" });
    expect(html).toContain("None: mission complete (3 of 3 steps done)");
    expect(html).toContain("now-step-terminal");
    expect(html).not.toContain("Next up");
  });

  it("still renders previous, current, and next for a live run", () => {
    const { renderNowStepper } = loadNowStepRenderers();
    const runningHandoff = {
      plan: "running-plan.plan.md",
      planPath: ".cursor/plans/running-plan.plan.md",
      mode: "run-plan (orchestrated)",
      parkedPlans: [],
      nextTodos: "`phase-one`",
    };
    const now = buildMissionControlView({
      plans: [
        {
          ...completedPlan,
          id: "running-plan",
          file: "running-plan.plan.md",
          path: ".cursor/plans/running-plan.plan.md",
          todos: {
            total: 3,
            completed: 1,
            pending: 1,
            inProgress: 1,
            items: [
              { id: "phase-zero", content: "Contract", status: "completed" },
              { id: "phase-one", content: "Completed render", status: "in_progress" },
              { id: "phase-two", content: "Terminal step semantics", status: "pending" },
            ],
          },
        },
      ],
      handoff: runningHandoff,
    }).now;
    expect(now.status).toBe("executing");
    const html = renderNowStepper(now, runningHandoff, "executing", { mark: "\u25B6" });
    expect(html).toContain("now-step-previous");
    expect(html).toContain("now-step-current");
    expect(html).toContain("now-step-next");
    expect(html).toContain("Work progression");
    expect(html).not.toContain("now-stepper-complete");
    expect(html).not.toContain("mission complete");
  });
});

/**
 * Field Report card findings markup was retired with the attention-stack UI.
 * Flight Log Gaps + Warnings cards must not revive that render path.
 */
describe("Field Report findings summary on the card", () => {
  it("does not ship renderAttentionItem or attention-findings CSS", () => {
    expect(dashboardHtml).not.toContain("function renderAttentionItem(item, idx)");
    expect(dashboardHtml).not.toMatch(/\.attention-findings\s*\{/);
    expect(dashboardHtml).toContain("function renderFlightLogCard(entry, idx)");
    expect(dashboardHtml).toContain("function renderAttentionPanel(d, attentionChanged)");
  });
});

/**
 * Executes the shipped Checklist queue helpers so the /run-plan-all display
 * sort and the additive queue-role pill are verified against real output.
 */
function loadQueueChecklistHelpers() {
  const lifecycleRank = LIFECYCLE_SORT_RANK_SOURCE();
  const roleRank = QUEUE_ROLE_SORT_RANK_SOURCE();
  const sources = [
    /function escapeHtml\(value\) \{[\s\S]*?\n\}/,
    /function sortPlansForPortfolio\(plans\) \{[\s\S]*?\n\}/,
    /function queueRolePill\(p\) \{[\s\S]*?\n\}/,
  ].map((re) => {
    const match = dashboardHtml.match(re);
    expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
    return match?.[0];
  });
  return new Function(
    `${lifecycleRank}\n${roleRank}\n${sources.join("\n")}\nreturn { sortPlansForPortfolio, queueRolePill };`,
  )() as {
    sortPlansForPortfolio: (plans: object[]) => Array<{ file: string }>;
    queueRolePill: (p: object) => string;
  };
}

describe("checklist: run-plan-all queue roles and display sort", () => {
  it("sorts by role-priority (executing above next_up above queued above completed_in_queue)", () => {
    const { sortPlansForPortfolio } = loadQueueChecklistHelpers();
    const sorted = sortPlansForPortfolio([
      {
        file: "outside.plan.md",
        lifecycle: "executing",
        queueRole: "none",
        queueIndex: null,
        modifiedAt: null,
      },
      {
        file: "c.plan.md",
        lifecycle: "backlog",
        queueRole: "queued",
        queueIndex: 2,
        modifiedAt: null,
      },
      {
        file: "a.plan.md",
        lifecycle: "completed",
        queueRole: "completed_in_queue",
        queueIndex: 0,
        modifiedAt: null,
      },
      {
        file: "b.plan.md",
        lifecycle: "executing",
        queueRole: "executing",
        queueIndex: 1,
        modifiedAt: null,
      },
      {
        file: "next.plan.md",
        lifecycle: "backlog",
        queueRole: "next_up",
        queueIndex: 3,
        modifiedAt: null,
      },
    ]);
    expect(sorted.map((p) => p.file)).toEqual([
      "b.plan.md",
      "next.plan.md",
      "c.plan.md",
      "a.plan.md",
      "outside.plan.md",
    ]);
  });

  it("keeps lifecycle-rank sorting when no plan carries a queue role", () => {
    const { sortPlansForPortfolio } = loadQueueChecklistHelpers();
    const sorted = sortPlansForPortfolio([
      {
        file: "done.plan.md",
        lifecycle: "completed",
        queueRole: "none",
        queueIndex: null,
        modifiedAt: null,
      },
      {
        file: "live.plan.md",
        lifecycle: "executing",
        queueRole: "none",
        queueIndex: null,
        modifiedAt: null,
      },
      {
        file: "queuedish.plan.md",
        lifecycle: "backlog",
        queueRole: "none",
        queueIndex: null,
        modifiedAt: null,
      },
    ]);
    expect(sorted.map((p) => p.file)).toEqual([
      "live.plan.md",
      "queuedish.plan.md",
      "done.plan.md",
    ]);
  });

  it("does not pin completed queue-index-0 above an executing later cursor", () => {
    const { sortPlansForPortfolio } = loadQueueChecklistHelpers();
    const sorted = sortPlansForPortfolio([
      {
        file: "done-first.plan.md",
        lifecycle: "completed",
        queueRole: "completed_in_queue",
        queueIndex: 0,
        modifiedAt: null,
      },
      {
        file: "live-second.plan.md",
        lifecycle: "executing",
        queueRole: "executing",
        queueIndex: 1,
        modifiedAt: null,
      },
    ]);
    expect(sorted.map((p) => p.file)).toEqual(["live-second.plan.md", "done-first.plan.md"]);
  });

  it("renders additive queue-role pills and skips lifecycle duplicates", () => {
    const { queueRolePill } = loadQueueChecklistHelpers();
    // Next-up pill emits SVG mark (⏩︎ fallback) + label text.
    const nextUp = queueRolePill({ queueRole: "next_up", lifecycle: "backlog" });
    expect(nextUp).toContain("Next up");
    expect(nextUp).toContain("queue-role-mark");
    expect(nextUp).toContain("<svg");
    // Queued pill emits character mark + label.
    const queued = queueRolePill({ queueRole: "queued", lifecycle: "backlog" });
    expect(queued).toContain("Queued");
    expect(queued).toContain("queue-role-mark");
    // Queue cursor still on a terminal plan: the pill marks queue position.
    expect(queueRolePill({ queueRole: "executing", lifecycle: "completed" })).toContain(
      "Executing",
    );
    // Duplicate of the lifecycle pill's own label is skipped.
    expect(queueRolePill({ queueRole: "executing", lifecycle: "executing" })).toBe("");
    expect(queueRolePill({ queueRole: "completed_in_queue", lifecycle: "completed" })).toBe("");
    expect(queueRolePill({ queueRole: "none", lifecycle: "executing" })).toBe("");
    expect(queueRolePill({})).toBe("");
  });

  it("places the queue pill next to the lifecycle pill in cards and accordions", () => {
    const checklistRenderer = dashboardHtml.match(
      /function renderRecentPlanCards\([\s\S]*?(?=\nfunction renderPlansAccordion)/,
    )?.[0];
    const plansRenderer = dashboardHtml.match(
      /function renderPlansAccordion\([\s\S]*?(?=\nfunction \w+)/,
    )?.[0];
    expect(checklistRenderer).toContain("${queueRolePill(p)}");
    expect(plansRenderer).toContain("${queueRolePill(p)}");
    // The lifecycle pill and the executing-only shimmer condition survive.
    expect(checklistRenderer).toContain("lifecycle-pill lifecycle-pill-${life.key}");
    expect(checklistRenderer).toContain("${life.key === 'executing' ? ' is-executing' : ''}");
    expect(plansRenderer).toContain("${life.key === 'executing' ? ' is-executing' : ''}");
    // Shimmer never keys on queueRole.
    expect(dashboardHtml).not.toMatch(/queueRole[^\n]*is-executing/);
    // Checklist pill markup dropped the colored .dot (queue-role pills are stroke-free mark+label).
    expect(checklistRenderer).not.toContain('class="dot ${life.dot}"');
    expect(checklistRenderer).not.toContain('class="dot"');
  });

  it("threads queueRole and queueIndex through mergePlansForUi with styling", () => {
    const mergeSource = dashboardHtml.match(/function mergePlansForUi\(d\) \{[\s\S]*?\n\}/)?.[0];
    expect(mergeSource).toContain("queueRole: enriched.queueRole || 'none'");
    expect(mergeSource).toContain("queueIndex: Number.isInteger(enriched.queueIndex)");
    expect(dashboardHtml).toMatch(/\.queue-role-pill\s*\{[^}]*border:\s*none/);
    expect(dashboardHtml).toContain(".queue-role-pill-next-up");
    expect(dashboardHtml).toContain(".queue-role-pill-queued");
  });
});

describe("plugin-ux-validation: Healthcenter (More → Health)", () => {
  it("renders Healthcenter shell with presence and fixed seven-check Autofix map", () => {
    expect(dashboardHtml).toContain('id="section-health"');
    expect(dashboardHtml).toContain('class="healthcenter"');
    expect(dashboardHtml).toContain("healthcenter-presence");
    expect(dashboardHtml).toContain("HEALTH_CHECK_META");
    expect(dashboardHtml).toContain("function toggleHealthCheck(checkId)");
    expect(dashboardHtml).toContain("function healthCheckSeverity(check, aggregateStatus)");
    // Scope identity to the HEALTH_CHECK_META literal (whole-file `plans:` etc. is vacuous).
    const metaBlock = dashboardHtml.match(/const HEALTH_CHECK_META = \{[\s\S]*?\n\};/)?.[0];
    expect(metaBlock).toBeTruthy();
    for (const id of ["plans", "handoff", "agents", "commands", "memory", "git", "config"]) {
      expect(metaBlock).toMatch(new RegExp(`^\\s*${id}:\\s*\\{`, "m"));
    }
    // Residual E/E1/E2: handoff/git remedy the fail; path-copy CTAs share Copy path;
    // git Autofix covers zero-commit repos (init + empty commit).
    expect(metaBlock).toMatch(
      /handoff:\s*\{[\s\S]*?autofix:\s*\{\s*text:\s*'\/handoff'[\s\S]*?destination:\s*'chatInput'/,
    );
    expect(metaBlock).toMatch(
      /git:\s*\{[\s\S]*?autofix:\s*\{\s*text:\s*'git init && git commit --allow-empty -m "init"'[\s\S]*?destination:\s*'terminal'[\s\S]*?label:\s*'Autofix'/,
    );
    expect(metaBlock).toMatch(
      /memory:\s*\{[\s\S]*?autofix:\s*\{\s*text:\s*'\.cursor\/memory\/'[\s\S]*?label:\s*'Copy path'/,
    );
    expect(metaBlock).toMatch(
      /commands:\s*\{[\s\S]*?autofix:\s*\{\s*text:\s*'\.cursor\/commands\/'[\s\S]*?label:\s*'Copy path'/,
    );
    // Hygiene F/G: native button needs no keydown shim; dead legacy helpers gone.
    expect(dashboardHtml).not.toContain("healthCheckKeydown");
    expect(dashboardHtml).not.toContain("showHealthInfo");
    expect(dashboardHtml).not.toContain(".health-message");
  });

  it("renders a vitals diagnosis dashboard grouped by vital system", () => {
    const healthBlock = dashboardHtml.match(
      /\/\/ ===== Healthcenter \(More → Health\) =====[\s\S]*?(?=\n {2}\/\/ ===== Git =====)/,
    )?.[0];
    expect(healthBlock).toBeTruthy();
    expect(healthBlock).toContain("HEALTH_VITAL_GROUPS");
    expect(healthBlock).toContain('class="health-vitals"');
    expect(healthBlock).toContain("health-vital-card");
    expect(healthBlock).toContain("health-group-title");
    for (const label of ["Planning spine", "Agent surface", "Memory loop", "Workspace"]) {
      expect(dashboardHtml).toContain(`label: '${label}'`);
    }
    expect(healthBlock).toContain("passing</span>");
    expect(healthBlock).toContain("'Attention'");
    expect(dashboardHtml).toMatch(/\.health-vitals\s*\{/);
    expect(dashboardHtml).toMatch(
      /\.health-vital-card\[data-state="pass"\][^{]*\{[^}]*var\(--green/,
    );
    expect(dashboardHtml).toMatch(
      /\.health-vital-card\[data-state="attention"\][^{]*\{[^}]*var\(--red/,
    );
  });

  it("strips left-bar highlight slop and colors severity via the Cursor palette", () => {
    expect(dashboardHtml).not.toMatch(/\.health-card\[data-severity[^\]]*\]\s*\{[^}]*border-left/);
    expect(dashboardHtml).not.toContain("same seven checks");
    expect(dashboardHtml).toMatch(/\.health-item-sev\[data-sev="ok"\]\s*\{[^}]*var\(--green/);
    expect(dashboardHtml).toMatch(/\.health-item-sev\[data-sev="warning"\]\s*\{[^}]*var\(--yellow/);
    expect(dashboardHtml).toMatch(
      /\.health-item-sev\[data-sev="degraded"\]\s*\{[^}]*var\(--orange/,
    );
    // Per-check error chrome pruned (residual C): producers never emit error+checks.
    expect(dashboardHtml).not.toMatch(/\.health-item-sev\[data-sev="error"\]/);
    expect(dashboardHtml).toContain('class="health-item-sev" data-sev=');
    expect(dashboardHtml).toMatch(
      /function healthCheckSeverity\(check, aggregateStatus\) \{[\s\S]*?if \(aggregateStatus === 'degraded'\) return 'degraded';\s*return 'warning';/,
    );
    expect(dashboardHtml).not.toMatch(
      /function healthCheckSeverity\(check, aggregateStatus\) \{[\s\S]*?aggregateStatus === 'error'[\s\S]*?return 'error'/,
    );
    // Token hygiene: no misleading fallback hexes on severity/radius rules.
    expect(dashboardHtml).not.toContain("var(--mc-radius-sm, 6px)");
    expect(dashboardHtml).not.toContain("var(--green, #3fb950)");
    expect(dashboardHtml).not.toContain("var(--yellow, #d29922)");
    expect(dashboardHtml).not.toContain("var(--red, #f85149)");
  });

  it("unifies severity chrome on one {tone, label} mapping across all call sites", () => {
    expect(dashboardHtml).toContain("HEALTH_SEVERITY_CHROME");
    // Positive shape anchor: literal-scoped token pin must match this = { … }; form.
    expect(dashboardHtml).toMatch(/const HEALTH_SEVERITY_CHROME = \{[\s\S]*?\};/);
    expect(dashboardHtml).toContain("degraded: { tone: 'orange', label: 'degraded' }");
    // Aggregate error keeps tone+label for transport; no unread token field.
    expect(dashboardHtml).toMatch(/error:\s*\{\s*tone:\s*'red',\s*label:\s*'error'\s*\}/);
    expect(dashboardHtml).not.toMatch(
      /HEALTH_SEVERITY_CHROME\s*=\s*\{(?:(?!\};)[\s\S])*\btoken\s*:(?:(?!\};)[\s\S])*\};/,
    );
    // Positive shape anchor for the fallback return: if the `|| { … }` form is
    // refactored away (e.g. `??`, extracted default), this fails loudly instead
    // of letting the negative pin below go silently vacuous (health R1).
    expect(dashboardHtml).toMatch(/return HEALTH_SEVERITY_CHROME\[sev\]\s*\|\|\s*\{/);
    // Fallback || { … }: reject token within that object only (not unbounded to
    // EOF). Whitespace-tolerant (\s*) so a line-wrapped return or double space
    // cannot silently skip the pin (mutations H2/H4).
    expect(dashboardHtml).not.toMatch(
      /return HEALTH_SEVERITY_CHROME\[sev\]\s*\|\|\s*\{(?:(?!\})[\s\S])*\btoken\s*:/,
    );
    // Presence dot, card dot, and severity label all read the same mapping.
    expect(dashboardHtml).toContain(
      "const presenceTone = healthSeverityChrome(healthStatus).tone;",
    );
    expect(dashboardHtml).toMatch(
      /function healthDotClass\(sev\) \{\s*return `dot-\$\{healthSeverityChrome\(sev\)\.tone\}`;/,
    );
    expect(dashboardHtml).toMatch(
      /function healthSeverityLabel\(sev\) \{\s*return healthSeverityChrome\(sev\)\.label;/,
    );
    // Degraded tone exists as a dot and carries a matching pulse halo; the red
    // halo fallback hole (grey currentColor) is closed.
    expect(dashboardHtml).toMatch(/\.dot-orange\s*\{[^}]*background:\s*var\(--orange\)/);
    expect(dashboardHtml).toMatch(
      /\.dot-orange\.dot-pulse::after\s*\{[^}]*border-color:\s*var\(--orange\)/,
    );
    expect(dashboardHtml).toMatch(
      /\.dot-red\.dot-pulse::after\s*\{[^}]*border-color:\s*var\(--red\)/,
    );
    // Presence liveness rides the ::after halo, not an element-level pulse that
    // inflated the solid dot 250% and faded it out each cycle.
    expect(dashboardHtml).not.toMatch(/\.healthcenter-presence \.dot-pulse\s*\{[^}]*animation/);
  });

  it("gives every problem row a copy-paste fix prompt CTA naming the chat input", () => {
    const healthBlock = dashboardHtml.match(
      /\/\/ ===== Healthcenter \(More → Health\) =====[\s\S]*?(?=\n {2}\/\/ ===== Git =====)/,
    )?.[0];
    expect(healthBlock).toBeTruthy();
    expect(healthBlock).toContain("Copy fix prompt");
    expect(healthBlock).toContain("copyForPasteHandler(fixPrompt, 'fix prompt', 'chatInput')");
    expect(healthBlock).toContain("copyActionTitle('fix prompt', 'chatInput')");
    expect(healthBlock).toContain("Fix this failing health check: ${c.label || id}");
    expect(healthBlock).toContain("No action needed.");
    expect(healthBlock).not.toContain("No Autofix mapped for this check.");
  });

  it("maps Autofix to copyForPaste destinations (no Open/protocol)", () => {
    expect(dashboardHtml).toContain("health-autofix-btn");
    expect(dashboardHtml).toMatch(
      /autofix:\s*\{\s*text:\s*'\/start-project'[\s\S]*?destination:\s*'chatInput'/,
    );
    expect(dashboardHtml).toMatch(
      /autofix:\s*\{\s*text:\s*'agent-kit doctor'[\s\S]*?destination:\s*'terminal'/,
    );
    expect(dashboardHtml).toMatch(
      /autofix:\s*\{\s*text:\s*'\.cursor\/commands\/'[\s\S]*?destination:\s*'filePicker'/,
    );
    const healthBlock = dashboardHtml.match(
      /\/\/ ===== Healthcenter \(More → Health\) =====[\s\S]*?(?=\n {2}\/\/ ===== Git =====)/,
    )?.[0];
    expect(healthBlock).toBeTruthy();
    expect(healthBlock).toContain("copyForPasteHandler");
    expect(healthBlock).not.toMatch(/vscode:\/\/|cursor:\/\/|Open file|protocol/i);
    expect(healthBlock).toContain("Health snapshot error");
    expect(healthBlock).toContain("Health offline");
  });

  it("unifies Health card radius on the ladder (skin-neutral) with reduced-motion press on .health-item", () => {
    expect(dashboardHtml).toMatch(/\.health-card\s*\{[^}]*border-radius:\s*var\(--mc-radius\)/);
    // Structure stays skin-neutral: no per-skin radius overrides on health cards.
    expect(dashboardHtml).not.toMatch(
      /html\[data-dashboard-skin="(?:cursor|legacy)"\] \.health-card\s*\{/,
    );
    expect(dashboardHtml).toMatch(
      /\.health-vital-card\s*\{[^}]*border-radius:\s*var\(--mc-radius\)/,
    );
    expect(dashboardHtml).toMatch(/\.health-item:active\s*\{[^}]*transform:\s*scale\(0\.98\)/);
  });
});

describe("plugin-ux-validation: Memory tab (error-o-meter + live recent errors)", () => {
  const memoryBlock = dashboardHtml.match(
    /\/\/ ===== Memory =====[\s\S]*?(?=\n {2}\/\/ ===== Terminals =====)/,
  )?.[0];

  it("renders the error-o-meter KPI grid from memory.errorStats", () => {
    expect(memoryBlock).toBeTruthy();
    expect(memoryBlock).toContain("d.memory?.recentErrors || []");
    expect(memoryBlock).toContain("d.memory?.errorStats || null");
    expect(memoryBlock).toContain('class="memory-kpi-grid"');
    expect(memoryBlock).toContain("Error-o-meter");
    expect(memoryBlock).toContain("errorStats.last30d");
    expect(memoryBlock).toContain("errorStats.weeklyRate");
    expect(memoryBlock).toContain("errorStats.topTags");
    expect(dashboardHtml).toMatch(/\.memory-kpi-grid\s*\{/);
    expect(dashboardHtml).toMatch(/\.memory-tag\s*\{/);
  });

  it("lays out green and red icon-led panels side by side", () => {
    expect(memoryBlock).toContain("memory-panel-icon-green");
    expect(memoryBlock).toContain("memory-panel-icon-red");
    expect(memoryBlock).toContain("Healthy memory");
    expect(memoryBlock).toContain("Recent errors");
    expect(memoryBlock).toContain("renderEmptyStateCta");
    expect(dashboardHtml).toMatch(/\.memory-panel-icon-green\s*\{[^}]*var\(--green\)/);
    expect(dashboardHtml).toMatch(/\.memory-panel-icon-red\s*\{[^}]*var\(--red\)/);
  });

  it("renders interactive error rows with expand detail and copy fix-prompt", () => {
    expect(memoryBlock).toContain(
      "recentErrors.map((entry, idx) => renderMemoryErrorRow(entry, idx)).join('')",
    );
    expect(dashboardHtml).toContain("function renderMemoryErrorRow(entry, idx)");
    expect(dashboardHtml).toContain("function toggleMemoryError(idx)");
    expect(dashboardHtml).toContain("memory-error-card");
    expect(dashboardHtml).toContain("memory-error-detail");
    expect(dashboardHtml).toContain("Copy fix prompt");
    expect(dashboardHtml).toContain("copyForPasteHandler(fixPrompt, 'fix prompt', 'chatInput')");
    expect(dashboardHtml).toContain("copyActionTitle('fix prompt', 'chatInput')");
    const rowFn = dashboardHtml.match(
      /function renderMemoryErrorRow\(entry, idx\) \{[\s\S]*?\n\}/,
    )?.[0];
    expect(rowFn).toBeTruthy();
    expect(rowFn).toContain("Fix this recorded problem class: ${title}");
    expect(rowFn).toContain("aria-expanded");
  });

  it("keeps the Memory tab free of decorative dots", () => {
    expect(memoryBlock).not.toMatch(/class="dot/);
    expect(memoryBlock).not.toContain("dot-green");
    expect(memoryBlock).not.toContain("dot-red");
  });

  it("wires live memory parsing in dashboard-data.mjs", () => {
    const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");
    expect(dataSource).toContain("function parseMemoryErrorFile(dir, file)");
    expect(dataSource).toContain("function computeMemoryErrorStats(entries)");
    expect(dataSource).toContain(
      "SNAPSHOT.memory.recentErrors = parsedErrors.slice(0, MAX_MEMORY_RECENT_ERRORS)",
    );
    expect(dataSource).toContain(
      "SNAPSHOT.memory.errorStats = computeMemoryErrorStats(parsedErrors)",
    );
    expect(dataSource).toContain("weeklyRate");
    expect(dataSource).toContain("topTags");
  });
});

describe("plugin-ux-validation: Git tab (promotion flow + graph + staging hygiene)", () => {
  const gitBlock = dashboardHtml.match(
    /\/\/ ===== Git =====[\s\S]*?(?=\n {2}\/\/ ===== Memory =====)/,
  )?.[0];

  it("renders promotion flow lanes for work -> staging -> main", () => {
    expect(gitBlock).toBeTruthy();
    expect(gitBlock).toContain("${renderGitHygieneHint(d.git)}");
    expect(gitBlock).toContain("${renderGitFlowCard(d.git)}");
    expect(gitBlock).toContain("${renderGitGraphCard(d.git)}");
    expect(dashboardHtml).toContain("function renderGitFlowCard(git)");
    expect(dashboardHtml).toContain("function renderGitFlowRow({ from, to, div, texts, cta })");
    const flowFn = dashboardHtml.match(/function renderGitFlowCard\(git\) \{[\s\S]*?\n\}/)?.[0];
    expect(flowFn).toBeTruthy();
    // Three lanes: branch vs staging, staging vs main, branch vs main.
    expect(flowFn).toContain("to: 'origin/staging'");
    expect(flowFn).toContain("from: 'origin/staging'");
    expect(flowFn).toContain("to: 'origin/main'");
    expect(flowFn).toContain("awaiting promotion to main");
    // CTA gated on ahead, never unconditional.
    expect(flowFn).toContain("flow.vsStaging && flow.vsStaging.ahead > 0");
    expect(flowFn).toContain("flow.stagingVsMain && flow.stagingVsMain.ahead > 0");
    expect(flowFn).toContain("Copy /git-staging");
    expect(flowFn).toContain("Copy /git-prod");
    expect(dashboardHtml).toMatch(/\.git-flow-row\s*\{/);
    expect(dashboardHtml).toMatch(/\.git-flow-badge\.is-ahead\s*\{[^}]*var\(--yellow\)/);
    expect(dashboardHtml).toMatch(/\.git-flow-badge\.is-sync\s*\{[^}]*var\(--green\)/);
  });

  it("keeps flow badges and state labels honest (sync / ahead / behind)", () => {
    const sources = [
      /function gitFlowBadge\(div\) \{[\s\S]*?\n\}/,
      /function gitFlowStateLabel\(div, \{ syncText, aheadText, behindText \}\) \{[\s\S]*?\n\}/,
    ].map((re) => {
      const match = dashboardHtml.match(re);
      expect(match, `dashboard.html must define ${re.source}`).not.toBeNull();
      return match?.[0];
    });
    const { gitFlowBadge, gitFlowStateLabel } = new Function(
      `${sources.join("\n")}\nreturn { gitFlowBadge, gitFlowStateLabel };`,
    )() as {
      gitFlowBadge: (div: { ahead: number; behind: number } | null) => string;
      gitFlowStateLabel: (
        div: { ahead: number; behind: number } | null,
        texts: {
          syncText: string;
          aheadText: (n: number) => string;
          behindText: (n: number) => string;
        },
      ) => { tone: string | null; text: string };
    };
    expect(gitFlowBadge(null)).toContain("no upstream");
    expect(gitFlowBadge({ ahead: 0, behind: 0 })).toContain("is-sync");
    expect(gitFlowBadge({ ahead: 2, behind: 0 })).toContain("is-ahead");
    expect(gitFlowBadge({ ahead: 0, behind: 3 })).toContain("is-behind");
    const texts = {
      syncText: "sync",
      aheadText: (n: number) => `ahead ${n}`,
      behindText: (n: number) => `behind ${n}`,
    };
    expect(gitFlowStateLabel({ ahead: 0, behind: 0 }, texts)).toEqual({
      tone: "green",
      text: "sync",
    });
    expect(gitFlowStateLabel({ ahead: 1, behind: 0 }, texts).tone).toBe("yellow");
    expect(gitFlowStateLabel({ ahead: 0, behind: 1 }, texts).tone).toBe("yellow");
    expect(gitFlowStateLabel({ ahead: 1, behind: 1 }, texts).text).toContain("diverged");
    expect(gitFlowStateLabel(null, texts).tone).toBeNull();
  });

  it("renders a readable git graph block (no decorative per-commit dots)", () => {
    expect(dashboardHtml).toContain("function renderGitGraphCard(git)");
    const graphFn = dashboardHtml.match(/function renderGitGraphCard\(git\) \{[\s\S]*?\n\}/)?.[0];
    expect(graphFn).toBeTruthy();
    expect(graphFn).toContain('class="git-graph"');
    expect(graphFn).toContain("aria-label");
    expect(graphFn).toContain("escapeHtml(lines.join('\\n'))");
    expect(graphFn).not.toContain("dot");
    expect(dashboardHtml).toMatch(/\.git-graph\s*\{[^}]*var\(--mc-font-mono\)/);
    // Old stat rows are gone; flow lanes carry ahead/behind now.
    expect(gitBlock).not.toContain("Ahead of origin/main");
    expect(gitBlock).not.toContain("Behind origin/main");
    // Dots inside the Git tab only appear paired with state labels (flow/hygiene).
    expect(gitBlock).not.toContain("dot-gray");
    for (const dotMatch of gitBlock?.match(/<span class="dot dot-[a-z]+"/g) ?? []) {
      expect(['<span class="dot dot-green"', '<span class="dot dot-yellow"']).toContain(dotMatch);
    }
  });

  it("surfaces staging hygiene for untracked plan-monitor WIP", () => {
    expect(dashboardHtml).toContain("function renderGitHygieneHint(git)");
    const hintFn = dashboardHtml.match(/function renderGitHygieneHint\(git\) \{[\s\S]*?\n\}/)?.[0];
    expect(hintFn).toBeTruthy();
    expect(hintFn).toContain("git?.hygiene?.monitorWip || []");
    expect(hintFn).toContain("if (!wip.length) return '';");
    expect(hintFn).toContain("add-by-name only");
    expect(hintFn).toContain("Copy /git-staging");
    expect(dashboardHtml).toMatch(/\.git-hygiene\s*\{[^}]*var\(--yellow-bg\)/);
  });

  it("wires flow, graph, and hygiene data in dashboard-data.mjs", () => {
    const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");
    expect(dataSource).toContain("git rev-list --left-right --count ${range}");
    expect(dataSource).toContain('countDivergence("origin/staging...HEAD")');
    expect(dataSource).toContain('countDivergence("origin/main...HEAD")');
    expect(dataSource).toContain('countDivergence("origin/main...origin/staging")');
    expect(dataSource).toContain("git log --graph --oneline --decorate --date-order --all");
    expect(dataSource).toContain("MAX_GIT_GRAPH_LINES");
    expect(dataSource).toContain("/^\\.cursor\\/memory\\/plan-monitor-.+\\.md$/");
    expect(dataSource).toContain("hygiene: { monitorWip }");
  });
});

describe("plugin-ux-validation: processes tab narration", () => {
  const processesSection =
    dashboardHtml.match(/id="section-processes"[\s\S]*?id="section-skills"/)?.[0] ?? "";

  it("renders a narrated live list with an informational (not alarm) note", () => {
    // Informational note uses the blue informational palette, never attention red.
    const noteCss = dashboardHtml.match(/\.processes-note\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(noteCss).toContain("var(--blue-bg)");
    expect(noteCss).not.toContain("var(--red");
    expect(processesSection).toContain('class="processes-note"');
    expect(processesSection).toContain("Live ps snapshot.");
    // Crew monitor pointer keeps IDE-spawned agent activity discoverable.
    expect(processesSection).toContain("Crew monitor");
    // Live list chrome: per-process card with the generated narration.
    expect(processesSection).toContain('class="process-list"');
    expect(processesSection).toContain('class="process-card"');
    expect(processesSection).toContain('class="process-label-badge"');
    expect(processesSection).toContain('class="process-desc"');
    expect(processesSection).toContain("escapeHtml(p.description)");
    expect(processesSection).toContain("escapeHtml(p.etime)");
    // Honest empty state, no decorative filler.
    expect(processesSection).toContain("All quiet");
    expect(processesSection).toContain("appear here while active");
    // Copy-only action kept, terminal as paste destination.
    expect(processesSection).toContain("Copy PID");
    // Dot semantics: no decorative dots in the Processes tab.
    expect(processesSection).not.toMatch(/class="dot/);
    // The old table chrome is gone.
    expect(dashboardHtml).not.toContain("processes-table");
  });

  it("ships per-process narration fields from dashboard-data.mjs", () => {
    const dataSource = readFileSync(resolve(repoRoot, "dashboard/dashboard-data.mjs"), "utf8");
    expect(dataSource).toContain("ps -axo pid=,pcpu=,pmem=,etime=,command=");
    expect(dataSource).toContain(
      "description: describeProcess({ label, command: cmd, cpu, etime })",
    );
  });
});
