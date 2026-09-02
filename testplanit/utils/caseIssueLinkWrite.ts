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
 *
 * `pickerOwnedIssueIds` is how that stays true. It seeds the form value, and
 * it is the exact complement of `preservedIssueIds` over the same links —
 * every link is either carried by the value and replaced, or held back and
 * left alone, and none is both or neither. That is why the two live in one
 * module behind one predicate: split them across the seed and the save and a
 * link can fall between the two rules, dropped from the submitted value by
 * one and deleted by the other. Row kind is the tempting predicate for the
 * seed and the wrong one for exactly that reason — a requirement synced from
 * a tracker IS owned by an integration, so filtering the seed by "is a
 * requirement" would strip an id the save still expects to see and delete a
 * link nobody touched.
 */

export interface CaseIssueLinkRow {
  issue?: { id: number; integrationId?: number | null } | null;
}

type CaseIssueLinkIssue = NonNullable<CaseIssueLinkRow["issue"]>;

function isPickerOwned(issue: CaseIssueLinkIssue): boolean {
  return issue.integrationId != null;
}

/**
 * The ids of the links the picker owns, for seeding the Issues form value.
 */
export function pickerOwnedIssueIds(
  existingLinks: readonly CaseIssueLinkRow[] | null | undefined
): number[] {
  const ownedIssueIds: number[] = [];
  for (const link of existingLinks ?? []) {
    const issue = link?.issue;
    if (issue && isPickerOwned(issue)) {
      ownedIssueIds.push(issue.id);
    }
  }
  return ownedIssueIds;
}

/** One entry of a version snapshot's `issues` JSON column. */
export interface VersionSnapshotIssue {
  id: number;
  name: string;
  externalId: string | null;
}

/** A link row carrying enough of the issue to snapshot it. */
export interface VersionSnapshotLinkRow {
  issue?: {
    id: number;
    name?: string | null;
    externalId?: string | null;
    isRequirement?: boolean | null;
  } | null;
}

/**
 * The issue list a version snapshot should record, given what the Issues
 * form value produced and what the case actually links.
 *
 * The form value is the tracker picker's set and only that: it is seeded by
 * `pickerOwnedIssueIds` above (integration-owned links only) and the picker
 * republishes it from what the tracker returned. Requirement links are
 * authored on a separate panel and are frequently native, with no
 * integration at all, so they never appear in it. Using the form value as
 * the snapshot's whole issue list is what made version history lossy — the
 * links survive the save (`planCaseIssueLinkWrite` holds them out of the
 * delete), but the snapshot recorded them as absent, so a diff showed a
 * requirement link vanishing at a point in time when it was still there.
 *
 * The picker's own entries win on collision: a requirement synced from a
 * tracker is integration-owned, so it can legitimately appear in both sets,
 * and the picker's copy is the one the user just edited.
 */
export function mergeRequirementLinksIntoVersionIssues(
  pickerIssues: readonly VersionSnapshotIssue[],
  existingLinks: readonly VersionSnapshotLinkRow[] | null | undefined
): VersionSnapshotIssue[] {
  const merged = [...pickerIssues];
  const seen = new Set(merged.map((issue) => issue.id));
  for (const link of existingLinks ?? []) {
    const issue = link?.issue;
    if (!issue || !issue.isRequirement || seen.has(issue.id)) {
      continue;
    }
    seen.add(issue.id);
    merged.push({
      id: issue.id,
      name: issue.name ?? "",
      externalId: issue.externalId ?? null,
    });
  }
  return merged;
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
    if (issue && !isPickerOwned(issue)) {
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
