import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  pickerOwnedIssueIds,
  planCaseIssueLinkWrite,
} from "~/utils/caseIssueLinkWrite";

const { mockUseFindFirstProjects, mockUseFindManyIssue, mockUseUpsertIssue } =
  vi.hoisted(() => ({
    mockUseFindFirstProjects: vi.fn(),
    mockUseFindManyIssue: vi.fn(),
    mockUseUpsertIssue: vi.fn(),
  }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    projects: { useFindFirst: mockUseFindFirstProjects },
    issue: { useFindMany: mockUseFindManyIssue, useUpsert: mockUseUpsertIssue },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key.split(".").pop() ?? key,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// Neither renderer under test here; stubbed so this file's import graph stays
// on the two branches it exercises.
vi.mock("@/components/issues/ManageExternalIssues", () => ({
  ManageExternalIssues: () => <div data-testid="manage-external-issues" />,
}));

vi.mock("@/components/issues/DeferredIssueManager", () => ({
  DeferredIssueManager: () => <div data-testid="deferred-issue-manager" />,
}));

vi.mock("@/components/tables/IssuesDisplay", () => ({
  IssuesDisplay: ({ id }: any) => <span data-testid={`issue-${id}`}>{id}</span>,
}));

// The link-existing picker, whose options are scoped to the integration's own
// issues: selecting one hands ManageSimpleUrlIssues a row it can express.
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({ onValueChange }: any) => (
    <button
      type="button"
      onClick={() => onValueChange({ id: 800, name: "BUG-99", title: null })}
    >
      pick-issue
    </button>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

import { UnifiedIssueManager } from "@/components/issues/UnifiedIssueManager";

// A test case linked to a native requirement (no integration behind it —
// linked from the requirements surfaces) and to one issue the project's own
// Issues field can express.
const CASE_ID = 42;
const PROJECT_ID = 7;
const INTEGRATION_ID = 20;
const REQUIREMENT_ID = 501;
const FIELD_ISSUE_ID = 700;
const NEWLY_PICKED_ISSUE_ID = 800;

interface IssueRow {
  id: number;
  integrationId: number | null;
  isRequirement: boolean;
  name: string;
  externalId: string | null;
  title: string;
}

const issueRows: Record<number, IssueRow> = {
  [REQUIREMENT_ID]: {
    id: REQUIREMENT_ID,
    integrationId: null,
    isRequirement: true,
    name: "REQ-3",
    externalId: null,
    title: "Password reset must expire in 15 minutes",
  },
  [FIELD_ISSUE_ID]: {
    id: FIELD_ISSUE_ID,
    integrationId: INTEGRATION_ID,
    isRequirement: false,
    name: "BUG-12",
    externalId: "BUG-12",
    title: "Login throws on empty password",
  },
  [NEWLY_PICKED_ISSUE_ID]: {
    id: NEWLY_PICKED_ISSUE_ID,
    integrationId: INTEGRATION_ID,
    isRequirement: false,
    name: "BUG-99",
    externalId: "BUG-99",
    title: "Session survives logout",
  },
};

/**
 * Stands in for the case's RepositoryCaseIssue rows. Assertions read this —
 * the links that survive a save, not the calls that moved them.
 */
let caseIssueRows: Set<number>;

const survivingLinks = () => [...caseIssueRows].sort((a, b) => a - b);

const caseIssuesFromDb = () =>
  survivingLinks().map((id) => ({ issue: issueRows[id] }));

/**
 * TestCaseDetailsView's `issues` default value, seeded once from the case's
 * links and thereafter preserved across the query's refetches.
 */
const seedIssuesFormValue = (): number[] =>
  pickerOwnedIssueIds(caseIssuesFromDb());

/**
 * The case-detail surface in miniature: the `issues` form value seeded from
 * the case's links, whichever Issues field the project's integration selects,
 * the Linked Requirements panel (which commits its unlinks straight to the
 * server and never touches the form), and the save that replaces the join
 * rows.
 */
function CaseDetailHarness({
  staleCaseQuery = false,
}: { staleCaseQuery?: boolean } = {}) {
  const [issueIds, setIssueIds] = useState<number[]>(seedIssuesFormValue);
  // The links as the case query saw them at page load. Unlinking invalidates
  // that query, but the save reads whatever is in hand — so `staleCaseQuery`
  // is the race where the user saves before the refetch lands.
  const [linksAtLoad] = useState(caseIssuesFromDb);

  const unlinkRequirementOutOfBand = () => {
    // LinkedRequirementsPanel posts to /api/issues/[id]/unlink, which deletes
    // the join row immediately. The case form is not involved.
    caseIssueRows.delete(REQUIREMENT_ID);
  };

  const saveCase = () => {
    const { preservedIssueIds, linkedIssueIds } = planCaseIssueLinkWrite(
      staleCaseQuery ? linksAtLoad : caseIssuesFromDb(),
      issueIds
    );
    // deleteMany({ caseId, issueId: { notIn: preservedIssueIds } })
    for (const id of survivingLinks()) {
      if (!preservedIssueIds.includes(id)) caseIssueRows.delete(id);
    }
    // createMany({ data: linkedIssueIds, skipDuplicates: true })
    for (const id of linkedIssueIds) caseIssueRows.add(id);
  };

  return (
    <>
      <div data-testid="form-issues">{JSON.stringify(issueIds)}</div>
      <button type="button" onClick={unlinkRequirementOutOfBand}>
        unlink-requirement
      </button>
      <button type="button" onClick={saveCase}>
        save-case
      </button>
      <UnifiedIssueManager
        projectId={PROJECT_ID}
        entityType="testCase"
        entityId={CASE_ID}
        linkedIssueIds={issueIds}
        setLinkedIssueIds={setIssueIds}
      />
    </>
  );
}

function useSimpleUrlProject() {
  mockUseFindFirstProjects.mockReturnValue({
    data: {
      projectIntegrations: [
        {
          id: 10,
          isActive: true,
          integration: {
            id: INTEGRATION_ID,
            name: "Simple Links",
            provider: "SIMPLE_URL",
            settings: { baseUrl: "https://tracker.test/issues/{issueId}" },
          },
        },
      ],
    },
    isLoading: false,
  });
}

function useProjectWithoutIssueTracking() {
  mockUseFindFirstProjects.mockReturnValue({
    data: { projectIntegrations: [] },
    isLoading: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  caseIssueRows = new Set([REQUIREMENT_ID, FIELD_ISSUE_ID]);
  // ManageSimpleUrlIssues renders whatever the form value names, so this
  // follows the value rather than returning a fixed list.
  mockUseFindManyIssue.mockImplementation((args: any) => ({
    data: ((args?.where?.id?.in as number[]) ?? [])
      .map((id) => issueRows[id])
      .filter(Boolean),
    refetch: vi.fn(),
  }));
  mockUseUpsertIssue.mockReturnValue({ mutateAsync: vi.fn() });
});

describe("a case save in a project whose tracker is a simple-url integration", () => {
  beforeEach(useSimpleUrlProject);

  it("keeps a requirement link the user never touched", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await screen.findByTestId(`issue-${FIELD_ISSUE_ID}`);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([REQUIREMENT_ID, FIELD_ISSUE_ID]);
  });

  it("leaves a requirement unlinked from the requirements panel unlinked", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await screen.findByTestId(`issue-${FIELD_ISSUE_ID}`);

    await user.click(screen.getByText("unlink-requirement"));
    expect(survivingLinks()).toEqual([FIELD_ISSUE_ID]);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([FIELD_ISSUE_ID]);
  });

  it("leaves it unlinked even when the case query has not caught up", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness staleCaseQuery />);

    await screen.findByTestId(`issue-${FIELD_ISSUE_ID}`);

    await user.click(screen.getByText("unlink-requirement"));
    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([FIELD_ISSUE_ID]);
  });

  it("drops a link the user removed in the Issues field", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    const badge = (await screen.findByTestId(`issue-${FIELD_ISSUE_ID}`))
      .parentElement as HTMLElement;

    await user.click(within(badge).getByRole("button", { name: /remove/i }));
    await waitFor(() => {
      expect(
        screen.queryByTestId(`issue-${FIELD_ISSUE_ID}`)
      ).not.toBeInTheDocument();
    });

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([REQUIREMENT_ID]);
  });

  it("creates a link the user added in the Issues field", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await screen.findByTestId(`issue-${FIELD_ISSUE_ID}`);

    await user.click(screen.getByRole("button", { name: /linkIssue/i }));
    await user.click(screen.getByRole("button", { name: "pick-issue" }));
    await user.click(screen.getByRole("button", { name: "add" }));

    await screen.findByTestId(`issue-${NEWLY_PICKED_ISSUE_ID}`);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([
      REQUIREMENT_ID,
      FIELD_ISSUE_ID,
      NEWLY_PICKED_ISSUE_ID,
    ]);
  });

  it("shows only the issues its own picker could link", async () => {
    render(<CaseDetailHarness />);

    await screen.findByTestId(`issue-${FIELD_ISSUE_ID}`);
    expect(screen.queryByTestId(`issue-${REQUIREMENT_ID}`)).toBeNull();
  });
});

describe("a case save in a project with no issue tracking configured", () => {
  beforeEach(useProjectWithoutIssueTracking);

  it("renders the not-configured alert instead of any Issues picker", () => {
    render(<CaseDetailHarness />);

    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByTestId("manage-external-issues")).toBeNull();
    expect(screen.queryByTestId("deferred-issue-manager")).toBeNull();
  });

  it("keeps a requirement link the user never touched", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([REQUIREMENT_ID, FIELD_ISSUE_ID]);
  });

  it("leaves a requirement unlinked from the requirements panel unlinked", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await user.click(screen.getByText("unlink-requirement"));
    expect(survivingLinks()).toEqual([FIELD_ISSUE_ID]);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([FIELD_ISSUE_ID]);
  });
});
