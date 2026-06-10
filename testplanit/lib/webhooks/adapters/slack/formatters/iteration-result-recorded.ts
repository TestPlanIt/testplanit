import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `iteration.result.recorded` payload (see event-emitters/iterationEvents.ts):
 *   { iterationId, testRunCaseId, testRunId, statusId, statusName, runTitle,
 *     projectId, rowIndex, redactedValues }
 * `redactedValues` is the parameter map with sensitive values already
 * replaced by the caller (D-13). statusName / runTitle are resolved at emit.
 */
interface IterationResultRecordedData {
  testRunId: number;
  projectId: number;
  statusName?: string | null;
  runTitle?: string | null;
  rowIndex?: number;
  redactedValues?: Record<string, unknown>;
}

const MAX_PARAMS = 6;
const VALUE_MAX_LEN = 40;

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

export function formatIterationResultRecordedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as IterationResultRecordedData;
  const statusName = data.statusName ?? "—";
  const runLabel = data.runTitle ?? `Run #${data.testRunId}`;
  const rowLabel =
    typeof data.rowIndex === "number" ? `Row ${data.rowIndex + 1}` : null;

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Iteration result recorded",
        emoji: false,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: titleAndProject(
          runLabel,
          projectNameOf(envelope),
          url.testRun(data.projectId, data.testRunId)
        ),
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: rowLabel
          ? `*Status:* ${statusName} · ${rowLabel}`
          : `*Status:* ${statusName}`,
      },
    },
  ];

  const entries = Object.entries(data.redactedValues ?? {});
  if (entries.length > 0) {
    const params = entries
      .slice(0, MAX_PARAMS)
      .map(([k, v]) => `${k}=${truncate(String(v), VALUE_MAX_LEN)}`)
      .join(" · ");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: params },
    });
  }

  return buildBody({ text: `Iteration result: ${statusName}`, blocks });
}
