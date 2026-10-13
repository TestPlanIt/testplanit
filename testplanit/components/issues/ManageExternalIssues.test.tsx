import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { useEffect, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { planCaseIssueLinkWrite } from "~/utils/caseIssueLinkWrite";

vi.mock("~/lib/navigation", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("./search-issues-dialog", () => ({
  SearchIssuesDialog: () => null,
}));

import { ManageExternalIssues } from "./ManageExternalIssues";

// A test case in a project with an active GitHub tracker, linked to both a
// native requirement (no integration — linked from the requirements surface)
// and a defect synced from that tracker.
const CASE_ID = 42;
const REQUIREMENT_ID = 501;
const SYNCED_DEFECT_ID = 700;

const syncedDefect = {
  id: SYNCED_DEFECT_ID,
  key: "PROJ-12",
  summary: "Login throws on empty password",
  externalId: "10012",
  url: "https://example.test/browse/PROJ-12",
};

// The Issue rows behind those links, as the case query sees them.
const issueRows: Record<number, { id: number; integrationId: number | null }> =
  {
    [REQUIREMENT_ID]: { id: REQUIREMENT_ID, integrationId: null },
    [SYNCED_DEFECT_ID]: { id: SYNCED_DEFECT_ID, integrationId: 9 },
  };

/**
 * Stands in for the case's RepositoryCaseIssue rows. Assertions read this —
 * the links that survive a save, not the calls that moved them.
 */
let caseIssueRows: Set<number>;

const survivingLinks = () => [...caseIssueRows].sort((a, b) => a - b);

/**
 * The case-detail surface in miniature: the `issues` form value seeded from
 * the case's links, the tracker picker that owns that value, the Linked
 * Requirements panel (which commits its unlinks straight to the server and
 * never touches the form), and the save that replaces the join rows.
 */
function CaseDetailHarness({ seed }: { seed?: number[] } = {}) {
  // TestCaseDetailsView seeds the form's `issues` value from every link on
  // the case, requirement links included.
  const [issueIds, setIssueIds] = useState<number[]>(
    () => seed ?? survivingLinks()
  );
  // How many times the form field has been written. A form nobody edited must
  // stay pristine — every write here marks `issues` dirty for the whole page.
  // Starts at -1 so the mount pass lands on 0 and only real writes count.
  const [writeCount, setWriteCount] = useState(-1);
  useEffect(() => {
    setWriteCount((count) => count + 1);
  }, [issueIds]);

  const unlinkRequirementOutOfBand = () => {
    // LinkedRequirementsPanel posts to /api/issues/[id]/unlink, which deletes
    // the join row immediately. The case form is not involved.
    caseIssueRows.delete(REQUIREMENT_ID);
  };

  const saveCase = () => {
    const existingLinks = survivingLinks().map((id) => ({
      issue: issueRows[id],
    }));
    const { preservedIssueIds, linkedIssueIds } = planCaseIssueLinkWrite(
      existingLinks,
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
      <div data-testid="form-issues-writes">{writeCount}</div>
      <button type="button" onClick={unlinkRequirementOutOfBand}>
        unlink-requirement
      </button>
      <button type="button" onClick={saveCase}>
        save-case
      </button>
      <ManageExternalIssues
        testCaseId={CASE_ID}
        projectId={7}
        projectIntegrationId={3}
        integrationId={9}
        provider="GITHUB"
        linkedIssueIds={issueIds}
        setLinkedIssueIds={setIssueIds}
        entityType="testCase"
      />
    </>
  );
}

const formIssueIds = (): number[] =>
  JSON.parse(screen.getByTestId("form-issues").textContent || "[]");

describe("ManageExternalIssues and the case save it feeds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    caseIssueRows = new Set([REQUIREMENT_ID, SYNCED_DEFECT_ID]);
    // Stands in for /api/integrations/jira/link-issue, whose reads are scoped
    // server-side to issues owned by an ACTIVE issue-tracking integration: the
    // requirement is linked to the case but is never in any response here.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === "DELETE") {
          caseIssueRows.delete(SYNCED_DEFECT_ID);
          return { ok: true, json: async () => ({ success: true }) } as any;
        }
        const linkedIssues = caseIssueRows.has(SYNCED_DEFECT_ID)
          ? [syncedDefect]
          : [];
        return {
          ok: true,
          json: async () => ({ success: true, linkedIssues }),
        } as any;
      })
    );
  });

  it("keeps a requirement link the user never touched across a case save", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await screen.findByText(/PROJ-12/);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([REQUIREMENT_ID, SYNCED_DEFECT_ID]);
  });

  it("leaves a requirement unlinked from the requirements panel unlinked after a case save", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await screen.findByText(/PROJ-12/);

    await user.click(screen.getByText("unlink-requirement"));
    expect(survivingLinks()).toEqual([SYNCED_DEFECT_ID]);

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([SYNCED_DEFECT_ID]);
  });

  it("drops a tracker link the user unlinked in the picker", async () => {
    const user = userEvent.setup();
    render(<CaseDetailHarness />);

    await screen.findByText(/PROJ-12/);

    await user.click(screen.getByLabelText(/removeIssue/i));
    await waitFor(() => {
      expect(screen.queryByText(/PROJ-12/)).not.toBeInTheDocument();
    });

    await user.click(screen.getByText("save-case"));

    expect(survivingLinks()).toEqual([REQUIREMENT_ID]);
  });

  it("settles on a stable form value instead of refetching forever", async () => {
    render(<CaseDetailHarness />);

    await screen.findByText(/PROJ-12/);
    await waitFor(() => {
      expect(formIssueIds()).toContain(SYNCED_DEFECT_ID);
    });

    // Hold long enough for the prop-sync effect to settle; a value that keeps
    // changing identity would refetch forever.
    const callsAfterLoad = (globalThis.fetch as any).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect((globalThis.fetch as any).mock.calls.length).toBe(callsAfterLoad);
  });

  it("leaves the form value untouched when it already holds exactly the tracker links", async () => {
    // The case's only link is the tracker's, so loading agrees with the value
    // the form already has. Rewriting it anyway marks `issues` dirty and the
    // page reports unsaved changes on a form nobody edited.
    caseIssueRows = new Set([SYNCED_DEFECT_ID]);
    render(<CaseDetailHarness seed={[SYNCED_DEFECT_ID]} />);

    await screen.findByText(/PROJ-12/);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(formIssueIds()).toEqual([SYNCED_DEFECT_ID]);
    expect(screen.getByTestId("form-issues-writes").textContent).toBe("0");
  });
});
