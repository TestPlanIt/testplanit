import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MemberIssueRowActions,
  MilestoneIssueManager,
} from "./MilestoneIssueManager";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

function renderWithQueryClient(ui: React.ReactElement) {
  const testQueryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={testQueryClient}>{ui}</QueryClientProvider>
  );
}

// --- Stable mock refs via vi.hoisted() ---
const {
  mockCreateMilestoneIssue,
  mockDeleteMilestoneIssue,
  mockUpsertIssue,
} = vi.hoisted(() => {
  return {
    mockCreateMilestoneIssue: vi.fn(),
    mockDeleteMilestoneIssue: vi.fn(),
    mockUpsertIssue: vi.fn(),
  };
});

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestoneIssue: {
      useCreate: () => ({ mutateAsync: mockCreateMilestoneIssue }),
      useDelete: () => ({ mutateAsync: mockDeleteMilestoneIssue }),
    },
    issue: {
      useUpsert: () => ({ mutateAsync: mockUpsertIssue }),
    },
  }),
}));

vi.mock("~/zenstack/schema", () => ({ schema: {} }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// Mock DropdownMenu — render items always visible, bypassing Radix's portal
// + open-state animation timing (mirrors MilestoneItemCard.test.tsx).
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled, ...props }: any) => (
    <div
      role="menuitem"
      aria-disabled={disabled}
      onClick={() => !disabled && onClick?.()}
      {...props}
    >
      {children}
    </div>
  ),
}));

// SearchIssuesDialog pulls in a large tree of ZenStack-hook-driven search UI
// that isn't relevant to this component's own create/delete wiring — stub it
// down to a trigger that lets the test simulate an issue selection.
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children, open }: any) =>
    open ? <div data-testid="alert-dialog">{children}</div> : null,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  AlertDialogAction: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>{children}</button>
  ),
}));

vi.mock("./search-issues-dialog", () => ({
  SearchIssuesDialog: ({ open, onIssueSelected }: any) => {
    if (!open) return null;
    return (
      <div data-testid="search-issues-dialog-stub">
        <button
          type="button"
          onClick={() =>
            onIssueSelected({ isExternal: false, id: 55, name: "PROJ-1", title: "Existing internal issue" })
          }
          data-testid="select-internal-issue"
        >
          select-internal
        </button>
        <button
          type="button"
          onClick={() =>
            onIssueSelected({
              isExternal: true,
              id: "ext-1",
              key: "PROJ-2",
              externalKey: "PROJ-2",
              externalId: "10002",
              title: "External issue",
              status: "To Do",
            })
          }
          data-testid="select-external-issue"
        >
          select-external
        </button>
      </div>
    );
  },
}));

describe("MilestoneIssueManager", () => {
  beforeEach(() => {
    mockCreateMilestoneIssue.mockReset();
    mockDeleteMilestoneIssue.mockReset();
    mockUpsertIssue.mockReset();
    mockCreateMilestoneIssue.mockResolvedValue({});
    mockDeleteMilestoneIssue.mockResolvedValue({});
    mockUpsertIssue.mockResolvedValue({ id: 999 });
  });

  it("creates a MANUAL MilestoneIssue row via milestoneIssue.useCreate when linking an existing internal issue", async () => {
    renderWithQueryClient(
      <MilestoneIssueManager
        milestoneId={42}
        projectId={7}
        integrationId={3}
        linkedIssueIds={[]}
      />
    );

    fireEvent.click(screen.getByTestId("member-issues-add-button"));
    fireEvent.click(screen.getByTestId("select-internal-issue"));

    await waitFor(() => {
      expect(mockCreateMilestoneIssue).toHaveBeenCalledWith({
        data: { milestoneId: 42, issueId: 55, source: "MANUAL" },
      });
    });
    // Internal issue already has an Issue row — no upsert call needed.
    expect(mockUpsertIssue).not.toHaveBeenCalled();
  });

  it("resolves an external issue via issue.useUpsert (externalId_integrationId) before linking", async () => {
    renderWithQueryClient(
      <MilestoneIssueManager
        milestoneId={42}
        projectId={7}
        integrationId={3}
        linkedIssueIds={[]}
      />
    );

    fireEvent.click(screen.getByTestId("member-issues-add-button"));
    fireEvent.click(screen.getByTestId("select-external-issue"));

    await waitFor(() => {
      expect(mockUpsertIssue).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            externalId_integrationId: {
              externalId: "10002",
              integrationId: 3,
            },
          },
        })
      );
    });
    await waitFor(() => {
      expect(mockCreateMilestoneIssue).toHaveBeenCalledWith({
        data: { milestoneId: 42, issueId: 999, source: "MANUAL" },
      });
    });
  });
});

describe("MemberIssueRowActions", () => {
  beforeEach(() => {
    mockCreateMilestoneIssue.mockReset();
    mockDeleteMilestoneIssue.mockReset();
    mockDeleteMilestoneIssue.mockResolvedValue({});
  });

  it("deletes a MANUAL row via milestoneIssue.useDelete keyed on milestoneId_issueId", async () => {
    renderWithQueryClient(
      <MemberIssueRowActions milestoneId={42} issueId={55} source="MANUAL" />
    );

    fireEvent.click(screen.getByTestId("member-issue-unlink"));

    // Unlink is gated behind a confirmation dialog — nothing deleted yet.
    expect(mockDeleteMilestoneIssue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("member-issue-unlink-confirm"));

    await waitFor(() => {
      expect(mockDeleteMilestoneIssue).toHaveBeenCalledWith({
        where: { milestoneId_issueId: { milestoneId: 42, issueId: 55 } },
      });
    });
  });

  it("cancelling the confirmation leaves the link intact", async () => {
    renderWithQueryClient(
      <MemberIssueRowActions milestoneId={42} issueId={55} source="MANUAL" />
    );

    fireEvent.click(screen.getByTestId("member-issue-unlink"));
    fireEvent.click(screen.getByTestId("member-issue-unlink-cancel"));

    expect(mockDeleteMilestoneIssue).not.toHaveBeenCalled();
  });

  it("does NOT call delete for a SYNCED row — shows the managed-by-Jira lock instead", () => {
    renderWithQueryClient(
      <MemberIssueRowActions milestoneId={42} issueId={55} source="SYNCED" />
    );

    expect(screen.getByTestId("member-issue-synced-lock")).toBeInTheDocument();
    expect(screen.queryByTestId("member-issue-row-actions")).not.toBeInTheDocument();
    expect(mockDeleteMilestoneIssue).not.toHaveBeenCalled();
  });
});
