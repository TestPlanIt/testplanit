import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockListAction = vi.fn();
const mockReEmitAction = vi.fn();
vi.mock("~/app/actions/scimConflictLogActions", () => ({
  listScimConflictsAction: (...args: unknown[]) => mockListAction(...args),
  reEmitScimMemberEventAction: (...args: unknown[]) =>
    mockReEmitAction(...args),
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

import { ConflictLogTable } from "./ConflictLogTable";

function makeRow(id: string, metadata: Record<string, unknown>) {
  return {
    id,
    userId: null,
    userEmail: null,
    userName: null,
    action: "UPDATE",
    entityType: "Groups",
    entityId: "42",
    entityName: null,
    changes: null,
    metadata,
    timestamp: new Date("2026-06-01T12:00:00Z"),
    projectId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListAction.mockReset();
  mockReEmitAction.mockReset();
  mockToastSuccess.mockReset();
  mockToastError.mockReset();
});

describe("ConflictLogTable", () => {
  test("T1: renders empty state when items length is 0", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [],
      hasMore: false,
    });

    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-empty")).toBeInTheDocument();
    });
  });

  test("T2: renders type label for each conflict-type row", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [
        makeRow("a1", { source: "scim", scimLinked: true }),
        makeRow("a2", { source: "scim", scimResurrected: true }),
        makeRow("a3", {
          source: "scim",
          scimSkippedMemberIds: ["u1"],
        }),
        makeRow("a4", {
          source: "scim",
          scimDisplayNameOverwrote: true,
        }),
        makeRow("a5", { source: "scim", scimReEmittedBy: "admin1" }),
      ],
      hasMore: false,
    });

    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-type-a1")).toHaveTextContent(
        /typeLinked/
      );
    });
    expect(screen.getByTestId("scim-conflict-type-a2")).toHaveTextContent(
      /typeResurrected/
    );
    expect(screen.getByTestId("scim-conflict-type-a3")).toHaveTextContent(
      /typeSkippedMembers/
    );
    expect(screen.getByTestId("scim-conflict-type-a4")).toHaveTextContent(
      /typeDisplayNameOverwrote/
    );
    expect(screen.getByTestId("scim-conflict-type-a5")).toHaveTextContent(
      /typeReEmitted/
    );
  });

  test("T3: View payload opens the dialog with the row metadata", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [
        makeRow("a1", {
          source: "scim",
          scimLinked: true,
          customField: "hello",
        }),
      ],
      hasMore: false,
    });

    const user = userEvent.setup();
    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-view-a1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("scim-conflict-view-a1"));

    const payloadPre = await screen.findByTestId("scim-conflict-payload");
    expect(payloadPre).toBeVisible();
    expect(payloadPre).toHaveTextContent(/scimLinked/);
    expect(payloadPre).toHaveTextContent(/customField/);
  });

  test("T4: Re-emit button renders for scimSkippedMemberIds rows", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [
        makeRow("a1", { source: "scim", scimLinked: true }),
        makeRow("a2", {
          source: "scim",
          scimSkippedMemberIds: ["u1", "u2"],
        }),
      ],
      hasMore: false,
    });

    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-reemit-a2")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("scim-conflict-reemit-a1")
    ).not.toBeInTheDocument();
  });

  test("T5: Re-emit button is suppressed once row is stamped scimReEmittedBy", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [
        makeRow("a1", {
          source: "scim",
          scimSkippedMemberIds: ["u1"],
          scimReEmittedBy: "admin1",
        }),
      ],
      hasMore: false,
    });

    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-view-a1")).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId("scim-conflict-reemit-a1")
    ).not.toBeInTheDocument();
  });

  test("T6: Re-emit click opens confirm; confirming fires the action + success toast", async () => {
    mockListAction.mockResolvedValue({
      success: true,
      items: [
        makeRow("a1", {
          source: "scim",
          scimSkippedMemberIds: ["u1"],
        }),
      ],
      hasMore: false,
    });
    mockReEmitAction.mockResolvedValueOnce({
      success: true,
      newAuditLogId: "new-1",
      emittedMembers: ["u1"],
    });

    const user = userEvent.setup();
    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-reemit-a1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("scim-conflict-reemit-a1"));

    const confirmBtn = await screen.findByTestId(
      "scim-conflict-reemit-confirm"
    );
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockReEmitAction).toHaveBeenCalledWith("a1");
    });
    expect(mockToastSuccess).toHaveBeenCalled();
  });

  test("T7: Re-emit failure surfaces toast.error", async () => {
    mockListAction.mockResolvedValue({
      success: true,
      items: [
        makeRow("a1", {
          source: "scim",
          scimSkippedMemberIds: ["u1"],
        }),
      ],
      hasMore: false,
    });
    mockReEmitAction.mockResolvedValueOnce({
      success: false,
      error: "Re-emit failed",
    });

    const user = userEvent.setup();
    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-reemit-a1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("scim-conflict-reemit-a1"));
    await user.click(await screen.findByTestId("scim-conflict-reemit-confirm"));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  test("T8: Next calls listScimConflictsAction with the last row's cursor", async () => {
    mockListAction
      .mockResolvedValueOnce({
        success: true,
        items: [
          makeRow("a1", { source: "scim", scimLinked: true }),
          makeRow("a2", { source: "scim", scimLinked: true }),
        ],
        hasMore: true,
      })
      .mockResolvedValueOnce({
        success: true,
        items: [makeRow("a3", { source: "scim", scimLinked: true })],
        hasMore: false,
      });

    const user = userEvent.setup();
    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-row-a2")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("scim-conflict-next"));

    await waitFor(() => {
      expect(mockListAction).toHaveBeenCalledTimes(2);
    });
    const secondCall = mockListAction.mock.calls[1][0];
    expect(secondCall.cursor).toMatchObject({ id: "a2" });
  });

  test("T9: Next is disabled when hasMore is false", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [makeRow("a1", { source: "scim", scimLinked: true })],
      hasMore: false,
    });

    render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-row-a1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("scim-conflict-next")).toBeDisabled();
  });

  test("T10: ViewPayloadDialog renders metadata via <pre> text content (no innerHTML markup leak)", async () => {
    mockListAction.mockResolvedValueOnce({
      success: true,
      items: [
        makeRow("a1", {
          source: "scim",
          // Try to inject an attacker-controlled <script> tag — React must
          // render it as escaped text inside the <pre>, not as a real node.
          payload: "<script>alert('xss')</script>",
        }),
      ],
      hasMore: false,
    });

    const user = userEvent.setup();
    const { container } = render(<ConflictLogTable />);

    await waitFor(() => {
      expect(screen.getByTestId("scim-conflict-view-a1")).toBeInTheDocument();
    });
    await user.click(screen.getByTestId("scim-conflict-view-a1"));

    const pre = await screen.findByTestId("scim-conflict-payload");
    // No actual <script> child element in the DOM — the payload is text.
    expect(within(pre).queryByText("alert", { selector: "script" })).toBeNull();
    // The literal escaped form appears in the textContent.
    expect(pre.textContent).toContain("<script>alert('xss')</script>");
    // Defense-in-depth: confirm the rendered container has no <script>.
    expect(container.querySelector("script")).toBeNull();
  });
});
