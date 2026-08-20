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
  mockFindFirstProjectIntegration,
  mockSearchIssuesDialog,
} = vi.hoisted(() => {
  return {
    mockCreateMilestoneIssue: vi.fn(),
    mockDeleteMilestoneIssue: vi.fn(),
    mockUpsertIssue: vi.fn(),
    mockFindFirstProjectIntegration: vi.fn(
      (..._args: any[]) => ({ data: undefined }) as any
    ),
    mockSearchIssuesDialog: vi.fn(),
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
    projectIntegration: {
      useFindFirst: (...args: any[]) =>
        mockFindFirstProjectIntegration(...args),
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
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("./search-issues-dialog", () => ({
  SearchIssuesDialog: (props: any) => {
    mockSearchIssuesDialog(props);
    const { open, onIssueSelected } = props;
    if (!open) return null;
    return (
      <div data-testid="search-issues-dialog-stub">
        <button
          type="button"
          onClick={() =>
            onIssueSelected({
              isExternal: false,
              id: 55,
              name: "PROJ-1",
              title: "Existing internal issue",
            })
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
    mockFindFirstProjectIntegration.mockReturnValue({ data: undefined });
    mockCreateMilestoneIssue.mockReset();
    mockDeleteMilestoneIssue.mockReset();
    mockUpsertIssue.mockReset();
    mockSearchIssuesDialog.mockReset();
    mockCreateMilestoneIssue.mockResolvedValue({});
    mockDeleteMilestoneIssue.mockResolvedValue({});
    mockUpsertIssue.mockResolvedValue({ id: 999 });
  });

  it("renders SearchIssuesDialog with includeRequirements set true — milestone membership is the one surface that legitimately wants both row kinds", () => {
    renderWithQueryClient(
      <MilestoneIssueManager
        milestoneId={42}
        projectId={7}
        integrationId={3}
        linkedIssueIds={[]}
      />
    );

    fireEvent.click(screen.getByTestId("member-issues-add-button"));

    const lastCall = mockSearchIssuesDialog.mock.calls.at(-1)?.[0];
    expect(lastCall?.includeRequirements).toBe(true);
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

  it("links an external issue on a LOCAL milestone by resolving the project's active integration", async () => {
    // The 8.14 regression: a local milestone has no integrationId of its
    // own, but the project's active integration must be used as fallback.
    mockFindFirstProjectIntegration.mockReturnValue({
      data: { integrationId: 9 },
    });
    mockUpsertIssue.mockResolvedValue({ id: 77 });
    mockCreateMilestoneIssue.mockResolvedValue({});

    renderWithQueryClient(
      <MilestoneIssueManager
        milestoneId={348}
        projectId={370}
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
              integrationId: 9,
            },
          },
        })
      );
    });
    expect(mockCreateMilestoneIssue).toHaveBeenCalledWith({
      data: { milestoneId: 348, issueId: 77, source: "MANUAL" },
    });
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

  it("offers no Remove for a SYNCED row (Jira-managed) — no menu, no delete", () => {
    renderWithQueryClient(
      <MemberIssueRowActions milestoneId={42} issueId={55} source="SYNCED" />
    );

    // With no generate access there's no action at all for a synced row; the
    // Source column already conveys its Jira-managed origin.
    expect(
      screen.queryByTestId("member-issue-row-actions")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("member-issue-unlink")).not.toBeInTheDocument();
    expect(mockDeleteMilestoneIssue).not.toHaveBeenCalled();
  });

  it("hides the Generate icon by default (canGenerate defaults false)", () => {
    renderWithQueryClient(
      <MemberIssueRowActions milestoneId={42} issueId={55} source="MANUAL" />
    );
    expect(
      screen.queryByTestId("member-issue-generate-cases")
    ).not.toBeInTheDocument();
  });

  it("offers Generate above Remove in the menu and fires onGenerate (MANUAL row)", () => {
    const onGenerate = vi.fn();
    renderWithQueryClient(
      <MemberIssueRowActions
        milestoneId={42}
        issueId={55}
        source="MANUAL"
        canGenerate
        onGenerate={onGenerate}
      />
    );
    // Both actions share the single 3-dot menu, Generate stacked above Remove.
    const items = screen.getAllByRole("menuitem");
    expect(items[0]).toHaveAttribute(
      "data-testid",
      "member-issue-generate-cases"
    );
    expect(items[1]).toHaveAttribute("data-testid", "member-issue-unlink");
    fireEvent.click(screen.getByTestId("member-issue-generate-cases"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("offers Generate (but no Remove) for a SYNCED row when eligible", () => {
    const onGenerate = vi.fn();
    renderWithQueryClient(
      <MemberIssueRowActions
        milestoneId={42}
        issueId={55}
        source="SYNCED"
        canGenerate
        onGenerate={onGenerate}
      />
    );
    // Generate is available on synced rows; Remove is not (Jira-managed).
    expect(screen.queryByTestId("member-issue-unlink")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("member-issue-generate-cases"));
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("hides the unlink action when canUnlink is false but still offers Generate", () => {
    renderWithQueryClient(
      <MemberIssueRowActions
        milestoneId={42}
        issueId={55}
        source="MANUAL"
        canUnlink={false}
        canGenerate
        onGenerate={vi.fn()}
      />
    );
    // Repository-only viewer: the 3-dot menu renders (it carries Generate) but
    // offers no Remove item.
    expect(
      screen.getByTestId("member-issue-generate-cases")
    ).toBeInTheDocument();
    expect(screen.getByTestId("member-issue-row-actions")).toBeInTheDocument();
    expect(screen.queryByTestId("member-issue-unlink")).not.toBeInTheDocument();
  });
});
