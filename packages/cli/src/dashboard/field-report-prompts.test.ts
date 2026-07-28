import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_PROMPTS,
  MAX_CHAT_SNIPPET,
  MAX_SEMANTIC_LABEL,
  PROMPT_RESUME_GUIDANCE,
  buildAgentPromptItems,
  buildMissionControlView,
  collapseAttentionLabel,
  detectAwaitingPrompt,
  dismissedAttentionIds,
  extractChatSnippet,
  extractPlanFileRefs,
  extractQuestionLabel,
  extractQuestionText,
  fieldReportResolveAction,
  formatChatReferencePayload,
  formatChatReferenceSubject,
  isAgentQuestionEntry,
  isFieldReportAttentionId,
  isPromptClearedByPlanLifecycle,
  isUserEntry,
  normalizeUserTextToSnippet,
  parseExternalReport,
  parseFieldReportDismissals,
  resolvePlanLifecycle,
} from "../../../../dashboard/lib/semantic-model.mjs";

const dashboardHtml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../dashboard/dashboard.html"),
  "utf8",
);

// Synthetic transcript entries only. Real conversation content is never copied
// into the repository; these mirror the JSONL shape confirmed from local files.
function userEntry(text = "hello") {
  return { role: "user", message: { content: [{ type: "text", text }] } };
}

function assistantText(text = "working") {
  return { role: "assistant", message: { content: [{ type: "text", text }] } };
}

function questionEntry(prompt: string, name = "AskQuestion") {
  return {
    role: "assistant",
    message: {
      content: [
        { type: "text", text: "let me confirm" },
        {
          type: "tool_use",
          name,
          input: { questions: [{ id: "scope", prompt, options: [] }] },
        },
      ],
    },
  };
}

const turnMarker = { type: "turn_ended", status: "success" };

describe("isAgentQuestionEntry / isUserEntry", () => {
  it("recognizes AskQuestion, ask_question, and cursor/ask_question tool calls", () => {
    expect(isAgentQuestionEntry(questionEntry("q", "AskQuestion"))).toBe(true);
    expect(isAgentQuestionEntry(questionEntry("q", "ask_question"))).toBe(true);
    expect(isAgentQuestionEntry(questionEntry("q", "cursor/ask_question"))).toBe(true);
  });

  it("does not treat other tool calls or user turns as questions", () => {
    const shell = {
      role: "assistant",
      message: { content: [{ type: "tool_use", name: "Shell", input: {} }] },
    };
    expect(isAgentQuestionEntry(shell)).toBe(false);
    expect(isAgentQuestionEntry(userEntry())).toBe(false);
    expect(isAgentQuestionEntry(turnMarker)).toBe(false);
    expect(isUserEntry(userEntry())).toBe(true);
    expect(isUserEntry(assistantText())).toBe(false);
    expect(isUserEntry(turnMarker)).toBe(false);
  });
});

describe("extractQuestionLabel", () => {
  it("derives the label from the question prompt and truncates long text", () => {
    expect(extractQuestionLabel(questionEntry("What do I ship to staging?"))).toBe(
      "What do I ship to staging?",
    );
    const long = "x".repeat(MAX_SEMANTIC_LABEL + 50);
    const label = extractQuestionLabel(questionEntry(long)) || "";
    expect(label.length).toBeLessThanOrEqual(MAX_SEMANTIC_LABEL + 1); // trailing ellipsis
    expect(label.endsWith("\u2026")).toBe(true);
  });

  it("collapses blank lines and markdown breaks into a single-line label", () => {
    const multi =
      "How to handle the monitor findings?\n\nThe plan is fully exhausted with no open residuals.";
    expect(collapseAttentionLabel(multi)).toBe(
      "How to handle the monitor findings? The plan is fully exhausted with no open residuals.",
    );
    expect(extractQuestionLabel(questionEntry(multi))).toBe(
      "How to handle the monitor findings? The plan is fully exhausted with no open residuals.",
    );
    expect(extractQuestionLabel(questionEntry(multi))?.includes("\n")).toBe(false);
  });

  it("keeps an untruncated detection value while the display label truncates (FR-SAC-01)", () => {
    const long = `Start ${"x".repeat(MAX_SEMANTIC_LABEL)} then finish new-field.plan.md`;
    const text = extractQuestionText(questionEntry(long)) || "";
    // Untruncated: the trailing plan ref survives for lifecycle parsing.
    expect(text.length).toBeGreaterThan(MAX_SEMANTIC_LABEL);
    expect(text.endsWith("new-field.plan.md")).toBe(true);
    const label = extractQuestionLabel(questionEntry(long)) || "";
    expect(label.length).toBeLessThanOrEqual(MAX_SEMANTIC_LABEL + 1);
    expect(label.endsWith("\u2026")).toBe(true);
  });
});

