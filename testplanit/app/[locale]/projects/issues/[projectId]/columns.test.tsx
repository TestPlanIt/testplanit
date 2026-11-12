import { render, renderHook, screen } from "@testing-library/react";
import {
  createElement,
  useEffect,
  type ComponentType,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { CountsLoadingProvider } from "@/components/tables/CountsLoading";
import { useIssueColumns, type ExtendedIssues } from "./columns";

const { countDisplay } = vi.hoisted(() => ({
  countDisplay: (name: string) => ({
    [name]: ({ count, isLoading }: { count?: number; isLoading?: boolean }) =>
      createElement(
        "span",
        { "data-testid": name },
        isLoading ? "loading" : String(count)
      ),
  }),
}));

vi.mock("@/components/tables/CaseListDisplay", () =>
  countDisplay("CasesListDisplay")
);
vi.mock("@/components/tables/TestRunsListDisplay", () =>
  countDisplay("TestRunsListDisplay")
);
vi.mock("@/components/tables/SessionListDisplay", () =>
  countDisplay("SessionsListDisplay")
);
vi.mock("@/components/tables/MilestonesCountDisplay", () =>
  countDisplay("MilestonesCountDisplay")
);
vi.mock("@/components/tables/IssuesDisplay", () => ({
  IssuesDisplay: () => null,
}));
vi.mock("@/components/DateFormatter", () => ({ DateFormatter: () => null }));
vi.mock("@/components/IssuePriorityDisplay", () => ({
  IssuePriorityDisplay: () => null,
}));
vi.mock("@/components/IssueStatusDisplay", () => ({
  IssueStatusDisplay: () => null,
}));

const translations = {
  name: "Name",
  title: "Title",
  description: "Description",
  status: "Status",
  priority: "Priority",
  lastSyncedAt: "Last synced",
  testCases: "Test cases",
  sessions: "Sessions",
  testRuns: "Test runs",
  milestones: "Milestones",
  integration: "Integration",
  actions: "Actions",
};

const issue = {
  id: 7,
  name: "PROJ-7",
  integrationId: 1,
  repositoryCasesCount: 3,
  sessionsCount: 1,
  testRunsCount: 2,
  milestonesCount: 0,
} as unknown as ExtendedIssues;

// A table renders each cell by using the column's `cell` function as a
// component, so a new function means React unmounts the old cell.
function Cell({
  columns,
  id,
}: {
  columns: ReturnType<typeof useIssueColumns>;
  id: string;
}) {
  const column = columns.find((c) => c.id === id);
  if (!column?.cell) throw new Error(`no ${id} column`);
  return createElement(column.cell as ComponentType<{ row: unknown }>, {
    row: { original: issue },
  });
}

describe("useIssueColumns", () => {
  it("keeps the same column definitions while counts load and finish loading", () => {
    let countsLoading = true;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CountsLoadingProvider value={countsLoading}>
        {children}
      </CountsLoadingProvider>
    );
    const renderRowActions = () => null;
    const { result, rerender } = renderHook(
      () => useIssueColumns({ translations, renderRowActions }),
      { wrapper }
    );
    const whileLoading = result.current;

    countsLoading = false;
    rerender();

    expect(result.current).toBe(whileLoading);
  });

  it("does not remount a row's action menu when the counts arrive", () => {
    const mounts = vi.fn();
    function RowMenu() {
      useEffect(() => {
        mounts();
      }, []);
      return <button type="button">Actions</button>;
    }
    const renderRowActions = () => <RowMenu />;
    function Table({ countsLoading }: { countsLoading: boolean }) {
      const columns = useIssueColumns({ translations, renderRowActions });
      return (
        <CountsLoadingProvider value={countsLoading}>
          <Cell columns={columns} id="cases" />
          <Cell columns={columns} id="actions" />
        </CountsLoadingProvider>
      );
    }

    const { rerender } = render(<Table countsLoading={false} />);
    rerender(<Table countsLoading />);
    rerender(<Table countsLoading={false} />);

    expect(screen.getByRole("button", { name: "Actions" })).toBeInTheDocument();
    expect(mounts).toHaveBeenCalledTimes(1);
  });

  it("shows each count as loading until the counts arrive", () => {
    function Counts({ countsLoading }: { countsLoading: boolean }) {
      const columns = useIssueColumns({ translations });
      return (
        <CountsLoadingProvider value={countsLoading}>
          <Cell columns={columns} id="cases" />
          <Cell columns={columns} id="testRuns" />
          <Cell columns={columns} id="sessions" />
          <Cell columns={columns} id="milestones" />
        </CountsLoadingProvider>
      );
    }
    const shown = () =>
      [
        "CasesListDisplay",
        "TestRunsListDisplay",
        "SessionsListDisplay",
        "MilestonesCountDisplay",
      ].map((id) => screen.getByTestId(id).textContent);

    const { rerender } = render(<Counts countsLoading />);
    expect(shown()).toEqual(["loading", "loading", "loading", "loading"]);

    rerender(<Counts countsLoading={false} />);
    expect(shown()).toEqual(["3", "2", "1", "0"]);
  });

  it("shows counts as loaded when no provider is present", () => {
    function Counts() {
      const columns = useIssueColumns({ translations });
      return <Cell columns={columns} id="cases" />;
    }

    render(<Counts />);

    expect(screen.getByTestId("CasesListDisplay").textContent).toBe("3");
  });
});
