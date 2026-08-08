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

const setCanDelete = (canDelete: boolean) => {
  mockUseProjectPermissions.mockReturnValue({
    permissions: { canAddEdit: false, canClose: false, canDelete },
    isLoading: false,
  });
};

const renderDisplay = ({
  canAddEdit = false,
  canCloseSession = false,
  sessions = [makeSession(1), makeSession(2)],
} = {}) =>
  render(
    <SessionDisplay
      testSessions={sessions}
      milestones={[]}
      canAddEdit={canAddEdit}
      canCloseSession={canCloseSession}
    />
  );

describe("SessionDisplay bulk selection permission gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hides all selection checkboxes when the user has no edit, close, or delete permission", () => {
    setCanDelete(false);
    renderDisplay();
    expect(screen.getByTestId("stub-session-1")).toHaveAttribute(
      "data-selectable",
      "false"
    );
    expect(screen.getByTestId("stub-session-2")).toHaveAttribute(
      "data-selectable",
      "false"
    );
    expect(screen.queryByTestId("session-bulk-bar")).not.toBeInTheDocument();
  });

  it("shows checkboxes and every permitted action for a fully-permitted user", () => {
    setCanDelete(true);
    renderDisplay({ canAddEdit: true, canCloseSession: true });
    expect(screen.getByTestId("stub-session-1")).toHaveAttribute(
      "data-selectable",
      "true"
    );

    fireEvent.click(screen.getByTestId("stub-session-1"));
    expect(screen.getByTestId("session-bulk-bar")).toBeInTheDocument();
    expect(screen.getByTestId("session-bulk-edit")).toBeInTheDocument();
    expect(screen.getByTestId("session-bulk-complete")).toBeInTheDocument();
    expect(screen.getByTestId("session-bulk-delete")).toBeInTheDocument();
  });

  it("shows only the Edit action for a user with only edit permission", () => {
    setCanDelete(false);
    renderDisplay({ canAddEdit: true });
    fireEvent.click(screen.getByTestId("stub-session-1"));

    expect(screen.getByTestId("session-bulk-bar")).toBeInTheDocument();
    expect(screen.getByTestId("session-bulk-edit")).toBeInTheDocument();
    expect(
      screen.queryByTestId("session-bulk-complete")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-bulk-delete")).not.toBeInTheDocument();
  });

  it("shows only the Delete action for a user with only delete permission", () => {
    setCanDelete(true);
    renderDisplay();
    fireEvent.click(screen.getByTestId("stub-session-1"));

    expect(screen.getByTestId("session-bulk-delete")).toBeInTheDocument();
    expect(screen.queryByTestId("session-bulk-edit")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("session-bulk-complete")
    ).not.toBeInTheDocument();
  });
});