describe("detectAwaitingPrompt", () => {
  it("flags a transcript whose last question has no user entry after it", () => {
    const entries = [userEntry(), assistantText(), questionEntry("Pick one"), turnMarker];
    const result = detectAwaitingPrompt(entries);
    expect(result).not.toBeNull();
    expect(result?.label).toBe("Pick one");
  });

  it("does not flag a question that the user answered", () => {
    const entries = [
      userEntry(),
      questionEntry("Pick one"),
      userEntry("option a"),
      assistantText("done"),
    ];
    expect(detectAwaitingPrompt(entries)).toBeNull();
  });

  it("returns null when no question was ever asked", () => {
    const entries = [userEntry(), assistantText(), assistantText(), turnMarker];
    expect(detectAwaitingPrompt(entries)).toBeNull();
  });

  it("uses the last question: an earlier answered question does not clear a later open one", () => {
    const entries = [
      questionEntry("first"),
      userEntry("answered first"),
      questionEntry("second"),
      assistantText("kept working"),
      turnMarker,
    ];
    expect(detectAwaitingPrompt(entries)?.label).toBe("second");
  });

  it("ignores assistant-last signal: assistant text after a question stays awaiting", () => {
    const entries = [questionEntry("still open"), assistantText("more work"), turnMarker];
    expect(detectAwaitingPrompt(entries)?.label).toBe("still open");
  });

  it("returns both a truncated display label and the untruncated detection value (FR-SAC-01)", () => {
    const long = `Resume ${"y".repeat(MAX_SEMANTIC_LABEL)} and live-work.plan.md`;
    const result = detectAwaitingPrompt([questionEntry(long), turnMarker]);
    expect(result?.label?.length).toBeLessThanOrEqual(MAX_SEMANTIC_LABEL + 1);
    expect(result?.labelFull?.endsWith("live-work.plan.md")).toBe(true);
    expect((result?.labelFull?.length || 0) > MAX_SEMANTIC_LABEL).toBe(true);
  });

  it("degrades on non-array input", () => {
    expect(detectAwaitingPrompt(null as unknown as unknown[])).toBeNull();
    expect(detectAwaitingPrompt(undefined as unknown as unknown[])).toBeNull();
  });
});

describe("normalizeUserTextToSnippet / extractChatSnippet", () => {
  it("prefers user_query body and strips timestamp wrappers", () => {
    const wrapped =
      "<timestamp>Friday</timestamp> <user_query> Ship the dashboard skins </user_query>";
    expect(normalizeUserTextToSnippet(wrapped)).toBe("Ship the dashboard skins");
  });

  it("falls back to a slash command name for command-only messages", () => {
    const cmdOnly =
      "<cursor_commands>\n--- Cursor Command: run-plan ---\n# Command\n</cursor_commands>";
    expect(normalizeUserTextToSnippet(cmdOnly)).toBe("/run-plan");
  });

  it("reads the earliest usable user text from transcript entries", () => {
    const entries = [
      assistantText("hi"),
      userEntry("<timestamp>t</timestamp> <user_query> Resume the skins chat </user_query>"),
      questionEntry("Pick a skin"),
    ];
    expect(extractChatSnippet(entries)).toBe("Resume the skins chat");
  });

  it("truncates long snippets", () => {
    const long = "y".repeat(MAX_CHAT_SNIPPET + 40);
    const snippet = normalizeUserTextToSnippet(long) || "";
    expect(snippet.length).toBeLessThanOrEqual(MAX_CHAT_SNIPPET + 1);
    expect(snippet.endsWith("\u2026")).toBe(true);
  });
});

