import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import TestRunItem from "./TestRunItem";

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
    permissions: { canAddEdit: false, canClose: false, canDelete: false },
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

const testRun = {
  id: 7,
  name: "Nightly regression",
  isCompleted: false,
  testRunType: "REGULAR",
  configuration: null,
  configurationGroupId: null,
  state: { id: 1, name: "Active" },
  projectId: 1,
  createdBy: { id: "u1", name: "User One" },
  forecastManual: null,
  forecastAutomated: null,
} as any;

const renderItem = (props: Record<string, unknown> = {}) =>
  render(
    <TooltipProvider>
      <TestRunItem testRun={testRun} {...props} />
    </TooltipProvider>
  );

describe("TestRunItem selection checkbox", () => {
  it("renders no checkbox when the row is not selectable", () => {
    renderItem();
    expect(screen.queryByTestId("testrun-select-7")).not.toBeInTheDocument();
  });

  it("renders the checkbox when selectable and reports selection changes", () => {
    const onSelectedChange = vi.fn();
    renderItem({ selectable: true, selected: false, onSelectedChange });
    const checkbox = screen.getByTestId("testrun-select-7");
    fireEvent.click(checkbox);
    expect(onSelectedChange).toHaveBeenCalledWith(true);
  });
});
