import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import { buildBody, projectNameOf, titleAndProject, url } from "./_shared";

/**
 * `test_run.created` payload (see event-emitters/testRunEvents.ts):
 *   { runId, runTitle, stateId, stateName, isCompleted, projectId }
 * Informational event — no color bar. The emitter already resolves stateName.
 */
interface TestRunCreatedData {
  runId: number;
  runTitle: string;
  projectId: number;
  stateName?: string | null;
}

export function formatTestRunCreatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunCreatedData;
  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: "Test run created", emoji: false },
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
  ];
  if (data.stateName) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*State:* ${data.stateName}` },
    });
  }
  return buildBody({ text: `Test run created: ${data.runTitle}`, blocks });
}
