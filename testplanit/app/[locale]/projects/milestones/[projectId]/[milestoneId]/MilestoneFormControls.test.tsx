import { render, screen } from "@testing-library/react";
import React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks ---

// Stable references — returning a fresh array/object literal on every call
// would retrigger the component's `useEffect(() => {...}, [colors])` on
// every render (new array identity each time), causing an infinite
// render loop in this test harness.
const STABLE_COLORS: any[] = [];
const STABLE_MILESTONE_TYPES: any[] = [];
const STABLE_MILESTONES: any[] = [];

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    color: { useFindMany: () => ({ data: STABLE_COLORS }) },
    milestoneTypes: { useFindMany: () => ({ data: STABLE_MILESTONE_TYPES }) },
    milestones: { useFindMany: () => ({ data: STABLE_MILESTONES }) },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string, params?: any) => {
    let result = namespace ? `${namespace}.${key}` : key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        result = result.replace(`{${k}}`, String(v));
      });
    }
    return result;
  },
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: ({ readOnly }: any) => (
    <div data-testid="tiptap-note" data-readonly={String(!!readOnly)} />
  ),
}));

vi.mock("@/components/forms/DatePickerField", () => ({
  DatePickerField: ({ name, disabled }: any) => (
    <input data-testid={`datepicker-${name}`} disabled={disabled} readOnly />
  ),
}));

vi.mock("@/components/search/UserDisplay", () => ({
  UserDisplay: () => <div data-testid="user-display" />,
}));

vi.mock("@/components/DateTextDisplay", () => ({
  DateTextDisplay: () => <div data-testid="date-text-display" />,
}));

vi.mock("@/components/DynamicIcon", () => ({
  default: () => <span data-testid="dynamic-icon" />,
}));

vi.mock("@/components/ui/help-popover", () => ({
  HelpPopover: () => <span data-testid="help-popover" />,
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, "data-testid": testId }: any) => (
    <div data-testid={testId ?? "alert"} role="alert">
      {children}
    </div>
  ),
  AlertTitle: ({ children }: any) => <div>{children}</div>,
  AlertDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, disabled }: any) => (
    <div data-testid="select" data-disabled={String(!!disabled)}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <div />,
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, disabled, onCheckedChange }: any) => (
    <input
      type="checkbox"
      role="switch"
      checked={!!checked}
      disabled={disabled}
      onChange={() => onCheckedChange?.(!checked)}
    />
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("~/utils/milestoneUtils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/utils/milestoneUtils")>();
  return {
    ...actual,
    createColorMap: () => ({}),
  };
});

import MilestoneFormControls from "./MilestoneFormControls";

function Harness({
  milestone,
  isEditMode = true,
}: {
  milestone: any;
  isEditMode?: boolean;
}) {
  const methods = useForm({
    defaultValues: {
      name: milestone?.name ?? "",
      note: milestone?.note ?? "",
      isStarted: milestone?.isStarted ?? false,
      isCompleted: milestone?.isCompleted ?? false,
      startedAt: milestone?.startedAt ?? null,
      completedAt: milestone?.completedAt ?? null,
      automaticCompletion: milestone?.automaticCompletion ?? false,
      enableNotifications: false,
      notifyDaysBefore: 0,
      milestoneTypesId: milestone?.milestoneTypesId ?? 1,
      parentId: milestone?.parentId ?? null,
    },
  });

  return (
    <FormProvider {...methods}>
      <MilestoneFormControls
        isEditMode={isEditMode}
        isSubmitting={false}
        milestone={milestone}
        projectId="42"
        milestoneId="1"
      />
    </FormProvider>
  );
}

const syncedMilestone = {
  id: 1,
  name: "Sprint 5",
  note: null,
  isStarted: true,
  isCompleted: false,
  startedAt: new Date("2026-01-01"),
  completedAt: null,
  automaticCompletion: false,
  notifyDaysBefore: 0,
  milestoneTypesId: 1,
  parentId: null,
  integrationId: 5,
  externalId: "10001",
  externalKind: "ITERATION",
  externalState: "active",
  externalUrl: "https://example.atlassian.net/browse/x",
  lastSyncedAt: new Date("2026-07-01T00:00:00Z"),
  creator: null,
};

const localMilestone = {
  ...syncedMilestone,
  integrationId: null,
  externalId: null,
  externalKind: null,
  externalState: null,
  externalUrl: null,
  lastSyncedAt: null,
};

describe("MilestoneFormControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("synced milestone (integrationId set)", () => {
    it("disables tracker-owned fields and shows the managed-by-Jira alert", () => {
      render(<Harness milestone={syncedMilestone} isEditMode />);

      expect(
        screen.getByTestId("milestone-sync-locked-alert")
      ).toBeInTheDocument();

      const startedSwitch = screen.getAllByRole("switch")[0];
      expect(startedSwitch).toBeDisabled();

      expect(screen.getByTestId("datepicker-startedAt")).toBeDisabled();
      expect(screen.getByTestId("datepicker-completedAt")).toBeDisabled();

      expect(screen.getByTestId("tiptap-note")).toHaveAttribute(
        "data-readonly",
        "true"
      );
    });

    it("hides automaticCompletion when synced", () => {
      render(<Harness milestone={syncedMilestone} isEditMode />);
      // Only the isStarted and isCompleted switches should render (no
      // automaticCompletion / enableNotifications switch pair adds one more,
      // so assert automaticCompletion's own FormLabel text is absent).
      expect(
        screen.queryByText("milestones.fields.automaticCompletion")
      ).not.toBeInTheDocument();
    });

    it("keeps local fields (milestone type, parent) editable", () => {
      render(<Harness milestone={syncedMilestone} isEditMode />);
      const selects = screen.getAllByTestId("select");
      selects.forEach((select) => {
        expect(select).toHaveAttribute("data-disabled", "false");
      });
    });
  });

  describe("local milestone (integrationId null)", () => {
    it("all fields editable, no alert", () => {
      render(<Harness milestone={localMilestone} isEditMode />);

      expect(
        screen.queryByTestId("milestone-sync-locked-alert")
      ).not.toBeInTheDocument();

      const startedSwitch = screen.getAllByRole("switch")[0];
      expect(startedSwitch).not.toBeDisabled();

      expect(screen.getByTestId("datepicker-startedAt")).not.toBeDisabled();
      expect(screen.getByTestId("datepicker-completedAt")).not.toBeDisabled();

      expect(screen.getByTestId("tiptap-note")).toHaveAttribute(
        "data-readonly",
        "false"
      );

      // automaticCompletion field renders for local milestones.
      expect(
        screen.getByText("milestones.fields.automaticCompletion")
      ).toBeInTheDocument();
    });
  });
});
