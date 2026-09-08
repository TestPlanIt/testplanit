import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SessionDisplay from "./SessionDisplay";

// ── Permission control (canDelete comes from this hook; edit/close are props) ─
const { mockUseProjectPermissions } = vi.hoisted(() => ({
  mockUseProjectPermissions: vi.fn(),
}));
vi.mock("~/hooks/useProjectPermissions", () => ({
  useProjectPermissions: mockUseProjectPermissions,
}));

// ── Virtualizer control ─────────────────────────────────────────────────────
// TanStack Virtual measures against a real layout, which jsdom does not
// provide, so the real virtualizer reports an empty window for every list and
// "windowed correctly" would be indistinguishable from "rendered nothing".
// This pass-through reports a window we choose.
const hookMock = vi.hoisted(() => ({
  window: null as number[] | null, // indices to render; null = all `count`
  lastCount: 0,
}));
vi.mock("@tanstack/react-virtual", () => ({
  useWindowVirtualizer: (opts: { count: number }) => {
    hookMock.lastCount = opts.count;
    const indices =
      hookMock.window ?? Array.from({ length: opts.count }, (_, i) => i);
    return {
      getTotalSize: () => opts.count * 96,
      getVirtualItems: () =>
        indices
          .filter((index) => index < opts.count)
          .map((index) => ({ key: index, index, start: index * 96, size: 96 })),
      measureElement: () => {},
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
    reviewRequest: { useFindMany: () => ({ data: [] }) },
    sessions: {
      useFindUnique: () => ({ data: undefined, isLoading: false }),
      useUpdate: () => ({ mutateAsync: vi.fn() }),
    },
    sessionFieldValues: { useFindMany: () => ({ data: [] }) },
  }),
}));
vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: () => ({ enabled: false }),
}));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { access: "USER", preferences: {} } } }),
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
vi.mock("@/components/DynamicIcon", () => ({ default: () => null }));
vi.mock("@/components/MilestoneIconAndName", () => ({
  MilestoneIconAndName: () => null,
}));
vi.mock("@/components/DateTextDisplay", () => ({
  DateTextDisplay: () => null,
}));
vi.mock("./AddSessionModal", () => ({ AddSessionModal: () => null }));
vi.mock("./[sessionId]/CompleteSessionDialog", () => ({
  CompleteSessionDialog: () => null,
}));
vi.mock("./BulkEditSessionsDialog", () => ({ default: () => null }));
vi.mock("./BulkCompleteSessionsDialog", () => ({ default: () => null }));
vi.mock("./BulkDeleteSessionsDialog", () => ({ default: () => null }));

// Stub rows: clicking one selects it, mirroring the checkbox contract.
vi.mock("./SessionItem", () => ({
  default: (props: {
    testSession: { id: number };
    selectable?: boolean;
    onSelectedChange?: (selected: boolean) => void;
  }) => (
    <div
      data-testid={`stub-session-${props.testSession.id}`}
      data-selectable={String(props.selectable ?? false)}
      onClick={() => props.onSelectedChange?.(true)}
    />
  ),
}));

const makeSession = (id: number, overrides: Record<string, unknown> = {}) =>
  ({
    id,
    name: `Session ${id}`,
    isCompleted: false,
    completedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    projectId: 1,
    milestoneId: null,
    milestone: null,
    configId: null,
    configuration: null,
    configurationGroupId: null,
    note: null,
    mission: null,
    stateId: 1,
    state: { id: 1, name: "Active", icon: { name: "circle" }, color: null },
    createdBy: { id: "u1", name: "User One" },
    assignedTo: null,
    assignedToId: null,
    templateId: 1,
    template: { id: 1, templateName: "Default" },
    currentVersion: 1,
    estimate: null,
    forecastManual: null,
    forecastAutomated: null,
    elapsed: null,
    project: { name: "Project" },
    ...overrides,
  }) as any;

const makeSessions = (n: number) =>
  Array.from({ length: n }, (_, i) => makeSession(i + 1));

const renderSessions = (sessions: unknown[]) =>
  render(
    <SessionDisplay
      testSessions={sessions as never}
      milestones={[]}
      canAddEdit={true}
      canCloseSession={true}
    />
  );

beforeEach(() => {
  vi.clearAllMocks();
  hookMock.window = null;
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: true, canClose: true, canDelete: true },
    isLoading: false,
  });
});

describe("SessionDisplay row windowing", () => {
  it("mounts only the windowed rows", () => {
    // 41 rows: the unscheduled header, then 40 sessions.
    hookMock.window = [0, 1, 2];
    renderSessions(makeSessions(40));

    expect(screen.getByTestId("stub-session-1")).toBeInTheDocument();
    expect(screen.getByTestId("stub-session-2")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-session-3")).not.toBeInTheDocument();
    expect(screen.queryByTestId("stub-session-40")).not.toBeInTheDocument();
  });

  it("gives the virtualizer a row per session plus the group header", () => {
    renderSessions(makeSessions(12));
    expect(hookMock.lastCount).toBe(13);
  });

  // Every session tile fires its own /summary request on mount, so a group
  // that scrolls in its own container would keep paying for rows nobody sees.
  it("never puts rows in a bounded scroll container", () => {
    renderSessions(makeSessions(40));
    const list = screen.getByTestId("session-list");
    expect(list.className).not.toContain("overflow-auto");
    expect(list.querySelector(".overflow-auto")).toBeNull();
  });

  it("windows the completed tab's flat list too", () => {
    hookMock.window = [0, 1, 2];
    const completed = makeSessions(40).map((session) => ({
      ...session,
      isCompleted: true,
      completedAt: new Date("2026-02-01T00:00:00Z"),
    }));
    renderSessions(completed);

    expect(screen.queryByTestId("session-list")).not.toBeInTheDocument();
    const list = screen.getByTestId("completed-session-list");
    expect(list.className).not.toContain("overflow-auto");
    expect(screen.getByTestId("stub-session-3")).toBeInTheDocument();
    expect(screen.queryByTestId("stub-session-4")).not.toBeInTheDocument();
  });

  it("keeps a row selected after it scrolls out of the window", () => {
    hookMock.window = [0, 1, 2];
    const sessions = makeSessions(40);
    const { rerender } = render(
      <SessionDisplay
        testSessions={sessions as never}
        milestones={[]}
        canAddEdit={true}
        canCloseSession={true}
      />
    );

    fireEvent.click(screen.getByTestId("stub-session-1"));
    expect(screen.getByTestId("session-bulk-bar")).toBeInTheDocument();

    hookMock.window = [20, 21, 22];
    rerender(
      <SessionDisplay
        testSessions={sessions as never}
        milestones={[]}
        canAddEdit={true}
        canCloseSession={true}
      />
    );

    expect(screen.queryByTestId("stub-session-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("stub-session-21")).toBeInTheDocument();
    expect(screen.getByTestId("session-bulk-bar")).toBeInTheDocument();
  });
});
