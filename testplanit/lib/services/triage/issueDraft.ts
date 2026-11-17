/**
 * Builds the title and TipTap description for an issue created from a
 * failure signature, pre-filled from what the AI and the grouping know.
 * Pure: labels come in from the caller so the server side stays
 * translation-free.
 */

export interface IssueDraftLabels {
  signature: string;
  latestRun: string;
  classification: string;
  rationale: string;
  nextStep: string;
  occurrences: string;
  affectedCases: string;
  latestFailure: string;
}

export interface IssueDraftInput {
  title: string;
  signatureUrl: string;
  classificationLabel: string | null;
  aiRationale: string | null;
  aiSuggestedIssueTitle: string | null;
  aiSuggestedNextStep: string | null;
  occurrenceCount: number;
  caseCount: number;
  runCount: number;
  cases: { name: string; url: string }[];
  latestRun: { name: string; url: string } | null;
  failureText: string | null;
}

export const ISSUE_DRAFT_MAX_CASES = 10;
export const ISSUE_DRAFT_MAX_TRACE_CHARS = 3000;

type Node = Record<string, unknown>;

const text = (value: string, marks?: Node[]): Node =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };
const paragraph = (...content: Node[]): Node => ({
  type: "paragraph",
  content,
});
const bold = (value: string): Node => text(value, [{ type: "bold" }]);

export function buildSignatureIssueDraft(
  input: IssueDraftInput,
  labels: IssueDraftLabels
): { title: string; description: { type: "doc"; content: Node[] } } {
  const content: Node[] = [];

  content.push(
    paragraph(
      bold(`${labels.signature}: `),
      text(input.title, [{ type: "link", attrs: { href: input.signatureUrl } }])
    )
  );

  if (input.classificationLabel) {
    content.push(
      paragraph(
        bold(`${labels.classification}: `),
        text(input.classificationLabel)
      )
    );
  }

  if (input.aiRationale) {
    content.push(
      paragraph(bold(`${labels.rationale}: `), text(input.aiRationale))
    );
  }
  if (input.aiSuggestedNextStep) {
    content.push(
      paragraph(bold(`${labels.nextStep}: `), text(input.aiSuggestedNextStep))
    );
  }

  content.push(
    paragraph(
      bold(`${labels.occurrences}: `),
      text(`${input.occurrenceCount} / ${input.caseCount} / ${input.runCount}`)
    )
  );

  if (input.cases.length > 0) {
    const shown = input.cases.slice(0, ISSUE_DRAFT_MAX_CASES);
    const items = shown.map((testCase) => ({
      type: "listItem",
      content: [
        paragraph(
          text(testCase.name, [{ type: "link", attrs: { href: testCase.url } }])
        ),
      ],
    }));
    if (input.cases.length > shown.length) {
      items.push({
        type: "listItem",
        content: [paragraph(text(`+${input.cases.length - shown.length}`))],
      });
    }
    content.push(paragraph(bold(`${labels.affectedCases}:`)));
    content.push({ type: "bulletList", content: items });
  }

  if (input.latestRun) {
    content.push(
      paragraph(
        bold(`${labels.latestRun}: `),
        text(input.latestRun.name, [
          { type: "link", attrs: { href: input.latestRun.url } },
        ])
      )
    );
  }

  if (input.failureText) {
    const trace =
      input.failureText.length > ISSUE_DRAFT_MAX_TRACE_CHARS
        ? `${input.failureText.slice(0, ISSUE_DRAFT_MAX_TRACE_CHARS)}\n…`
        : input.failureText;
    content.push(paragraph(bold(`${labels.latestFailure}:`)));
    content.push({ type: "codeBlock", content: [text(trace)] });
  }

  return {
    title: input.aiSuggestedIssueTitle?.trim() || input.title,
    description: { type: "doc", content },
  };
}
