import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    testRunCases: { useFindMany: () => ({ data: [] }) },
  }),
}));
vi.mock("~/hooks/useResultWindow", () => ({
  useTestRunResultWindow: () => ({ startDate: null, endDate: null }),
}));
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: () => ({
    permissions: { canAddEdit: true, canClose: true, canDelete: true },
    isLoading: false,
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(() => (key: string) => key),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "1" }) }));
vi.mock("~/lib/navigation", () => ({
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/components/DynamicIcon", () => ({ default: () => null }));
vi.mock("@/components/TestRunCasesSummary", () => ({
  TestRunCasesSummary: () => null,
}));
vi.mock("@/components/MemberList", () => ({ MemberList: () => null }));
vi.mock("@/components/ForecastDisplay", () => ({
  ForecastDisplay: () => null,
}));
vi.mock("@/components/WorkflowStateDisplay", () => ({
  WorkflowStateDisplay: () => null,
}));
vi.mock("@/components/TextFromJson", () => ({ default: () => null }));
vi.mock("@/components/DateTextDisplay", () => ({
  DateTextDisplay: () => null,
}));
vi.mock("@/components/MilestoneIconAndName", () => ({
  MilestoneIconAndName: () => null,
}));
vi.mock("@/components/RecordKeyMenuItem", () => ({
  RecordKeyMenuItem: () => null,
}));
vi.mock("./[runId]/CompleteTestRunDialog", () => ({ default: () => null }));

// Render menu items inline — the real Radix menu keeps them unmounted until
// the trigger is opened, which jsdom's pointer handling can't drive.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: any) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuGroup: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onSelect,
    onClick,
    "data-testid": testId,
  }: any) => (
    <div
      data-testid={testId ?? "dropdown-item"}
      role="menuitem"
      onClick={() => {
        onSelect?.();
        onClick?.();
      }}
    >
      {children}
    </div>
  ),
}));

import TestRunItem from "./TestRunItem";

const makeRun = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 7,
    name: "Nightly regression",
    isCompleted: false,
    completedAt: null,
    testRunType: "REGULAR",
    configuration: null,
    configurationGroupId: null,
    state: { id: 1, name: "Active" },
    projectId: 1,
    createdBy: { id: "u1", name: "User One" },
    forecastManual: null,
    forecastAutomated: null,
    ...overrides,
  }) as any;

const renderItem = (run: any, props: Record<string, unknown> = {}) =>
  render(
    <TooltipProvider>
      <TestRunItem testRun={run} {...props} />
    </TooltipProvider>
  );

describe("TestRunItem duplicate action", () => {
  it("offers duplicate on an in-progress run", () => {
    renderItem(makeRun(), { onDuplicate: vi.fn() });
    expect(screen.getByTestId("testrun-duplicate-7")).toBeInTheDocument();
  });

  it("offers duplicate on a completed run", () => {
    renderItem(
      makeRun({ isCompleted: true, completedAt: new Date("2026-08-01") }),
      { onDuplicate: vi.fn() }
    );
    expect(screen.getByTestId("testrun-duplicate-7")).toBeInTheDocument();
  });

  it("passes the completed run's id and name to onDuplicate", () => {
    const onDuplicate = vi.fn();
    renderItem(
      makeRun({ isCompleted: true, completedAt: new Date("2026-08-01") }),
      { onDuplicate }
    );
    fireEvent.click(screen.getByTestId("testrun-duplicate-7"));
    expect(onDuplicate).toHaveBeenCalledWith({
      id: 7,
      name: "Nightly regression",
    });
  });

  it("still hides duplicate on an imported (automated) run", () => {
    renderItem(
      makeRun({
        isCompleted: true,
        completedAt: new Date("2026-08-01"),
        testRunType: "JUNIT",
      }),
      { onDuplicate: vi.fn() }
    );
    expect(screen.queryByTestId("testrun-duplicate-7")).not.toBeInTheDocument();
  });

  it("hides duplicate when no onDuplicate handler is wired", () => {
    renderItem(makeRun({ isCompleted: true, completedAt: new Date() }));
    expect(screen.queryByTestId("testrun-duplicate-7")).not.toBeInTheDocument();
  });
});
