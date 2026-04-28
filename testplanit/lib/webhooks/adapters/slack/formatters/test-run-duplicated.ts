import type { FormattedHttpRequest, OutboundEnvelope } from "../../types";
import {
  buildBody,
  projectNameOf,
  titleAndProject,
  url,
} from "./_shared";

interface TestRunDuplicatedData {
  newRunId: number;
  sourceRunId: number;
  runTitle: string;
  sourceRunTitle?: string | null;
  projectId: number;
}

/**
 * Informational event (no outcome) — no color bar. Compact: "<new>
 * duplicated from <source>". Wired-but-uncalled in Phase 2 per
 * 02-CONTEXT D-09 (no UI duplication site identified); formatter ships
 * for symmetry so any direct-prisma caller that does emit duplicated
 * gets a usable message.
 */
export function formatTestRunDuplicatedBlocks(
  envelope: OutboundEnvelope
): FormattedHttpRequest {
  const data = envelope.data as unknown as TestRunDuplicatedData;
  const sourceTitle = data.sourceRunTitle ?? `#${data.sourceRunId}`;
  const sourceUrl = url.testRun(data.projectId, data.sourceRunId);

  return buildBody({
    text: `Test run duplicated: ${data.runTitle}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Test run duplicated", emoji: false },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: titleAndProject(
            data.runTitle,
            projectNameOf(envelope),
            url.testRun(data.projectId, data.newRunId)
          ),
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Duplicated from <${sourceUrl}|${sourceTitle}>`,
        },
      },
    ],
  });
}
