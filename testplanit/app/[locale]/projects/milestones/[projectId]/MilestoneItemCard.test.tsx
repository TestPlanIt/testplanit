import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- vi.hoisted for stable mock refs ---
const mockUseTranslations = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

// --- Mocks ---
vi.mock("next-intl", () => ({
  useTranslations: mockUseTranslations,
}));

vi.stubGlobal("fetch", mockFetch);

// Mock sub-components that fetch data or have complex deps
vi.mock("@/components/MilestoneSummary", () => ({
  MilestoneSummary: ({ milestoneId }: any) => (
    <div data-testid="milestone-summary" data-milestone={milestoneId} />
  ),
}));

vi.mock("~/components/LoadingSpinner", () => ({
  default: ({ className }: any) => (
    <span data-testid="loading-spinner" className={className} />
  ),
}));

vi.mock("@/components/ForecastDisplay", () => ({
  ForecastDisplay: ({ seconds, type }: any) => (
    <div data-testid={`forecast-${type}`} data-seconds={seconds} />
  ),
}));

vi.mock("@/components/MilestoneIconAndName", () => ({
  MilestoneIconAndName: ({ milestone }: any) => (
    <div data-testid="milestone-icon-name">{milestone.name}</div>
  ),
}));

vi.mock("@/components/DateCalendarDisplay", () => ({
  CalendarDisplay: ({ date }: any) => (
    <div data-testid="calendar-display">{String(date)}</div>
  ),
}));

vi.mock("@/components/DateTextDisplay", () => ({
  DateTextDisplay: ({ startDate, endDate, isCompleted }: any) => (
    <div
      data-testid="date-text-display"
      data-start={String(startDate)}
      data-end={String(endDate)}
      data-completed={String(isCompleted)}
    />
  ),
}));

vi.mock("@/components/TextFromJson", () => ({
  default: ({ jsonString }: any) => (
    <span data-testid="text-from-json">{jsonString || ""}</span>
  ),
}));

// Mock shadcn/ui badge
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, style, className }: any) => (
    <span data-testid="status-badge" style={style} className={className}>
      {children}
    </span>
  ),
}));

// Mock shadcn/ui button
vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, variant, size, className }: any) => (
    <button
      data-testid="action-button"
      data-variant={variant}
      data-size={size}
      className={className}
      onClick={onClick}
    >
      {children}
    </button>
  ),
}));

// Mock DropdownMenu — render items always visible for easier testing
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children, modal }: any) => (
    <div data-testid="dropdown-menu" data-modal={String(modal)}>
      {children}
    </div>
  ),
  DropdownMenuTrigger: ({ children, _asChild }: any) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  DropdownMenuContent: ({ children }: any) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuGroup: ({ children }: any) => (
    <div data-testid="dropdown-group">{children}</div>
  ),
  DropdownMenuItem: ({ children, onSelect, disabled, className }: any) => (
    <div
      data-testid="dropdown-item"
      data-disabled={String(!!disabled)}
      className={className}
      onClick={() => onSelect?.()}
      role="menuitem"
    >
      {children}
    </div>
  ),
}));

import MilestoneItemCard from "./MilestoneItemCard";
import type { MilestonesWithTypes, ColorMap } from "~/utils/milestoneUtils";

// Mock admin session
const adminSession = {
  user: { id: "user-1", access: "ADMIN", preferences: {} },
} as any;

// Mock project admin session
const projectAdminSession = {
  user: { id: "user-2", access: "PROJECTADMIN", preferences: {} },
} as any;

// Mock regular user session
const regularSession = {
  user: { id: "user-3", access: "USER", preferences: {} },
} as any;

// Mock colorMap
const mockColorMap: ColorMap = {
  started: { dark: "#1a7f37", light: "#dcffe4" },
  unscheduled: { dark: "#24292f", light: "#f6f8fa" },
  pastDue: { dark: "#cf222e", light: "#ffebe9" },
  upcoming: { dark: "#0969da", light: "#ddf4ff" },
  delayed: { dark: "#9a6700", light: "#fff8c5" },
  completed: { dark: "#24292f", light: "#f6f8fa" },
};