describe("formatChatReferencePayload / formatChatReferenceSubject", () => {
  it("keeps the clipboard payload as the bare chat id for the past-chat picker", () => {
    expect(formatChatReferencePayload("  abc-123  ")).toBe("abc-123");
    expect(formatChatReferencePayload("")).toBe("");
  });

  it("names the copied subject with short id and chat snippet", () => {
    expect(formatChatReferenceSubject("abcdef12-9999", "Ship skins")).toBe(
      "chat id abcdef12 (Ship skins)",
    );
    expect(formatChatReferenceSubject("abcdef12-9999", null)).toBe("chat id abcdef12");
  });
});

function planRecord(
  id: string,
  todos: { id: string; content: string; status: string }[],
): {
  id: string;
  file: string;
  path: string;
  overview: string;
  todos: {
    total: number;
    completed: number;
    pending: number;
    inProgress: number;
    items: { id: string; content: string; status: string }[];
  };
} {
  return {
    id,
    file: `${id}.plan.md`,
    path: `.cursor/plans/${id}.plan.md`,
    overview: "",
    todos: {
      total: todos.length,
      completed: todos.filter((t) => t.status === "completed").length,
      pending: todos.filter((t) => t.status === "pending").length,
      inProgress: todos.filter((t) => t.status === "in_progress").length,
      items: todos,
    },
  };
}

const doneTodos = [
  { id: "a", content: "A", status: "completed" },
  { id: "b", content: "B", status: "completed" },
];
const openTodos = [
  { id: "a", content: "A", status: "completed" },
  { id: "b", content: "B", status: "pending" },
];

