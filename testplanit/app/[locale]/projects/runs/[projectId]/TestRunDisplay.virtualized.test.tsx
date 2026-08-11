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

// ── Virtualizer control ─────────────────────────────────────────────────────
// TanStack Virtual measures a zero-height container under jsdom and would
// report an empty window for every list, so the real hook can't distinguish
// "windowed correctly" from "rendered nothing". This pass-through reports a
// window we choose; see components/VirtualizedCardList.test.tsx for the same
// pattern applied to the list component in isolation.
const hookMock = vi.hoisted(() => ({
  window: null as number[] | null, // indices to render; null = all `count`
}));
vi.mock("~/hooks/useVirtualizedInfiniteList", () => ({
  useVirtualizedInfiniteList: (opts: { count: number }) => {
    const indices =
      hookMock.window ?? Array.from({ length: opts.count }, (_, i) => i);
    return {
      scrollRef: () => {},
      sentinelRef: { current: null },
      virtualizer: {},
      virtualItems: indices.map((index) => ({
        key: index,
        index,
        start: index * 96,
        size: 96,
        end: (index + 1) * 96,
        lane: 0,
      })),
      totalSize: opts.count * 96,
      measureElement: () => {},
      maxHeight: null,
    };
  },
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
vi.mock("./BulkEditTestRunsDialog", () => ({ default: () => null }));
vi.mock("./BulkCompleteTestRunsDialog", () => ({ default: () => null }));
vi.mock("./BulkDeleteTestRunsDialog", () => ({ default: () => null }));

// Each stub stands in for a row's on-mount cost — the per-tile queries this
// change exists to defer. Its presence in the DOM means that cost was paid.
vi.mock("./TestRunItem", () => ({
  default: (props: {
    testRun: { id: number };
    onSelectedChange?: (selected: boolean) => void;
  }) => (
    <div
      data-testid={`stub-run-${props.testRun.id}`}
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

const makeRuns = (n: number) =>
  Array.from({ length: n }, (_, i) => makeRun(i + 1));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  hookMock.window = null;
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: true, canClose: true, canDelete: true },
    isLoading: false,
  });
});

describe("TestRunDisplay tile windowing", () => {
  it("mounts only the windowed rows of a large unscheduled group", () => {
    hookMock.window = [0, 1, 2];
    render(<TestRunDisplay testRuns={makeRuns(40)} milestones={[]} />);

    expect(screen.getByTestId("stub-run-1")).toBeInTheDocument();
    expect(screen.getByTestId("stub-run-3")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-run-4")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-run-40")).not.toBeInTheDocument();
  });

  it("puts a large group in a bounded scroll container and leaves a small one in the page scroll", () => {
    const { unmount } = render(
      <TestRunDisplay testRuns={makeRuns(40)} milestones={[]} />
    );
    expect(
      screen.getByTestId("unscheduled-test-runs-list").className
    ).toContain("overflow-auto");
    unmount();

    render(<TestRunDisplay testRuns={makeRuns(5)} milestones={[]} />);
    const small = screen.getByTestId("unscheduled-test-runs-list");
    expect(small.className).not.toContain("overflow-auto");
    expect(screen.getByTestId("stub-run-5")).toBeInTheDocument();
  });

  it("keeps a row selected after it scrolls out of the window", () => {
    hookMock.window = [0, 1, 2];
    const runs = makeRuns(40);
    const { rerender } = render(
      <TestRunDisplay testRuns={runs} milestones={[]} />
    );

    fireEvent.click(screen.getByTestId("stub-run-1"));
    expect(screen.getByTestId("testrun-bulk-bar")).toBeInTheDocument();

    // Scroll the selected row out of the window; selection lives in the
    // display's own state, keyed on the full run list, so it must survive the
    // row unmounting.
    hookMock.window = [20, 21, 22];
    rerender(<TestRunDisplay testRuns={runs} milestones={[]} />);

    expect(screen.queryByTestId("stub-run-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("stub-run-21")).toBeInTheDocument();
    expect(screen.getByTestId("testrun-bulk-bar")).toBeInTheDocument();
  });
});
