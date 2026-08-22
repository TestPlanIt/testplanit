import { DEFECT_SCOPE_WHERE } from "~/lib/services/issueRoleScope";

/**
 * Apply a CSV import row's `issues` column to one test case's issue links.
 *
 * The column carries issue NAMES, and `Issue.name` is unique in neither
 * direction: not across projects, and not across the two row kinds sharing
 * the table. Both scopes below exist because of that.
 *
 *   - Project scope. Without it a name that happens to repeat in another
 *     project resolves to that project's row and the import links a case to
 *     an issue its own project cannot even see. The sibling `testRuns`
 *     column in the same importer already resolves this way.
 *   - Defect scope, on the resolve AND on the replace. A requirement is
 *     authored on the requirements surfaces, is not expressible in an import
 *     row (the CSV has no way to say which of two same-named rows it means,
 *     and no way to restore one it destroyed), and its link to a case is
 *     owned by that surface rather than by this column. So the import
 *     neither creates requirement links from a name collision nor deletes
 *     the ones already on the case: `replaceExisting` clears exactly the
 *     links this column authored.
 */

export interface ImportCaseIssueLinkClient {
  issue: {
    findFirst(args: {
      where: Record<string, unknown>;
    }): Promise<{ id: number } | null>;
  };
  repositoryCaseIssue: {
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
    create(args: {
      data: { caseId: number; issueId: number };
    }): Promise<unknown>;
  };
}

export interface ImportCaseIssueLinkArgs {
  caseId: number;
  projectId: number;
  issueNames: string[];
  /** True for an update-import: the column replaces the case's defect links. */
  replaceExisting: boolean;
}

export async function replaceImportedCaseIssueLinks(
  db: ImportCaseIssueLinkClient,
  { caseId, projectId, issueNames, replaceExisting }: ImportCaseIssueLinkArgs
): Promise<void> {
  if (replaceExisting) {
    await db.repositoryCaseIssue.deleteMany({
      where: { caseId, issue: { ...DEFECT_SCOPE_WHERE } },
    });
  }

  for (const issueName of issueNames) {
    const issue = await db.issue.findFirst({
      where: {
        name: issueName,
        isDeleted: false,
        projectId,
        ...DEFECT_SCOPE_WHERE,
      },
    });

    if (issue) {
      await db.repositoryCaseIssue.create({
        data: { caseId, issueId: issue.id },
      });
    }
  }
}