describe("extractPlanFileRefs / prompt lifecycle clear", () => {
  it("extracts exact *.plan.md basenames and ignores non-plan tokens", () => {
    expect(
      extractPlanFileRefs(
        "Start `done-work.plan.md` after Gate A; ignore origin/staging and notes.md",
      ),
    ).toEqual(["done-work.plan.md"]);
    expect(extractPlanFileRefs("no plan file here")).toEqual([]);
    expect(extractPlanFileRefs(null)).toEqual([]);
  });

  it("clears when the referenced plan is completed", () => {
    const plans = [planRecord("done-work", doneTodos)];
    const handoff = { plan: "other.plan.md", parkedPlans: ["done-work.plan.md"] };
    expect(resolvePlanLifecycle("done-work.plan.md", plans, handoff)).toBe("completed");
    expect(
      isPromptClearedByPlanLifecycle("Start unit on `done-work.plan.md`?", plans, handoff),
    ).toBe(true);
    expect(
      buildAgentPromptItems([{ chatId: "c1", label: "Start unit on `done-work.plan.md`?" }], {
        plans,
        handoff,
      }),
    ).toEqual([]);
  });

  it("clears when the referenced plan is parked/exhausted with open work", () => {
    const plans = [planRecord("parked-open", openTodos)];
    const handoff = { plan: "live.plan.md", parkedPlans: ["parked-open.plan.md"] };
    expect(resolvePlanLifecycle("parked-open.plan.md", plans, handoff)).toBe("parked");
    expect(isPromptClearedByPlanLifecycle("Resume `parked-open.plan.md`?", plans, handoff)).toBe(
      true,
    );
  });

  it("keeps the row when the referenced plan is active", () => {
    const plans = [planRecord("live-work", openTodos)];
    const handoff = { plan: "live-work.plan.md", mode: "continue-plan" };
    expect(resolvePlanLifecycle("live-work.plan.md", plans, handoff)).toBe("awaiting_user");
    expect(
      isPromptClearedByPlanLifecycle("Start next on `live-work.plan.md`?", plans, handoff),
    ).toBe(false);
    expect(
      buildAgentPromptItems(
        [{ chatId: "active-chat", label: "Start next on `live-work.plan.md`?" }],
        { plans, handoff },
      ),
    ).toHaveLength(1);
  });

  it("keeps the row when the plan reference is unknown (missing inventory)", () => {
    const handoff = { plan: "other.plan.md" };
    expect(resolvePlanLifecycle("ghost.plan.md", [], handoff)).toBe("unknown");
    expect(isPromptClearedByPlanLifecycle("Start `ghost.plan.md`?", [], handoff)).toBe(false);
  });

  it("keeps the row when the pending question has no plan reference", () => {
    expect(isPromptClearedByPlanLifecycle("Clarify what update the repo means", [], null)).toBe(
      false,
    );
    expect(
      buildAgentPromptItems([{ chatId: "no-ref", label: "Clarify what update the repo means" }], {
        plans: [planRecord("done-work", doneTodos)],
        handoff: { plan: "other.plan.md", parkedPlans: ["done-work.plan.md"] },
      }),
    ).toHaveLength(1);
  });

  it("keeps multi-plan questions when any matched plan is still active", () => {
    const plans = [planRecord("old-design", doneTodos), planRecord("new-field", openTodos)];
    const handoff = {
      plan: "new-field.plan.md",
      mode: "continue-plan",
      parkedPlans: ["old-design.plan.md"],
    };
    const label = "Disposition between `old-design.plan.md` and `new-field.plan.md`?";
    expect(isPromptClearedByPlanLifecycle(label, plans, handoff)).toBe(false);
    expect(buildAgentPromptItems([{ chatId: "multi", label }], { plans, handoff })).toHaveLength(1);
  });

  it("clears multi-plan questions only when every matched plan is terminal", () => {
    const plans = [planRecord("old-design", doneTodos), planRecord("also-done", doneTodos)];
    const handoff = {
      plan: "unrelated.plan.md",
      parkedPlans: ["old-design.plan.md", "also-done.plan.md"],
    };
    const label = "Pick between `old-design.plan.md` and `also-done.plan.md`";
    expect(isPromptClearedByPlanLifecycle(label, plans, handoff)).toBe(true);
  });

  it("keeps a multi-plan prompt whose active ref sits past the display cutoff (FR-SAC-01)", () => {
    const plans = [planRecord("old-design", doneTodos), planRecord("new-field", openTodos)];
    const handoff = {
      plan: "new-field.plan.md",
      mode: "continue-plan",
      parkedPlans: ["old-design.plan.md"],
    };
    // Terminal ref before the 200-char cutoff, active ref only in the full text.
    const labelFull = `Disposition of \`old-design.plan.md\` ${"pad ".repeat(60)}versus \`new-field.plan.md\`?`;
    expect(labelFull.length).toBeGreaterThan(MAX_SEMANTIC_LABEL);
    const label = `${labelFull.slice(0, MAX_SEMANTIC_LABEL)}\u2026`;
    // Parsing only the truncated display label would wrongly clear the row.
    expect(isPromptClearedByPlanLifecycle(label, plans, handoff)).toBe(true);
    // Using the untruncated detection value keeps the live wait.
    expect(isPromptClearedByPlanLifecycle(labelFull, plans, handoff)).toBe(false);
    expect(
      buildAgentPromptItems([{ chatId: "multi-cut", label, labelFull }], { plans, handoff }),
    ).toHaveLength(1);
  });

  it("does not treat a zero-to-do plan record as terminal for prompt clear (FR-SAC-02)", () => {
    const emptyPlan = planRecord("empty-plan", []);
    const handoff = { plan: "empty-plan.plan.md", parkedPlans: ["empty-plan.plan.md"] };
    // Parse failure / unsupported frontmatter must resolve as unknown, not completed.
    expect(resolvePlanLifecycle("empty-plan.plan.md", [emptyPlan], handoff)).toBe("unknown");
    expect(
      isPromptClearedByPlanLifecycle("Resume `empty-plan.plan.md`?", [emptyPlan], handoff),
    ).toBe(false);
    expect(
      buildAgentPromptItems([{ chatId: "z", label: "Resume `empty-plan.plan.md`?" }], {
        plans: [emptyPlan],
        handoff,
      }),
    ).toHaveLength(1);
  });
});