// Helper to create a base milestone
const createMilestone = (overrides: Partial<MilestonesWithTypes> = {}): MilestonesWithTypes => ({
  id: 1,
  name: "Test Milestone",
  note: null,
  isStarted: false,
  isCompleted: false,
  startedAt: null,
  completedAt: null,
  parentId: null,
  projectId: 42,
  milestoneTypeId: 1,
  isDeleted: false,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  milestoneType: {
    id: 1,
    name: "Sprint",
    projectId: 42,
    isDeleted: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    icon: null,
    iconId: null,
  },
  children: [],
  ...overrides,
} as any);

// Default callback mocks
const mockCallbacks = () => ({
  onOpenCompleteDialog: vi.fn(),
  onStartMilestone: vi.fn().mockResolvedValue(undefined),
  onStopMilestone: vi.fn().mockResolvedValue(undefined),
  onReopenMilestone: vi.fn().mockResolvedValue(undefined),
  onOpenEditModal: vi.fn(),
  onOpenDeleteModal: vi.fn(),
  isParentCompleted: vi.fn().mockReturnValue(false),
});

beforeEach(() => {
  // Translation: return last key segment
  mockUseTranslations.mockReturnValue((key: string, _opts?: any) => {
    const parts = key.split(".");
    return parts[parts.length - 1];
  });

  // Default fetch for forecast: return no forecast data
  mockFetch.mockResolvedValue({
    ok: false,
    status: 404,
    json: async () => ({}),
  });
});

