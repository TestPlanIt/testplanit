import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

interface TestRunStateChangedData {
  runId: number;
  runTitle: string;
  projectId: number;
  from: {
    stateId: number | null;
    stateName: string | null;
    stateColor?: string | null;
    isCompleted: boolean;
  };
  to: {
    stateId: number | null;
    stateName: string | null;
    stateColor?: string | null;
    isCompleted: boolean;
  };
  isCompletedTransition: boolean;
}

/**
 * Pure transition-log event — no color bar (the parallel
 * `test_run.completed` event with its own green/red/yellow handles the
 * outcome signal when isCompleted flips). Slack message is intentionally
 * compact; high-frequency event.
 */
export function formatTestRunStateChangedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunStateChangedData;
  const fromName = data.from?.stateName ?? "—";
  const toName = data.to?.stateName ?? "—";

  return buildBody({
    text: `Test run state changed: ${data.runTitle}`,
    // Color bar = the workflow color of the state being transitioned TO.
    // Falls through to no-bar when color is absent (e.g. legacy events
    // without this field).
    color: data.to?.stateColor ?? undefined,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Test run state changed",
          emoji: false,
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: titleAndProject(
            data.runTitle,
            projectNameOf(envelope),
            url.testRun(data.projectId, data.runId)
          ),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${fromName}*  →  *${toName}*`,
        },
      },
    ],
  });
}
