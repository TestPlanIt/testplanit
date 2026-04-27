import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";

interface TestRunResultAddedData {
  runId: number;
  runTitle: string;
  caseId: number;
  caseTitle: string;
  resultId: number;
  statusId: number;
  statusName: string;
  isCompleted?: boolean;
  attempt?: number;
}

/**
 * D-13 — `test_run.result_added` is volume-warned; the formatter is
 * intentionally compact to avoid wall-of-text channels.
 */
export function formatTestRunResultAddedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunResultAddedData;
  const text = `Result for "${data.caseTitle}" in run "${data.runTitle}": ${data.statusName}`;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Result:* ${data.statusName}\n*Case:* ${data.caseTitle}\n*Run:* ${data.runTitle}`,
      },
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `eventId: \`${envelope.eventId}\` · attempt ${data.attempt ?? 1} · ${envelope.eventTimestamp}`,
        },
      ],
    },
  ];

  return {
    body: JSON.stringify({ text, blocks }),
    contentType: "application/json",
  };
}
