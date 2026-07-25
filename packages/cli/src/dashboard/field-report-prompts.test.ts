import { describe, expect, it } from "vitest";
import {
  MAX_AGENT_PROMPTS,
  MAX_SEMANTIC_LABEL,
  buildAgentPromptItems,
  buildMissionControlView,
  detectAwaitingPrompt,
  extractQuestionLabel,
  isAgentQuestionEntry,
  isUserEntry,
} from "../../../../dashboard/lib/semantic-model.mjs";

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

  it("degrades on non-array input", () => {
    expect(detectAwaitingPrompt(null as unknown as unknown[])).toBeNull();
    expect(detectAwaitingPrompt(undefined as unknown as unknown[])).toBeNull();
  });
});

describe("buildAgentPromptItems", () => {
  it("shapes items with a copy-only chat-reference action naming the past-chat picker", () => {
    const items = buildAgentPromptItems([
      { chatId: "abc-123", label: "Pick one", quietAt: "2026-07-25T10:00:00.000Z" },
    ]);
    expect(items[0]).toMatchObject({
      id: "attention:prompt:abc-123",
      kind: "prompt",
      severity: "action",
      label: "Pick one",
      chatId: "abc-123",
      modifiedAt: "2026-07-25T10:00:00.000Z",
      action: {
        type: "copy",
        target: "abc-123",
        pasteDestination: "past-chat picker",
      },
    });
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

describe("buildMissionControlView wiring", () => {
  it("surfaces agent prompts first in the attention stack", () => {
    const view = buildMissionControlView({
      plans: [],
      handoff: null,
      agentPrompts: [{ chatId: "chat-xyz", label: "Awaiting reply", quietAt: null }],
    });
    const prompt = view.attention.find((i) => i.kind === "prompt");
    expect(prompt).toBeDefined();
    expect(view.attention[0].kind).toBe("prompt");
    expect(prompt?.action?.target).toBe("chat-xyz");
  });

  it("adds no prompt items when the store yields nothing", () => {
    const view = buildMissionControlView({ plans: [], handoff: null, agentPrompts: [] });
    expect(view.attention.some((i) => i.kind === "prompt")).toBe(false);
  });
});
