/**
 * Durable triage headings from `/plan-review-triage` (L0).
 *
 * Keep in sync with `dashboard/lib/triage-heading.mjs` (SoT).
 * `monitors-untriaged.test.ts` asserts identical RegExp source/flags.
 *
 * Match ONLY these titles, not tick headings that name a `triage-*` to-do id.
 */
export const TRIAGE_HEADING_RE = /^#{2,6}\s+(?:Triage note|Follow-?up plan|Residuals plan)\b/im;

export function hasTriageHeading(text: unknown): boolean {
  return TRIAGE_HEADING_RE.test(String(text ?? ""));
}
