import { randomUUID } from "node:crypto";
import { PostHog } from "posthog-node";
import type { TurnResult } from "./hitl-relay.js";
import type { DriverUsage } from "./token-usage.js";

export interface AiGenerationContext {
  sessionId: string;
  traceId: string;
  spanId: string;
  provider: string;
  model: string;
  input: string;
  startedAt: number;
}

interface AiGenerationOptions {
  provider: string;
  model?: string;
  input: string;
  sessionId?: string;
}

interface AiGenerationCompletion {
  result?: TurnResult;
  usage?: DriverUsage | null;
  exitCode: number;
}

let posthog: PostHog | null | undefined;

function warnWhenMissing(variable: string) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
    );
  }
}

function getPostHog(): PostHog | null {
  if (posthog !== undefined) return posthog;

  try {
    process.loadEnvFile?.();
  } catch {
    // Global CLI installs normally receive configuration from the process environment.
  }

  const token = process.env.POSTHOG_PROJECT_TOKEN;
  const host = process.env.POSTHOG_HOST;
  if (!token) warnWhenMissing("POSTHOG_PROJECT_TOKEN");
  if (!host) warnWhenMissing("POSTHOG_HOST");
  if (!token || !host) {
    posthog = null;
    return posthog;
  }

  posthog = new PostHog(token, {
    host,
    privacyMode: false,
    enableExceptionAutocapture: false,
    flushAt: 1,
    flushInterval: 0,
    requestTimeout: 2_000,
    fetchRetryCount: 0,
  });
  return posthog;
}

export function startAiGeneration(options: AiGenerationOptions): AiGenerationContext {
  return {
    sessionId: options.sessionId ?? `agent-kit-${randomUUID()}`,
    traceId: randomUUID(),
    spanId: randomUUID(),
    provider: options.provider,
    model: options.model || "agent-cli-default",
    input: options.input,
    startedAt: Date.now(),
  };
}

export function nextAiGenerationTurn(
  generation: AiGenerationContext,
  input: string,
): AiGenerationContext {
  return startAiGeneration({
    provider: generation.provider,
    model: generation.model,
    input,
    sessionId: generation.sessionId,
  });
}

/**
 * The vendor CLIs are opaque processes, so this records the prompt, terminal
 * result and any token totals their stream protocol exposes as one generation.
 */
export function captureAiGeneration(
  generation: AiGenerationContext,
  completion: AiGenerationCompletion,
): void {
  if (process.env.NODE_ENV === "test") return;
  const client = getPostHog();
  if (!client) return;

  const result = completion.result;
  const output = result?.resultText || result?.assistantTexts.at(-1);
  try {
    client.capture({
      distinctId: generation.sessionId,
      event: "$ai_generation",
      properties: {
        $ai_trace_id: generation.traceId,
        $ai_session_id: generation.sessionId,
        $ai_span_id: generation.spanId,
        $ai_span_name: "agent_kit_agent_turn",
        $ai_provider: generation.provider,
        $ai_model: generation.model,
        $ai_input: [{ role: "user", content: generation.input }],
        ...(output ? { $ai_output_choices: [{ role: "assistant", content: output }] } : {}),
        ...(completion.usage
          ? {
              $ai_input_tokens: completion.usage.inputTokens,
              $ai_output_tokens: completion.usage.outputTokens,
              ...(completion.usage.cachedInputTokens !== null
                ? { $ai_cache_read_input_tokens: completion.usage.cachedInputTokens }
                : {}),
            }
          : {}),
        $ai_latency: (Date.now() - generation.startedAt) / 1_000,
        $ai_stream: true,
        $ai_is_error: completion.exitCode !== 0 || result?.isError === true,
      },
    });
  } catch {
    // Observability must not affect a completed agent invocation.
  }
}

/** Flush at CLI shutdown, never while an external LLM process is still running. */
export async function shutdownAiObservability(): Promise<void> {
  if (!posthog) return;
  await posthog.shutdown(2_000).catch(() => undefined);
}