describe("buildAgentPromptItems", () => {
  it("shapes items with identifying context and a copy-only past-chat picker action", () => {
    const items = buildAgentPromptItems([
      {
        chatId: "abc-123",
        label: "Pick one",
        chatSnippet: "Ship the dashboard skins",
        quietAt: "2026-07-25T10:00:00.000Z",
      },
    ]);
    expect(items[0]).toMatchObject({
      id: "attention:prompt:abc-123",
      kind: "prompt",
      severity: "action",
      label: "Pick one",
      chatSnippet: "Ship the dashboard skins",
      chatId: "abc-123",
      modifiedAt: "2026-07-25T10:00:00.000Z",
      action: {
        type: "copy",
        target: "abc-123",
        label: "Copy chat id",
        subject: "chat id abc-123 (Ship the dashboard skins)",
        pasteDestination: "pastChatPicker",
      },
    });
    expect(items[0]).not.toHaveProperty("resumeGuidance");
    expect(items[0].resolveAction).toMatchObject({
      type: "copy",
      target: "/field-report-resolve attention:prompt:abc-123",
      pasteDestination: "chatInput",
    });
    expect(PROMPT_RESUME_GUIDANCE.toLowerCase()).not.toMatch(/\bopen\b/);
    expect(items[0].action.label.toLowerCase()).not.toMatch(/\bopen\b/);
  });

  it("collapses multiline labels before shaping the attention item", () => {
    const [item] = buildAgentPromptItems([
      { chatId: "multi", label: "Line one\n\n**Bold** line two" },
    ]);
    expect(item.label).toBe("Line one **Bold** line two");
    expect(item.label.includes("\n")).toBe(false);
  });

  it("caps the number of items and skips entries without a chatId", () => {
    const many = Array.from({ length: MAX_AGENT_PROMPTS + 5 }, (_, i) => ({
      chatId: `id-${i}`,
      label: `q${i}`,
    }));
    expect(buildAgentPromptItems(many).length).toBe(MAX_AGENT_PROMPTS);
    expect(buildAgentPromptItems([{ label: "no id" } as { label: string }])).toEqual([]);
  });
});

const untriagedReport = parseExternalReport({
  file: "plan-monitor-widget-rollout.md",
  content: "# Monitor log - widget-rollout\n\nNo triage outcome recorded yet.\n",
  modifiedAt: "2026-07-25T10:00:00.000Z",
});

describe("buildMissionControlView wiring", () => {
  it("merges plan-state and readiness into Field Report beside External reviews", () => {
    const view = buildMissionControlView({
      plans: [
        {
          id: "parked-work",
          file: "parked-work.plan.md",
          path: ".cursor/plans/parked-work.plan.md",
          overview: "Parked",
          todos: {
            total: 2,
            completed: 0,
            pending: 2,
            inProgress: 0,
            items: [
              { id: "a", content: "A", status: "pending" },
              { id: "b", content: "B", status: "pending" },
            ],
          },
        },
      ],
      handoff: {
        plan: "other.plan.md",
        mode: "continue-plan",
        parkedPlans: ["parked-work.plan.md"],
      },
      readinessPending: [
        { id: "confirm-provider", status: "needs_choice", essential: false, title: "Confirm" },
      ],
      externalReports: [untriagedReport],
    });
    expect(view.attention.map((i) => i.kind).sort()).toEqual(["readiness", "report"].sort());
    expect(view.checklistNotes).toEqual([]);
    expect(view.attention.some((i) => i.kind === "parked" || i.kind === "incomplete")).toBe(false);
  });

  it("carries agent-prompt rows when agentPrompts are supplied", () => {
    expect(buildAgentPromptItems([{ chatId: "chat-1", label: "Pick one" }])).toHaveLength(1);
    const view = buildMissionControlView({
      plans: [planRecord("live-work", openTodos)],
      handoff: { plan: "live-work.plan.md", mode: "continue-plan" },
      agentPrompts: [{ chatId: "chat-1", label: "Pick one" }],
      externalReports: [untriagedReport],
    });
    expect(view.attention.some((i) => i.kind === "prompt")).toBe(true);
    expect(view.attention.some((i) => i.kind === "report")).toBe(true);
    const prompt = view.attention.find((i) => i.kind === "prompt");
    expect(prompt?.action?.pasteDestination).toBe("pastChatPicker");
    expect(prompt?.resolveAction?.target).toBe("/field-report-resolve attention:prompt:chat-1");
  });
});

