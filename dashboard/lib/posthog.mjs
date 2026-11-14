import { PostHog } from "posthog-node";

try {
  process.loadEnvFile?.();
} catch {
  // Deployment environments may provide configuration without a local .env file.
}

const token = process.env.POSTHOG_PROJECT_TOKEN;
const host = process.env.POSTHOG_HOST;

function warnWhenMissing(variable) {
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      `${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`,
    );
  }
}

if (!token) warnWhenMissing("POSTHOG_PROJECT_TOKEN");
if (!host) warnWhenMissing("POSTHOG_HOST");

export const posthogConfig = token && host ? { token, host } : null;

export const posthog = posthogConfig
  ? new PostHog(posthogConfig.token, {
      host: posthogConfig.host,
      enableExceptionAutocapture: true,
    })
  : null;

export async function shutdownPostHog() {
  await posthog?.shutdown(3000).catch(() => undefined);
}
