// Failed-iteration linked-issue body builder — implementation lands with INT-05.

/**
 * Pure helper that produces a linked-Issue `{ title, description }` for a
 * failed iteration. Description is a TipTap doc (typed as `unknown` here
 * to avoid pulling the editor types into the server bundle) — Jira /
 * Azure DevOps adapters convert it to their native format; GitHub uses
 * `tiptapToMarkdown` for plain markdown.
 *
 * Concrete shape lands with INT-05.
 */
export interface IterationIssueBodyInput {
  iterationId: number;
  testRunCaseId: number;
  testRunId: number;
  projectId: number;
  /** Whether the viewer is allowed to see sensitive parameter values. */
  viewerCanReadSensitive: boolean;
}

export interface IterationIssueBody {
  title: string;
  description: unknown;
}

export function buildIterationIssueBody(
  input: IterationIssueBodyInput
): IterationIssueBody {
  void input;
  throw new Error(
    "buildIterationIssueBody: not implemented yet (lands with INT-05)"
  );
}
