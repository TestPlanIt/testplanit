import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

/**
 * Shared helpers for Slack formatters. All formatters use the same
 * pattern established by `test_run.completed`:
 *
 *   - Optional colored left-edge bar via `attachments[{ color, blocks }]`
 *     for outcome events (pass/fail/in-progress).
 *   - Plain `blocks` at top level for purely informational events.
 *   - No eventId/timestamp footer (trace data lives on WebhookDelivery).
 *   - Trimmed top-level `text` field (notification preview only).
 *   - Bold + clickable title with `in <project>` secondary line.
 *
 * Color hex chosen to read well on light + dark Slack themes.
 */
export const COLOR_GREEN = "#22c55e";
export const COLOR_RED = "#ef4444";
export const COLOR_YELLOW = "#eab308";

/** Resolve the deployed app base URL. NEXTAUTH_URL is the codebase precedent. */
function baseUrl(): string {
  return process.env.NEXTAUTH_URL ?? "http://localhost:3000";
}

/** Locale-less paths; next-intl resolves the recipient's preferred locale at request time. */
export const url = {
  testRun: (projectId: number, runId: number): string =>
    `${baseUrl()}/projects/runs/${projectId}/${runId}`,
  session: (projectId: number, sessionId: number): string =>
    `${baseUrl()}/projects/sessions/${projectId}/${sessionId}`,
  case: (projectId: number, caseId: number): string =>
    `${baseUrl()}/projects/repository/${projectId}/${caseId}`,
  issue: (projectId: number, issueId: number): string =>
    `${baseUrl()}/projects/issues/${projectId}?issueId=${issueId}`,
};

/** Slack mrkdwn link `<url|text>`, or plain bold text when url is omitted. */
export function boldLink(text: string, href?: string): string {
  return href ? `*<${href}|${text}>*` : `*${text}*`;
}

/**
 * "Tracked in <key>" line linking to the external issue tracker (Jira /
 * GitHub) when the issue carries one. Used by issue.created and issue.updated
 * so both keep the tracker reachable while the title links into TestPlanIt.
 */
export function trackerLine(
  externalKey?: string | null,
  externalUrl?: string | null
): string | null {
  if (!externalKey) return null;
  return externalUrl
    ? `Tracked in <${externalUrl}|${externalKey}>`
    : `Tracked in *${externalKey}*`;
}

/** "Title (linked) \n in Project" — the standard 2-line entity header. */
export function titleAndProject(
  title: string,
  projectName: string,
  href?: string
): string {
  return `${boldLink(title, href)}\nin ${projectName}`;
}

/**
 * Pick a Slack `:emoji:` for a status row using the Status table flags.
 * Mirrors the in-app TestRunCasesSummary component's semantics.
 */
export function emojiForStatus(sc: {
  isSuccess?: boolean;
  isFailure?: boolean;
  isCompleted?: boolean;
}): string {
  if (sc.isSuccess) return ":white_check_mark:";
  if (sc.isFailure) return ":x:";
  if (sc.isCompleted === false || sc.isCompleted === undefined) {
    return ":hourglass_flowing_sand:";
  }
  return ":fast_forward:"; // Skipped (completed but neither success nor failure)
}

/**
 * Outcome color rule used by test_run.completed and session.completed.
 *   - failed > 0 → RED
 *   - !100% complete OR pending > 0 → YELLOW
 *   - else → GREEN
 */
export function colorForOutcome(args: {
  failed: number;
  pending: number;
  completionPct: number;
}): string {
  if (args.failed > 0) return COLOR_RED;
  if (args.pending > 0 || args.completionPct < 100) return COLOR_YELLOW;
  return COLOR_GREEN;
}

/**
 * Wrap an array of blocks into the final Slack body. When `color` is
 * provided, blocks render inside an attachment so Slack shows the
 * colored left-edge bar. Otherwise blocks render at the top level (no
 * bar — used for purely informational events).
 *
 * `text` is the notification preview shown above the message body and in
 * push/email/mobile notifications. Keep it short.
 */
export function buildBody(args: {
  text: string;
  blocks: Array<Record<string, unknown>>;
  color?: string;
}): FormattedHttpRequest {
  const payload = args.color
    ? {
        text: args.text,
        attachments: [{ color: args.color, blocks: args.blocks }],
      }
    : { text: args.text, blocks: args.blocks };
  return {
    body: JSON.stringify(payload),
    contentType: "application/json",
  };
}

/** Convenience: minimal envelope-typed access to `projectName` for formatters. */
export function projectNameOf(envelope: OutboundEnvelope): string {
  return envelope.projectName ?? "—";
}