describe("parseFieldReportDismissals", () => {
  it("returns an empty list when the store is missing or malformed", () => {
    expect(parseFieldReportDismissals(null)).toEqual({ dismissals: [] });
    expect(parseFieldReportDismissals(undefined)).toEqual({ dismissals: [] });
    expect(parseFieldReportDismissals([])).toEqual({ dismissals: [] });
    expect(parseFieldReportDismissals({ dismissals: "nope" })).toEqual({ dismissals: [] });
    expect(dismissedAttentionIds(parseFieldReportDismissals(null))).toEqual([]);
  });

  it("keeps valid report and prompt attention ids and drops conversation-shaped junk", () => {
    const parsed = parseFieldReportDismissals({
      dismissals: [
        {
          id: "attention:prompt:chat-1",
          at: "2026-07-25T12:00:00.000Z",
          transcript: "never store this",
          reason: "handled in chat",
        },
        {
          id: "attention:report:widget-rollout",
          at: "2026-07-25T12:00:00.000Z",
          reason: "triaged in chat",
        },
        {
          id: "attention:cadence:w-20260727120000",
          at: "2026-07-27T12:00:00.000Z",
          reason: "batch reviewed",
        },
        { id: "attention:handoff-awaiting" },
        { id: "attention:parked:x.plan.md" },
        { id: "not-an-attention-id" },
        { at: "2026-07-25T12:00:00.000Z" },
        { id: "attention:report:widget-rollout" },
      ],
    });
    expect(parsed.dismissals).toEqual([
      {
        id: "attention:prompt:chat-1",
        at: "2026-07-25T12:00:00.000Z",
        reason: "handled in chat",
      },
      {
        id: "attention:report:widget-rollout",
        at: "2026-07-25T12:00:00.000Z",
        reason: "triaged in chat",
      },
      {
        id: "attention:cadence:w-20260727120000",
        at: "2026-07-27T12:00:00.000Z",
        reason: "batch reviewed",
      },
    ]);
    expect(Object.keys(parsed.dismissals[0]).sort()).toEqual(["at", "id", "reason"]);
    expect(isFieldReportAttentionId("attention:report:widget-rollout")).toBe(true);
    expect(isFieldReportAttentionId("attention:prompt:chat-1")).toBe(true);
    expect(isFieldReportAttentionId("attention:cadence:w-20260727120000")).toBe(true);
    expect(isFieldReportAttentionId("attention:handoff-awaiting")).toBe(false);
    expect(isFieldReportAttentionId("attention:parked:x.plan.md")).toBe(false);
  });

  it("filters dismissed ids from Field Report attention", () => {
    const gone = parseExternalReport({
      file: "plan-monitor-gone.md",
      content: "# Monitor log - gone\n\nNo triage outcome recorded yet.\n",
      modifiedAt: "2026-07-25T10:00:00.000Z",
    });
    const view = buildMissionControlView({
      plans: [],
      handoff: null,
      externalReports: [untriagedReport, gone],
      dismissedIds: ["attention:report:gone"],
    });
    expect(view.attention.map((i) => i.id)).toEqual(["attention:report:widget-rollout"]);
  });
});

