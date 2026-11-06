import { render, renderHook } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { useDrillDownColumns } from "./useDrillDownColumns";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

vi.mock("~/lib/navigation", () => ({
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// The hook only wires these into cells; their own rendering is not under test.
vi.mock("~/components/ConfigurationNameDisplay", () => ({
  ConfigurationNameDisplay: () => null,
}));
vi.mock("~/components/IssuePriorityDisplay", () => ({
  IssuePriorityDisplay: () => null,
}));
vi.mock("~/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: () => null,
}));
vi.mock("~/components/MilestoneIconAndName", () => ({
  MilestoneIconAndName: () => null,
}));
vi.mock("~/components/SessionNameDisplay", () => ({
  SessionNameDisplay: () => null,
}));
vi.mock("~/components/StatusDisplay", () => ({
  default: ({ name }: { name: string }) => (
    <span data-testid="status-display">{name}</span>
  ),
}));
vi.mock("~/components/tables/UserNameCell", () => ({
  UserNameCell: () => null,
}));
vi.mock("~/components/tables/CaseDisplay", () => ({
  CaseDisplay: () => null,
}));
vi.mock("~/components/CodeRepositoryName", () => ({
  CodeRepositoryName: () => null,
}));
vi.mock("~/components/TestRunNameDisplay", () => ({
  TestRunNameDisplay: () => null,
}));
vi.mock("~/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: () => null,
}));

function renderStatusCell(row: Record<string, unknown>) {
  const { result } = renderHook(() =>
    useDrillDownColumns({ metricId: "milestoneCompletion" })
  );
  const column = result.current.find((c) => c.id === "status") as any;
  expect(column).toBeDefined();
  const cell = column.cell({
    row: { original: row },
    getValue: () => row.status,
  });
  return render(<>{cell}</>);
}

// Milestone Completion drills into run cases. A case with no status has
// never been executed: Pending while its run is open, Untested once the run
// is completed and locked.
describe("useDrillDownColumns milestoneCompletion status column", () => {
  it("shows Pending for an unexecuted case in an open run", () => {
    const { container } = renderStatusCell({
      id: 1,
      status: null,
      testRun: { id: 10, name: "Open run", isCompleted: false },
    });
    expect(container.textContent).toBe("status.pending");
  });

  it("shows Untested for an unexecuted case in a completed run", () => {
    const { container } = renderStatusCell({
      id: 2,
      status: null,
      testRun: { id: 11, name: "Done run", isCompleted: true },
    });
    expect(container.textContent).toBe("labels.untested");
  });

  it("falls back to Pending when the row carries no run", () => {
    const { container } = renderStatusCell({ id: 3, status: null });
    expect(container.textContent).toBe("status.pending");
  });

  it("renders the real status regardless of run completion", () => {
    const { getByTestId } = renderStatusCell({
      id: 4,
      status: { name: "Passed", color: { value: "#0f0" } },
      testRun: { id: 11, name: "Done run", isCompleted: true },
    });
    expect(getByTestId("status-display").textContent).toBe("Passed");
  });
});
