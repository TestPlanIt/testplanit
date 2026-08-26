/**
 * How this app writes the label for an issue-backed row.
 *
 * A tracker-synced issue carries the tracker's key in `name` ("ADM-3176")
 * and the human-readable summary in `title` ("System Smart Panel Template
 * — Designer-Driven Deployment Pipeline"). Showing only `name` leaves a
 * list unreadable; showing only `title` loses the key people search by.
 * So an external issue reads "KEY: Title", and anything else reads `name`.
 *
 * This rule lived as an inline expression inside
 * `components/tables/IssuesDisplay.tsx`. It is shared here so the
 * requirements surface uses the identical convention rather than a second
 * copy that can drift.
 */
/**
 * True when a row has a second string worth showing beyond its own name --
 * a Title field gated on this has nothing to add that the header (which
 * already renders `formatIssueDisplayText`) is not already showing.
 */
export function hasDistinctIssueTitle(issue: {
  name: string;
  title?: string | null;
  externalUrl?: string | null;
}): boolean {
  const { name, title, externalUrl } = issue;
  return Boolean(externalUrl && title && title !== name);
}

export function formatIssueDisplayText(issue: {
  name: string;
  title?: string | null;
  externalUrl?: string | null;
}): string {
  return hasDistinctIssueTitle(issue)
    ? `${issue.name}: ${issue.title}`
    : issue.name;
}

/**
 * `formatIssueDisplayText`'s convention, specialized for the requirement
 * report row shapes (`RequirementCoverageGapReportRow` /
 * `RequirementTraceabilityReportRow`), which carry a `requirementKey`/
 * `requirementTitle` pair but no `externalUrl`.
 *
 * Both requirement creation paths write the SAME trimmed string to name and
 * title -- `CreateRequirementDialog.tsx` (`name: trimmedName, title:
 * trimmedName`) and `RequirementsListView.tsx`'s rename handler (`data: {
 * name: trimmed, title: trimmed }`) -- so a native requirement always has
 * `requirementTitle === requirementKey`. Without the `title !== key` guard
 * below, every native requirement's cell doubled its own name ("New
 * Requirement: New Requirement"); a synced requirement's key and title
 * genuinely differ, so it still renders "KEY: Title".
 */
export function formatRequirementCellText(row: {
  requirementKey?: string;
  requirementTitle?: string | null;
}): string {
  const key = row.requirementKey ?? "";
  const { requirementTitle } = row;
  return requirementTitle && requirementTitle !== key
    ? `${key}: ${requirementTitle}`
    : key;
}
