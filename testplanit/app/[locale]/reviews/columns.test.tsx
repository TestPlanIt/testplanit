import { cleanup, render, renderHook, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The Pending tab used to be one homogeneous list — every row was assigned to
// the viewer, so every row got the same Approve / Request changes / Reject
// cluster. It now also carries the reviews the viewer REQUESTED and is
// waiting on someone else to decide, and those rows must offer the requester's
// vocabulary instead (send reminder + cancel) rather than decision buttons the
// server would reject. These tests pin that per-row branch.

// Tooltip primitives need a Radix provider and a portal; neither adds
// anything here, so flatten them to plain wrappers.
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Display cells reach for the i18n nav router / server actions / session.
// The columns under test only care about which cell is rendered, not what
// each one paints.
vi.mock("~/components/tables/UserNameCell", () => ({
  UserNameCell: ({ userId }: { userId: string }) => (
    <span data-testid="user-name-cell">{userId}</span>
  ),
}));
vi.mock("~/components/reviews/RoleAssigneeChip", () => ({
  RoleAssigneeChip: ({ roleName }: { roleName: string }) => (
    <span data-testid="role-assignee-chip">{roleName}</span>
  ),
}));
vi.mock("~/components/reviews/NudgeReviewButton", () => ({
  NudgeReviewButton: ({
    reviewRequestId,
    lastRemindedAt,
  }: {
    reviewRequestId: string;
    lastRemindedAt: Date | string | null;
  }) => (
    <button
      data-testid={`reviews-inbox-nudge-${reviewRequestId}`}
      data-last-reminded-at={lastRemindedAt ? String(lastRemindedAt) : ""}
    />
  ),
}));

import { useColumns, type InboxTableRow } from "./columns";

const VIEWER_ID = "user-viewer";
const t = (key: string) => key;

const noopActions = {
  onApprove: vi.fn(),
  onRequestChanges: vi.fn(),
  onReject: vi.fn(),
  onCancel: vi.fn(),
  onNudged: vi.fn(),
};

function row(overrides: Partial<InboxTableRow> = {}): InboxTableRow {
  return {
    id: "rr-1",
    name: "CASE #1",
    entityType: "CASE",
    entityId: 1,
    projectId: 5,
    status: "PENDING",
    requestedByUserId: "user-other",
    assigneeUserId: VIEWER_ID,
    assigneeRoleId: null,
    lastRemindedAt: null,
    createdAt: new Date("2026-08-01T00:00:00Z"),
    project: { id: 5, name: "Apollo", iconUrl: null },
    requestedBy: { id: "user-other", name: "Otto", image: null },
    fromState: { id: 1, name: "Draft", icon: null, color: null },
    toState: { id: 2, name: "Approved", icon: null, color: null },
    assigneeUser: { id: VIEWER_ID, name: "Vic Viewer", image: null },
    assigneeRole: null,
    ...overrides,
  } as unknown as InboxTableRow;
}

function pendingColumns(viewerRoleIds: number[] = []) {
  const { result } = renderHook(() =>
    useColumns({
      t,
      view: "pending",
      actions: noopActions,
      viewerUserId: VIEWER_ID,
      viewerRoleIds,
      caseById: new Map(),
      testRunById: new Map(),
      sessionById: new Map(),
    })
  );
  return result.current as ColumnDef<InboxTableRow>[];
}

/** Render one column's cell for one row. */
function renderCell(
  columns: ColumnDef<InboxTableRow>[],
  columnId: string,
  data: InboxTableRow
) {
  const column = columns.find((c) => c.id === columnId);
  if (!column?.cell || typeof column.cell !== "function") {
    throw new Error(`column "${columnId}" has no cell renderer`);
  }
  const rendered = column.cell({
    row: { original: data },
    getValue: () => (data as unknown as Record<string, unknown>)[columnId],
  } as never);
  // Tests that render two rows back to back need the previous one gone —
  // auto-cleanup only runs between tests.
  cleanup();
  render(<>{rendered as ReactNode}</>);
}

describe("reviews inbox columns — Pending tab action sets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("gives a row assigned directly to the viewer the three decision actions", () => {
    renderCell(pendingColumns(), "actions", row());

    expect(
      screen.getByTestId("reviews-inbox-approve-rr-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("reviews-inbox-request-changes-rr-1")
    ).toBeInTheDocument();
    expect(screen.getByTestId("reviews-inbox-reject-rr-1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("reviews-inbox-cancel-rr-1")
    ).not.toBeInTheDocument();
  });

  it("treats a role the viewer holds as an assignment, not a request", () => {
    renderCell(
      pendingColumns([9]),
      "actions",
      row({
        assigneeUserId: null,
        assigneeUser: null,
        assigneeRoleId: 9,
        assigneeRole: { id: 9, name: "QA Lead" },
      } as Partial<InboxTableRow>)
    );

    expect(
      screen.getByTestId("reviews-inbox-approve-rr-1")
    ).toBeInTheDocument();
  });

  it("gives a row the viewer requested only Send reminder + Cancel", () => {
    renderCell(
      pendingColumns(),
      "actions",
      row({
        requestedByUserId: VIEWER_ID,
        assigneeUserId: "user-other",
        assigneeUser: { id: "user-other", name: "Otto", image: null },
      } as Partial<InboxTableRow>)
    );

    expect(screen.getByTestId("reviews-inbox-nudge-rr-1")).toBeInTheDocument();
    expect(screen.getByTestId("reviews-inbox-cancel-rr-1")).toBeInTheDocument();
    // Nothing here decides the review — the server would reject it anyway.
    expect(
      screen.queryByTestId("reviews-inbox-approve-rr-1")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("reviews-inbox-reject-rr-1")
    ).not.toBeInTheDocument();
  });

  it("passes lastRemindedAt through so the reminder button can honor its cooldown", () => {
    const remindedAt = new Date("2026-08-19T12:00:00Z");
    renderCell(
      pendingColumns(),
      "actions",
      row({
        requestedByUserId: VIEWER_ID,
        assigneeUserId: "user-other",
        lastRemindedAt: remindedAt,
      } as Partial<InboxTableRow>)
    );

    expect(screen.getByTestId("reviews-inbox-nudge-rr-1")).toHaveAttribute(
      "data-last-reminded-at",
      String(remindedAt)
    );
  });

  it("prefers the decision cluster when the viewer both requested the review and holds the assigned role", () => {
    renderCell(
      pendingColumns([9]),
      "actions",
      row({
        requestedByUserId: VIEWER_ID,
        assigneeUserId: null,
        assigneeUser: null,
        assigneeRoleId: 9,
        assigneeRole: { id: 9, name: "QA Lead" },
      } as Partial<InboxTableRow>)
    );

    // Deciding resolves the row outright; cancel stays reachable from the
    // entity's own review banner.
    expect(
      screen.getByTestId("reviews-inbox-approve-rr-1")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("reviews-inbox-cancel-rr-1")
    ).not.toBeInTheDocument();
  });

  it("renders nothing for a row the viewer neither owns nor is assigned", () => {
    const columns = pendingColumns();
    const column = columns.find((c) => c.id === "actions");
    const rendered = (column!.cell as (ctx: never) => unknown)({
      row: {
        original: row({
          requestedByUserId: "user-other",
          assigneeUserId: "user-third",
        } as Partial<InboxTableRow>),
      },
    } as never);
    expect(rendered).toBeNull();
  });
});

describe("reviews inbox columns — Assignee column", () => {
  it("is present on Pending and absent on Decided", () => {
    expect(pendingColumns().some((c) => c.id === "assignee")).toBe(true);

    const { result } = renderHook(() =>
      useColumns({
        t,
        view: "decided",
        viewerUserId: VIEWER_ID,
        viewerRoleIds: [],
        caseById: new Map(),
        testRunById: new Map(),
        sessionById: new Map(),
      })
    );
    expect(
      (result.current as ColumnDef<InboxTableRow>[]).some(
        (c) => c.id === "assignee"
      )
    ).toBe(false);
  });

  it("renders the user for a direct assignee and the role chip for a role assignee", () => {
    renderCell(pendingColumns(), "assignee", row());
    expect(screen.getByTestId("user-name-cell")).toHaveTextContent(VIEWER_ID);

    renderCell(
      pendingColumns(),
      "assignee",
      row({
        assigneeUserId: null,
        assigneeUser: null,
        assigneeRoleId: 9,
        assigneeRole: { id: 9, name: "QA Lead" },
      } as Partial<InboxTableRow>)
    );
    expect(screen.getByTestId("role-assignee-chip")).toHaveTextContent(
      "QA Lead"
    );
  });
});
