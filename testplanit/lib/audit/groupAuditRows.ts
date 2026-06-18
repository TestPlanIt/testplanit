import type { ExtendedAuditLog } from "~/app/[locale]/admin/audit-logs/columns";

/**
 * A single rendered entry in an audit-log table after operationId collapsing.
 *
 * - `lead` is the first row seen for its `operationId` (or any row with a null
 *   `operationId`); it is what the table shows on the collapsed line.
 * - `children` are the remaining rows that share the lead's `operationId`. They
 *   are revealed inline when the lead is expanded. Always empty for a singleton
 *   (null `operationId` or a lone occurrence of an `operationId`).
 * - `operationId` is the shared correlation id, or `null` for an ungrouped row.
 */
export interface GroupedAuditRow {
  lead: ExtendedAuditLog;
  children: ExtendedAuditLog[];
  operationId: string | null;
}

/**
 * Collapse audit rows that belong to the same logical save into one expandable
 * entry. One user action (e.g. editing a test case) fans out into several CDC
 * writes — case + steps + field values — each correlated by a shared
 * `operationId`. Grouping turns those N rows into one "Brad edited Login flow"
 * lead with the per-child changes nested underneath.
 *
 * Rules:
 * - A row whose `operationId` is null/undefined renders standalone (its own
 *   singleton group, never merged) — semantic events and legacy rows are
 *   unaffected.
 * - The FIRST row encountered for a given `operationId` becomes the lead; every
 *   later row with the same `operationId` is appended to that group's children.
 *
 * This is the single place the grouping rule lives (Pitfall G defense): it uses
 * a seen-Map keyed by `operationId` rather than only collapsing adjacent rows,
 * so non-contiguous same-`operationId` rows — which can arise when two users
 * save concurrently and their rows interleave in the timestamp-sorted page —
 * still collapse into one group instead of producing duplicate leads.
 *
 * Framework-free (no React) so it stays unit-testable and shared by every audit
 * surface; callers wrap it in `useMemo(() => groupAuditRows(rows), [rows])`.
 *
 * KNOWN/ACCEPTED UX LIMIT: when a group straddles an infinite-scroll page
 * boundary, only the children loaded so far are attached to the lead; the rest
 * appear after the next page loads (and re-grouping reruns over the larger row
 * set). There is no structural fix at the render layer — the worker writes one
 * AuditLog row per child and the client only sees the rows it has fetched — so
 * this is intentionally left as-is.
 */
export function groupAuditRows(rows: ExtendedAuditLog[]): GroupedAuditRow[] {
  const groups: GroupedAuditRow[] = [];
  // Maps a non-null operationId to its already-created group so later rows with
  // the same id attach as children even when they are not adjacent.
  const seen = new Map<string, GroupedAuditRow>();

  for (const row of rows) {
    const operationId = row.operationId ?? null;

    if (operationId === null) {
      groups.push({ lead: row, children: [], operationId: null });
      continue;
    }

    const existing = seen.get(operationId);
    if (existing) {
      existing.children.push(row);
      continue;
    }

    const group: GroupedAuditRow = { lead: row, children: [], operationId };
    seen.set(operationId, group);
    groups.push(group);
  }

  return groups;
}