describe("Flight Log panel contract (dashboard.html)", () => {
  it("renders Gaps-only Flight Log with empty idle copy", () => {
    expect(dashboardHtml).toContain("function renderFlightLogCard(entry, idx)");
    expect(dashboardHtml).toContain("function renderAttentionPanel(d, attentionChanged)");
    expect(dashboardHtml).toContain("flight-log-stack");
    expect(dashboardHtml).toContain("headline: 'All clear'");
    expect(dashboardHtml).toContain("className: 'attention-empty'");
    expect(dashboardHtml).toContain("Quiet cockpit. Residuals show up here when Gaps change.");
    expect(dashboardHtml).toContain("${spaceIconSvg('field-report')}Flight Log");
    expect(dashboardHtml).not.toContain("Review all</button>");
    expect(dashboardHtml).not.toContain("Resolve all</button>");
  });

  it("exposes copy text and HANDOFF path actions on Flight Log cards", () => {
    expect(dashboardHtml).toContain("Copy text");
    expect(dashboardHtml).toContain("Gaps text");
    expect(dashboardHtml).toContain("copyForPasteHandler(text, 'Gaps text', 'chatInput')");
    expect(dashboardHtml).toContain("copyRepoPathHandler(sourcePath)");
    expect(dashboardHtml).toContain("PATH_COPY_LABEL");
  });

  it("does not keep orphaned Field Report attention render helpers", () => {
    expect(dashboardHtml).not.toContain("function fieldReportItemsForRender(items)");
    expect(dashboardHtml).not.toContain("FIELD_REPORT_KINDS");
    expect(dashboardHtml).not.toContain("function orderAttentionBySeverity");
    expect(dashboardHtml).not.toContain("function attentionActionButtons(item, idx)");
    expect(dashboardHtml).not.toContain("function renderAttentionItem(item, idx)");
    expect(dashboardHtml).not.toContain("function attentionFingerprint(items)");
    expect(dashboardHtml).not.toContain("function partitionFieldReportByGroup(items)");
    expect(dashboardHtml).not.toContain("function fieldReportCountLabel(items)");
  });

  it("keeps Flight Log Gaps-only panel without retired FR stack CTAs", () => {
    expect(dashboardHtml).toContain("function renderAttentionPanel(d, attentionChanged)");
    expect(dashboardHtml).toContain("function flightLogFingerprint(fl)");
    expect(dashboardHtml).not.toContain("Review all</button>");
    expect(dashboardHtml).not.toContain("Resolve all</button>");
    expect(dashboardHtml).toContain("pastChatPicker");
    expect(dashboardHtml).toContain(
      `const PROMPT_RESUME_GUIDANCE =\n  '${PROMPT_RESUME_GUIDANCE}';`,
    );
    expect(dashboardHtml).toMatch(
      /if \(destination === 'pastChatPicker'\) \{\s*return PROMPT_RESUME_GUIDANCE;/,
    );
    expect(dashboardHtml).not.toContain("item.resumeGuidance");
    expect(dashboardHtml).not.toContain("attention-guidance");
    expect(PROMPT_RESUME_GUIDANCE.toLowerCase()).not.toMatch(/\bopen\b/);
  });
});

describe("Field Report resolve action contract", () => {
  it("builds a single-id and multi-id copy-only resolve action for reports and prompts", () => {
    expect(fieldReportResolveAction("attention:parked:x.plan.md")).toBeNull();
    expect(fieldReportResolveAction("attention:handoff-awaiting")).toBeNull();
    expect(fieldReportResolveAction("attention:prompt:abc")).toMatchObject({
      type: "copy",
      target: "/field-report-resolve attention:prompt:abc",
      label: "Copy resolve command",
      subject: "resolve command",
      pasteDestination: "chatInput",
    });
    expect(fieldReportResolveAction("attention:report:widget")).toMatchObject({
      type: "copy",
      target: "/field-report-resolve attention:report:widget",
      label: "Copy resolve command",
      subject: "resolve command",
      pasteDestination: "chatInput",
    });
    expect(
      fieldReportResolveAction([
        "attention:prompt:abc",
        "attention:report:widget",
        "attention:report:other",
        "attention:report:widget",
        "not-valid",
        "attention:handoff-awaiting",
      ]),
    ).toMatchObject({
      type: "copy",
      target:
        "/field-report-resolve attention:prompt:abc attention:report:widget attention:report:other",
      label: "Copy resolve command for all",
      subject: "bulk resolve command",
      pasteDestination: "chatInput",
    });
  });

  it("documents multi-id resolve in the slash command contract", () => {
    const commandMd = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../.cursor/commands/field-report-resolve.md",
      ),
      "utf8",
    );
    expect(commandMd).toContain("/field-report-resolve <attention-id> [<attention-id>...]");
    expect(commandMd).toContain("attention:report:");
    expect(commandMd).toContain("attention:prompt:");
    expect(commandMd).toMatch(/IDs only/i);
  });
});
