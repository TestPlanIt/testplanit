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
export function formatIssueDisplayText(issue: {
  name: string;
  title?: string | null;
  externalUrl?: string | null;
}): string {
  const { name, title, externalUrl } = issue;
  return externalUrl && title && title !== name ? `${name}: ${title}` : name;
}
