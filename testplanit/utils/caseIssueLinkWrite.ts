/**
 * The write plan the test case save uses to replace a case's issue links.
 *
 * The case form's Issues field is a tracker picker, so the value it submits
 * can only ever name issues the picker is able to round-trip. Reading the
 * absence of any other link as a removal would delete links the field never
 * had a say over, so the replace covers exactly the links the picker owns and
 * holds the rest out of it.
 *
 * Provenance is the durable expression of "the picker could have produced
 * this": every issue the picker yields is owned by an integration, so an
 * integration-less link is out of its reach by construction. That is a
 * narrower claim than "is a requirement" and does not depend on the caller
 * knowing why the link exists. It is also only one direction of the picker's
 * real rule — the picker additionally requires the owning integration to be
 * ACTIVE, so a link stranded by a deactivated integration is out of its reach
 * too and is NOT preserved here.
 *
 * Preserving a link is the ONLY mechanism that keeps it alive. The submitted
 * value must never carry ids the picker does not own: a form value is a
 * page-load snapshot, and the case's Linked Requirements panel commits its
 * unlinks straight to the database without touching it, so an id that rides
 * along in the snapshot is recreated here after the user has removed it.
 */

export interface CaseIssueLinkRow {
  issue?: { id: number; integrationId?: number | null } | null;
}

export interface CaseIssueLinkWrite {
  /**
   * Held out of the delete: existing links the picker cannot express. The
   * delete runs as `issueId: { notIn: preservedIssueIds }`.
   */
  preservedIssueIds: number[];
  /** Link rows to (re)create from the submitted value. */
  linkedIssueIds: number[];
}

export function planCaseIssueLinkWrite(
  existingLinks: readonly CaseIssueLinkRow[] | null | undefined,
  submittedIssueIds: readonly (number | null | undefined)[] | null | undefined
): CaseIssueLinkWrite {
  const preservedIssueIds: number[] = [];
  for (const link of existingLinks ?? []) {
    const issue = link?.issue;
    if (issue && issue.integrationId == null) {
      preservedIssueIds.push(issue.id);
    }
  }

  const linkedIssueIds: number[] = [];
  const seen = new Set<number>();
  for (const issueId of submittedIssueIds ?? []) {
    if (issueId == null || seen.has(issueId)) continue;
    seen.add(issueId);
    linkedIssueIds.push(issueId);
  }

  return { preservedIssueIds, linkedIssueIds };
}
