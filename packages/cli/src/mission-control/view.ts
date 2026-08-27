/**
 * Project dashboard-data JSON onto the four TUI panels.
 * Semantics stay in semantic-model.mjs; this only selects and caps fields.
 */

export type McTuiMission = {
  status: string;
  planFile: string | null;
  mode: string | null;
  progressLabel: string;
  currentTodo: string | null;
  nextTodo: string | null;
  gaps: string | null;
};

export type McTuiFlightLog = {
  now: string | null;
  nowKind: string | null;
  earlier: string[];
  warnings: string[];
};

export type McTuiChecklistRow = {
  file: string;
  lifecycle: string;
  progressLabel: string;
  currentTodo: string | null;
};

export type McTuiCrewRow = {
  kind: string;
  label: string;
};

export type McTuiView = {
  mission: McTuiMission;
  flightLog: McTuiFlightLog;
  checklist: McTuiChecklistRow[];
  crewMonitor: McTuiCrewRow[];
  error: string | null;
};

const CHECKLIST_CAP = 8;
const CREW_CAP = 12;
const EARLIER_CAP = 4;
const WARNING_CAP = 5;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function compactTodo(value: unknown): string | null {
  const rec = asRecord(value);
  if (!rec) return asString(value);
  return asString(rec.id) ?? asString(rec.content) ?? asString(rec.label);
}

function progressLabel(progress: unknown): string {
  const rec = asRecord(progress);
  if (!rec) return "0 of 0 complete";
  const labeled = asString(rec.label);
  if (labeled) return labeled;
  const completed = typeof rec.completed === "number" ? rec.completed : 0;
  const total = typeof rec.total === "number" ? rec.total : 0;
  return `${completed} of ${total} complete`;
}

function emptyMission(): McTuiMission {
  return {
    status: "idle",
    planFile: null,
    mode: null,
    progressLabel: "0 of 0 complete",
    currentTodo: null,
    nextTodo: null,
    gaps: null,
  };
}

function emptyFlightLog(): McTuiFlightLog {
  return { now: null, nowKind: null, earlier: [], warnings: [] };
}

/**
 * Build the four-panel TUI view from a dashboard-data snapshot object.
 * Does not re-derive mission / activity / flight-log semantics.
 */
export function buildMcTuiView(
  snapshot: Record<string, unknown> | null | undefined,
  error: string | null = null,
): McTuiView {
  if (error) {
    return {
      mission: emptyMission(),
      flightLog: emptyFlightLog(),
      checklist: [],
      crewMonitor: [],
      error,
    };
  }
  const mc = asRecord(snapshot?.missionControl);
  const now = asRecord(mc?.now);
  const mission: McTuiMission = now
    ? {
        status: asString(now.status) ?? "idle",
        planFile: asString(now.planFile),
        mode: asString(now.mode),
        progressLabel: progressLabel(now.progress),
        currentTodo: compactTodo(now.currentTodo),
        nextTodo: compactTodo(now.nextTodo),
        gaps: asString(now.gaps),
      }
    : emptyMission();

  const flight = asRecord(mc?.flightLog);
  const earlierRaw = Array.isArray(flight?.past) ? flight.past : [];
  const warningRaw = Array.isArray(flight?.warnings) ? flight.warnings : [];
  const flightLog: McTuiFlightLog = flight
    ? {
        now: asString(flight.current),
        nowKind: asString(flight.currentKind),
        earlier: earlierRaw
          .map((entry) => asString(asRecord(entry)?.text) ?? asString(entry))
          .filter((text): text is string => Boolean(text))
          .slice(0, EARLIER_CAP),
        warnings: warningRaw
          .map((entry) => asString(asRecord(entry)?.text) ?? asString(asRecord(entry)?.title))
          .filter((text): text is string => Boolean(text))
          .slice(0, WARNING_CAP),
      }
    : emptyFlightLog();

  const plansRaw = Array.isArray(mc?.plans) ? mc.plans : [];
  const checklist: McTuiChecklistRow[] = plansRaw
    .map((plan) => {
      const rec = asRecord(plan);
      if (!rec) return null;
      const file = asString(rec.file);
      if (!file) return null;
      const lifecycle = asString(rec.lifecycle) ?? "unknown";
      if (lifecycle === "completed") return null;
      return {
        file,
        lifecycle,
        progressLabel: progressLabel(rec.progress),
        currentTodo: compactTodo(rec.currentTodo),
      };
    })
    .filter((row): row is McTuiChecklistRow => Boolean(row))
    .slice(0, CHECKLIST_CAP);

  const feedCap =
    typeof mc?.monitorFeedCap === "number" && mc.monitorFeedCap > 0
      ? Math.min(CREW_CAP, Math.floor(mc.monitorFeedCap))
      : CREW_CAP;
  const activityRaw = Array.isArray(mc?.activity) ? mc.activity : [];
  const crewMonitor: McTuiCrewRow[] = activityRaw
    .map((event) => {
      const rec = asRecord(event);
      if (!rec) return null;
      const label = asString(rec.label) ?? asString(rec.labelFull);
      if (!label) return null;
      return { kind: asString(rec.kind) ?? "activity", label };
    })
    .filter((row): row is McTuiCrewRow => Boolean(row))
    .slice(0, feedCap);

  return { mission, flightLog, checklist, crewMonitor, error: null };
}
