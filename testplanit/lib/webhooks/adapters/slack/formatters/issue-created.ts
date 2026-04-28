import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf } from "./_shared";

interface IssueCreatedData {
  id: number;
  title: string;
  severity?: string | null;
  status?: string | null;
  externalKey?: string | null;
  externalUrl?: string | null;
  linkedRefs?: {
    repositoryCaseIds?: number[];
    testRunIds?: number[];
    testRunResultIds?: number[];
    testRunStepResultIds?: number[];
    sessionIds?: number[];
    sessionResultIds?: number[];
  };
}

/**
 * Informational event — no color bar. When the Issue carries an
 * externalUrl (e.g. Jira link from issue-tracker integrations), use it
 * as the title link; otherwise the title renders as plain bold.
 */
export function formatIssueCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as IssueCreatedData;
  const titleLink = data.externalUrl
    ? `*<${data.externalUrl}|${data.title}>*`
    : `*${data.title}*`;

  // Inline meta-line: severity · status · externalKey, with separators
  // only between present values.
  const metaParts: string[] = [];
  if (data.severity) metaParts.push(`*Severity:* ${data.severity}`);
  if (data.status) metaParts.push(`*Status:* ${data.status}`);
  if (data.externalKey) metaParts.push(`*${data.externalKey}*`);
  const metaLine = metaParts.length > 0 ? metaParts.join(" · ") : null;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Issue created", emoji: false },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${titleLink}\nin ${projectNameOf(envelope)}`,
      },
    },
  ];

  if (metaLine) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: metaLine },
    });
  }

  // Linked references summary — single line of "linked to N test runs,
  // M test results, K cases" — only when refs exist.
  const refs = data.linkedRefs;
  if (refs) {
    const counts: string[] = [];
    if (refs.testRunIds?.length)
      counts.push(`${refs.testRunIds.length} run${refs.testRunIds.length === 1 ? "" : "s"}`);
    if (refs.testRunResultIds?.length)
      counts.push(`${refs.testRunResultIds.length} result${refs.testRunResultIds.length === 1 ? "" : "s"}`);
    if (refs.repositoryCaseIds?.length)
      counts.push(`${refs.repositoryCaseIds.length} case${refs.repositoryCaseIds.length === 1 ? "" : "s"}`);
    if (refs.sessionIds?.length)
      counts.push(`${refs.sessionIds.length} session${refs.sessionIds.length === 1 ? "" : "s"}`);
    if (counts.length > 0) {
      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Linked to ${counts.join(", ")}`,
        },
      });
    }
  }

  return buildBody({
    text: `Issue created: ${data.title}`,
    blocks,
  });
}
