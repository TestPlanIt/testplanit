/**
 * Phase 14 Wave 2 (COR-04) — shared audit-row grouping pass.
 *
 * Pins the single place the operationId collapsing rule lives (Pitfall G defense):
 * - null operationId → standalone singleton (never merged)
 * - same operationId → first row is the lead, the rest are children
 * - NON-contiguous same operationId (interleaved by a concurrent save) still
 *   collapses into one group via the seen-Map, not duplicate leads
 *
 * Pure unit suite (no DB, no React) — the helper is framework-free.
 *
 * Implementing plan: 14-06 (lib/audit/groupAuditRows.ts).
 */
import { describe, expect, it } from "vitest";
import type { ExtendedAuditLog } from "~/app/[locale]/admin/audit-logs/columns";
import { groupAuditRows } from "~/lib/audit/groupAuditRows";

// Minimal row factory — only the fields the grouping pass reads matter; the rest
// are filled to satisfy the type without affecting behavior.
function row(id: string, operationId: string | null): ExtendedAuditLog {
  return {
    id,
    operationId,
    userId: "u1",
    userEmail: "u@example.com",
    userName: "User",
    action: "UPDATE",
    entityType: "RepositoryCases",
    entityId: "1",
    entityName: "Login flow",
    changes: null,
    metadata: null,
    timestamp: new Date("2026-01-01T00:00:00Z"),
    projectId: 1,
  } as unknown as ExtendedAuditLog;
}

describe("groupAuditRows (COR-04)", () => {
  it("renders a null-operationId row as its own singleton group", () => {
    const groups = groupAuditRows([row("a", null), row("b", null)]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lead.id).toBe("a");
    expect(groups[0].children).toHaveLength(0);
    expect(groups[0].operationId).toBeNull();
    expect(groups[1].lead.id).toBe("b");
  });

  it("collapses contiguous same-operationId rows into one lead + children", () => {
    const groups = groupAuditRows([
      row("a", "op1"),
      row("b", "op1"),
      row("c", "op1"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lead.id).toBe("a");
    expect(groups[0].children.map((r) => r.id)).toEqual(["b", "c"]);
    expect(groups[0].operationId).toBe("op1");
  });

  it("collapses NON-contiguous same-operationId rows (seen-Map, Pitfall G)", () => {
    // op1 and op2 interleave as if two saves landed concurrently.
    const groups = groupAuditRows([
      row("a", "op1"),
      row("b", "op2"),
      row("c", "op1"),
      row("d", "op2"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lead.id).toBe("a");
    expect(groups[0].children.map((r) => r.id)).toEqual(["c"]);
    expect(groups[1].lead.id).toBe("b");
    expect(groups[1].children.map((r) => r.id)).toEqual(["d"]);
  });

  it("keeps null-operationId rows ungrouped even when interleaved with a group", () => {
    const groups = groupAuditRows([
      row("a", "op1"),
      row("b", null),
      row("c", "op1"),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lead.id).toBe("a");
    expect(groups[0].children.map((r) => r.id)).toEqual(["c"]);
    expect(groups[1].lead.id).toBe("b");
    expect(groups[1].children).toHaveLength(0);
    expect(groups[1].operationId).toBeNull();
  });

  it("returns an empty array for no rows", () => {
    expect(groupAuditRows([])).toEqual([]);
  });
});