describe("MilestoneItemCard", () => {
  describe("null rendering", () => {
    it("returns null when session is null", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      const { container } = render(
        <MilestoneItemCard
          milestone={milestone}
          session={null}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      expect(container.firstChild).toBeNull();
    });

    it("returns null when colorMap is null", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      const { container } = render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={null}
          theme="light"
          {...cbs}
        />
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("basic rendering", () => {
    it("renders milestone name via MilestoneIconAndName", () => {
      const milestone = createMilestone({ name: "My Sprint" });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      expect(screen.getByText("My Sprint")).toBeDefined();
    });

    it("renders the status badge", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      expect(screen.getByTestId("status-badge")).toBeDefined();
    });

    it("renders MilestoneSummary with milestone id", () => {
      const milestone = createMilestone({ id: 99 });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      const summary = screen.getByTestId("milestone-summary");
      expect(summary.getAttribute("data-milestone")).toBe("99");
    });
  });

  describe("dropdown visibility by session access", () => {
    it("shows dropdown menu for ADMIN user", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      expect(screen.getByTestId("dropdown-menu")).toBeDefined();
    });

    it("shows dropdown menu for PROJECTADMIN user", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={projectAdminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      expect(screen.getByTestId("dropdown-menu")).toBeDefined();
    });

    it("hides dropdown menu for regular USER", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={regularSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );
      expect(screen.queryByTestId("dropdown-menu")).toBeNull();
    });
  });

  describe("dropdown actions for not-started milestone", () => {
    it("shows Start action when milestone is not started and not completed", () => {
      const milestone = createMilestone({ isStarted: false, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("start"))).toBe(true);
    });

    it("does not show Complete or Stop actions when milestone is not started", () => {
      const milestone = createMilestone({ isStarted: false, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("complete"))).toBe(false);
      expect(itemTexts.some((t) => t?.includes("stop"))).toBe(false);
    });

    it("shows Edit and Delete actions for not-started milestone", () => {
      const milestone = createMilestone({ isStarted: false, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("edit"))).toBe(true);
      expect(itemTexts.some((t) => t?.includes("delete"))).toBe(true);
    });

    it("calls onStartMilestone when Start is clicked", () => {
      const milestone = createMilestone({ isStarted: false, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const startItem = items.find((el) => el.textContent?.includes("start"));
      expect(startItem).toBeDefined();
      fireEvent.click(startItem!);
      expect(cbs.onStartMilestone).toHaveBeenCalledWith(milestone);
    });
  });

  describe("dropdown actions for started milestone", () => {
    it("shows Complete and Stop actions when milestone is started", () => {
      const milestone = createMilestone({
        isStarted: true,
        isCompleted: false,
        startedAt: new Date("2024-01-01"),
      });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("complete"))).toBe(true);
      expect(itemTexts.some((t) => t?.includes("stop"))).toBe(true);
    });

    it("does not show Start action when milestone is started", () => {
      const milestone = createMilestone({ isStarted: true, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("start"))).toBe(false);
    });

    it("calls onOpenCompleteDialog when Complete is clicked", () => {
      const milestone = createMilestone({ isStarted: true, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const completeItem = items.find((el) => el.textContent?.includes("complete"));
      fireEvent.click(completeItem!);
      expect(cbs.onOpenCompleteDialog).toHaveBeenCalledWith(milestone);
    });

    it("calls onStopMilestone when Stop is clicked", () => {
      const milestone = createMilestone({ isStarted: true, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const stopItem = items.find((el) => el.textContent?.includes("stop"));
      fireEvent.click(stopItem!);
      expect(cbs.onStopMilestone).toHaveBeenCalledWith(milestone);
    });
  });

  describe("dropdown actions for completed milestone", () => {
    it("shows Reopen action when milestone is completed", () => {
      const milestone = createMilestone({
        isCompleted: true,
        isStarted: false,
        completedAt: new Date("2024-03-01"),
      });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("reopen"))).toBe(true);
    });

    it("does not show Start or Stop actions for completed milestone", () => {
      const milestone = createMilestone({ isCompleted: true, isStarted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const itemTexts = items.map((el) => el.textContent);
      expect(itemTexts.some((t) => t?.includes("start"))).toBe(false);
      expect(itemTexts.some((t) => t?.includes("stop"))).toBe(false);
    });

    it("calls onReopenMilestone when Reopen is clicked", () => {
      const milestone = createMilestone({ isCompleted: true, isStarted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const reopenItem = items.find((el) => el.textContent?.includes("reopen"));
      fireEvent.click(reopenItem!);
      expect(cbs.onReopenMilestone).toHaveBeenCalledWith(milestone);
    });

    it("disables Reopen when parent is completed", () => {
      const milestone = createMilestone({
        isCompleted: true,
        isStarted: false,
        parentId: 10,
      });
      const cbs = mockCallbacks();
      cbs.isParentCompleted.mockReturnValue(true);
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const reopenItem = items.find((el) => el.textContent?.includes("reopen"));
      expect(reopenItem?.getAttribute("data-disabled")).toBe("true");
    });
  });

  describe("callback invocations", () => {
    it("calls onOpenEditModal when Edit is clicked", () => {
      const milestone = createMilestone({ isStarted: false, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const editItem = items.find((el) => el.textContent?.includes("edit"));
      fireEvent.click(editItem!);
      expect(cbs.onOpenEditModal).toHaveBeenCalledWith(milestone);
    });

    it("calls onOpenDeleteModal when Delete is clicked", () => {
      const milestone = createMilestone({ isStarted: false, isCompleted: false });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          {...cbs}
        />
      );

      const items = screen.getAllByTestId("dropdown-item");
      const deleteItem = items.find((el) => el.textContent?.includes("delete"));
      fireEvent.click(deleteItem!);
      expect(cbs.onOpenDeleteModal).toHaveBeenCalledWith(milestone);
    });
  });

  describe("level and compact props", () => {
    it("applies margin-left based on level prop", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      const { container } = render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          level={2}
          {...cbs}
        />
      );
      const card = container.firstChild as HTMLElement;
      expect(card.style.marginLeft).toBe("40px");
    });

    it("applies no margin-left when level=0 (default)", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      const { container } = render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          level={0}
          {...cbs}
        />
      );
      const card = container.firstChild as HTMLElement;
      expect(card.style.marginLeft).toBe("0px");
    });

    it("renders in compact mode without sm:grid classes", () => {
      const milestone = createMilestone();
      const cbs = mockCallbacks();
      const { container } = render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          compact={true}
          {...cbs}
        />
      );
      const card = container.firstChild as HTMLElement;
      // Compact mode removes sm:grid classes
      expect(card.className).not.toContain("sm:grid");
    });
  });

  describe("projectId prop", () => {
    it("renders with projectId when provided", () => {
      const milestone = createMilestone({ id: 5 });
      const cbs = mockCallbacks();
      render(
        <MilestoneItemCard
          milestone={milestone}
          session={adminSession}
          colorMap={mockColorMap}
          theme="light"
          projectId={42}
          {...cbs}
        />
      );
      const summary = screen.getByTestId("milestone-summary");
      expect(summary.getAttribute("data-milestone")).toBe("5");
    });
  });
});
