/**
 * Durable triage headings written by `/plan-review-triage` (L0).
 *
 * Shared SoT for Mission Control (`isReportTriaged`) and
 * `agent-kit monitors --untriaged`. Match ONLY these heading titles, not tick
 * headings that merely name a `triage-*` to-do id (hyphens are word boundaries,
 * so `\btriage\b` falsely matched those).
 *
 * Allowed forms (case-insensitive; optional suffix after the title):
 *   ## Triage note
 *   ## Follow-up plan  (also "Followup plan")
 *   ## Residuals plan
 */
export const TRIAGE_HEADING_RE =
  /^#{2,6}\s+(?:Triage note|Follow-?up plan|Residuals plan)\b/im;

/** True when markdown carries a durable triage heading. */
export function hasTriageHeading(text) {
  return TRIAGE_HEADING_RE.test(String(text ?? ""));
}
