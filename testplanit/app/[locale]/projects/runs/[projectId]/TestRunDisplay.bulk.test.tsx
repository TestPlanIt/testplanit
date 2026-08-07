import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import TestRunDisplay from "./TestRunDisplay";

// ── Permission control ──────────────────────────────────────────────────────
const { mockUseProjectPermissions } = vi.hoisted(() => ({
  mockUseProjectPermissions: vi.fn(),
}));
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

// ── Environment mocks ───────────────────────────────────────────────────────
// createColorMap indexes orders [2] and [5] of these families.
const COLOR_FAMILIES = ["Green", "Black", "Red", "Blue", "Orange"];
const mockColors = COLOR_FAMILIES.flatMap((name, familyIndex) =>
  Array.from({ length: 6 }, (_, order) => ({
    id: familyIndex * 10 + order,
    value: "#123456",
    order,
    colorFamilyId: familyIndex,
    colorFamily: { id: familyIndex, name, order: familyIndex },
  }))
);

vi.mock("~/zenstack/schema", () => ({ schema: {} }));
vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    color: { useFindMany: () => ({ data: mockColors, isLoading: false }) },
    testRunCases: { useFindMany: () => ({ data: [] }) },
    reviewRequest: { useFindMany: () => ({ data: [] }) },
    integrationProject: { useFindMany: () => ({ data: [] }) },
    testRuns: { useUpdate: () => ({ mutateAsync: vi.fn() }) },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("~/hooks/useTestRunLiveStream", () => ({
  useProjectTestRunStream: vi.fn(),
}));
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: () => ({ enabled: false }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { access: "USER" } } }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));
vi.mock("next-intl", () => ({
  useTranslations: vi.fn(
    () => (key: string, params?: Record<string, unknown>) =>
      params && "count" in params ? `${key} (${params.count})` : key
  ),
}));
vi.mock("next/navigation", () => ({ useParams: () => ({ projectId: "1" }) }));
vi.mock("react-dnd", () => ({
  useDrag: () => [{ isDragging: false }, vi.fn(), vi.fn()],
  useDrop: () => [{ isOver: false, canDrop: false }, vi.fn()],
}));
vi.mock("@/components/DynamicIcon", () => ({ default: () => null }));
vi.mock("@/components/MilestoneSourceBadge", () => ({
  MilestoneSourceBadge: () => null,
}));
vi.mock("@/components/MilestoneIconAndName", () => ({
  MilestoneIconAndName: () => null,
}));
vi.mock("@/components/DateTextDisplay", () => ({
  DateTextDisplay: () => null,
}));
vi.mock("./AddTestRunModal", () => ({ default: () => null }));
vi.mock("./[runId]/CompleteTestRunDialog", () => ({ default: () => null }));
vi.mock("./BulkEditTestRunsDialog", () => ({
  default: () => <div data-testid="bulk-edit-dialog" />,
}));
vi.mock("./BulkCompleteTestRunsDialog", () => ({ default: () => null }));
vi.mock("./BulkDeleteTestRunsDialog", () => ({ default: () => null }));

// Stub rows: clicking one selects it, mirroring the checkbox contract.
vi.mock("./TestRunItem", () => ({
  default: (props: {
    testRun: { id: number };
    selectable?: boolean;
    onSelectedChange?: (selected: boolean) => void;
  }) => (
    <div
      data-testid={`stub-run-${props.testRun.id}`}
      data-selectable={String(props.selectable ?? false)}
      onClick={() => props.onSelectedChange?.(true)}
    />
  ),
}));

const makeRun = (id: number, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    name: `Run ${id}`,
    isCompleted: false,
    completedAt: null,
    compositionLockedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    note: null,
    docs: null,
    projectId: 1,
    configId: null,
    configuration: null,
    configurationGroupId: null,
    milestoneId: null,
    milestone: null,
    stateId: 1,
    state: { id: 1, name: "Active", icon: { name: "circle" }, color: null },
    createdBy: { id: "u1", name: "User One" },
    forecastManual: null,
    forecastAutomated: null,
    testRunType: "REGULAR",
    ...overrides,
  }) as any;

const setPermissions = (perms: {
  canAddEdit: boolean;
  canClose: boolean;
  canDelete: boolean;
}) => {
  mockUseProjectPermissions.mockReturnValue({
    permissions: perms,
    isLoading: false,
  });
};

const renderDisplay = (runs = [makeRun(1), makeRun(2)]) =>
  render(<TestRunDisplay testRuns={runs} milestones={[]} />);

describe("TestRunDisplay bulk selection permission gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it("hides all selection checkboxes when the user has no edit, close, or delete permission", () => {
    setPermissions({ canAddEdit: false, canClose: false, canDelete: false });
    renderDisplay();
    expect(screen.getByTestId("stub-run-1")).toHaveAttribute(
      "data-selectable",
      "false"
    );
    expect(screen.getByTestId("stub-run-2")).toHaveAttribute(
      "data-selectable",
      "false"
    );
    expect(screen.queryByTestId("testrun-bulk-bar")).not.toBeInTheDocument();
  });

  it("shows checkboxes and every permitted action for a fully-permitted user", () => {
    setPermissions({ canAddEdit: true, canClose: true, canDelete: true });
    renderDisplay();
    expect(screen.getByTestId("stub-run-1")).toHaveAttribute(
      "data-selectable",
      "true"
    );

    fireEvent.click(screen.getByTestId("stub-run-1"));
    expect(screen.getByTestId("testrun-bulk-bar")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-edit")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-complete")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-delete")).toBeInTheDocument();
  });

  it("shows only the Complete action for a user with only close permission", () => {
    setPermissions({ canAddEdit: false, canClose: true, canDelete: false });
    renderDisplay();
    fireEvent.click(screen.getByTestId("stub-run-1"));

    expect(screen.getByTestId("testrun-bulk-bar")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-complete")).toBeInTheDocument();
    expect(screen.queryByTestId("testrun-bulk-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("testrun-bulk-delete")).not.toBeInTheDocument();
  });

  it("shows only the Delete action for a user with only delete permission", () => {
    setPermissions({ canAddEdit: false, canClose: false, canDelete: true });
    renderDisplay();
    fireEvent.click(screen.getByTestId("stub-run-1"));

    expect(screen.getByTestId("testrun-bulk-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("testrun-bulk-edit")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("testrun-bulk-complete")
    ).not.toBeInTheDocument();
  });

  it("disables Edit when only automated runs are selected but keeps Complete and Delete live", () => {
    setPermissions({ canAddEdit: true, canClose: true, canDelete: true });
    renderDisplay([makeRun(1), makeRun(2, { testRunType: "JUNIT" })]);
    fireEvent.click(screen.getByTestId("stub-run-2"));

    expect(screen.getByTestId("testrun-bulk-edit")).toBeDisabled();
    expect(screen.getByTestId("testrun-bulk-complete")).toBeEnabled();
    expect(screen.getByTestId("testrun-bulk-delete")).toBeEnabled();
  });
});
