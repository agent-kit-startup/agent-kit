import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { posthogConfig } from "./posthog.mjs";

const logProvider = posthogConfig
  ? new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "mission-control-dashboard" }),
      processors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            url: `${posthogConfig.host.replace(/\/$/, "")}/i/v1/logs`,
            headers: { Authorization: `Bearer ${posthogConfig.token}` },
          }),
        ),
      ],
    })
  : null;

const posthogLog = logProvider?.getLogger("mission-control-dashboard.posthog");

/** Emits only purpose-built dashboard telemetry; application console logs stay local. */
export function emitPostHogLog(severityText, body, attributes = {}) {
  posthogLog?.emit({ severityText, body, attributes });
}

/** Best-effort bounded flush for process shutdown; never delays application work. */
export async function shutdownPostHogLogs(timeoutMs = 3000) {
  if (!logProvider) return;

  let timeout;
  await Promise.race([
    logProvider.shutdown().catch(() => {}),
    new Promise((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeout));
}
