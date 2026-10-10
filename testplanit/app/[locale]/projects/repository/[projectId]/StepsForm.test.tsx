import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ZenStack hooks. useFindManySharedStepGroup is hoisted so tests can drive
// it via mockReturnValue (previously reached through await import("~/lib/hooks")).
const { useFindManySharedStepGroup } = vi.hoisted(() => ({
  useFindManySharedStepGroup: vi.fn(() => ({ data: [], isLoading: false })),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    sharedStepGroup: {
      useFindMany: useFindManySharedStepGroup,
      useCreate: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    },
    sharedStepItem: {
      useFindMany: vi.fn(() => ({ data: [], isLoading: false })),
      useCreateMany: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
    },
  }),
}));

// Mock the step layout preference so the layout under test is explicit.
const { stepLayoutState } = vi.hoisted(() => ({
  stepLayoutState: { layout: "STACKED" as "STACKED" | "SIDE_BY_SIDE" },
}));
vi.mock("~/hooks/useStepLayout", () => ({
  useStepLayout: () => ({
    layout: stepLayoutState.layout,
    isSideBySide: stepLayoutState.layout === "SIDE_BY_SIDE",
    toggleLayout: vi.fn(),
    setLayout: vi.fn(),
  }),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useParams: vi.fn(() => ({ projectId: "1" })),
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: {
      user: {
        id: "user-123",
        name: "Test User",
        email: "test@example.com",
      },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: vi.fn((namespace) => {
    return (key: string, values?: any) => {
      const fullKey = namespace ? `${namespace}.${key}` : key;
      let result = `[t]${fullKey}`;
      if (values) {
        result += ` ${JSON.stringify(values)}`;
      }
      return result;
    };
  }),
  useLocale: vi.fn(() => "en-US"),
}));

// Mock sonner
vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock TipTapEditor
vi.mock("@/components/tiptap/TipTapEditor", () => ({
  default: vi.fn(
    ({ content, readOnly }: { content?: any; readOnly?: boolean }) => (
      <div
        data-testid="tiptap-editor"
        data-content={JSON.stringify(content)}
        data-readonly={readOnly ? "true" : "false"}
      >
        TipTapEditor
      </div>
    )
  ),
}));

// Mock AsyncCombobox
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: vi.fn(({ placeholder }: { placeholder?: string }) => (
    <div data-testid="async-combobox">{placeholder || "Combobox"}</div>
  )),
}));

// Mock @dnd-kit/core
vi.mock("@dnd-kit/core", () => ({
  DndContext: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="dnd-context">{children}</div>
  )),
  closestCenter: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

// Mock @dnd-kit/sortable
vi.mock("@dnd-kit/sortable", () => ({
  SortableContext: vi.fn(({ children }: { children: React.ReactNode }) => (
    <div data-testid="sortable-context">{children}</div>
  )),
  verticalListSortingStrategy: {},
  useSortable: vi.fn(() => ({
    attributes: {},
    listeners: {},
    setNodeRef: vi.fn(),
    transform: null,
    transition: null,
    isDragging: false,
  })),
}));

// Mock @dnd-kit/modifiers
vi.mock("@dnd-kit/modifiers", () => ({
  restrictToVerticalAxis: vi.fn(),
}));

// Mock react-hook-form
const mockAppend = vi.fn();
const mockRemove = vi.fn();
const mockMove = vi.fn();
const mockReplace = vi.fn();
const mockSetValue = vi.fn();

let mockFields: any[] = [];

vi.mock("react-hook-form", async (importOriginal) => {
  const original = await importOriginal<typeof import("react-hook-form")>();
  return {
    ...original,
    useFormContext: vi.fn(() => ({
      setValue: mockSetValue,
      getValues: vi.fn(() => ({})),
      getFieldState: vi.fn(() => ({
        invalid: false,
        isDirty: false,
        isTouched: false,
        isValidating: false,
        error: undefined,
      })),
      formState: { errors: {}, isSubmitting: false },
      control: {},
    })),
    useFieldArray: vi.fn(() => ({
      fields: mockFields,
      append: mockAppend,
      remove: mockRemove,
      move: mockMove,
      replace: mockReplace,
      update: vi.fn(),
    })),
  };
});

import React from "react";
import StepsForm from "./StepsForm";

beforeAll(() => {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = vi.fn();
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = vi.fn();
  }
});

describe("StepsForm", () => {
  const defaultProps = {
    control: {} as any,
    name: "steps",
    projectId: 1,
  };

  beforeEach(() => {
    mockFields = [];
    stepLayoutState.layout = "STACKED";
    mockAppend.mockClear();
    mockRemove.mockClear();
    mockReplace.mockClear();
  });

  describe("step layout", () => {
    const twoSteps = [
      { id: "step-1", step: null, expectedResult: null, isShared: false },
      { id: "step-2", step: null, expectedResult: null, isShared: false },
    ];

    it("stacks the step editor over the expected result editor by default", () => {
      mockFields = twoSteps;

      render(<StepsForm {...defaultProps} />);

      expect(screen.getByTestId("steps-form")).toHaveAttribute(
        "data-step-layout",
        "STACKED"
      );
      const [stepEditor] = screen
        .getByTestId("step-editor-0")
        .querySelectorAll('[data-testid="tiptap-editor"]');
      const pair = stepEditor.closest(".flex-col.w-full")!;
      expect(pair).not.toHaveClass("@2xl:grid-cols-2");
    });

    it("puts the two editors in columns when the user chose side by side", () => {
      stepLayoutState.layout = "SIDE_BY_SIDE";
      mockFields = twoSteps;

      render(<StepsForm {...defaultProps} />);

      expect(screen.getByTestId("steps-form")).toHaveAttribute(
        "data-step-layout",
        "SIDE_BY_SIDE"
      );
      const [stepEditor, expectedEditor] = screen
        .getByTestId("step-editor-0")
        .querySelectorAll('[data-testid="tiptap-editor"]');
      const pair = stepEditor.closest(".grid")!;
      expect(pair).toHaveClass("grid-cols-1", "@2xl:grid-cols-2");
      expect(pair).toContainElement(expectedEditor as HTMLElement);
      expect(screen.getByTestId("step-layout-toggle")).toHaveAttribute(
        "aria-pressed",
        "true"
      );
    });

    it("moves the expected result label into the step header when side by side", () => {
      stepLayoutState.layout = "SIDE_BY_SIDE";
      mockFields = twoSteps;

      render(<StepsForm {...defaultProps} />);

      const card = screen
        .getByTestId("step-editor-0")
        .querySelector(".bg-muted")!;
      const labels = [...card.querySelectorAll("label")].filter((label) =>
        label.textContent?.includes("common.fields.expectedResult")
      );
      expect(labels).toHaveLength(2);
      const [headerLabel, boxLabel] = labels;
      // Wide containers show the header copy over the right column; the copy
      // inside the box only shows while the layout falls back to stacked.
      expect(headerLabel).toHaveClass("hidden", "@2xl:flex");
      expect(headerLabel.parentElement).toContainElement(
        screen.getByTestId("delete-step-0")
      );
      expect(boxLabel).toHaveClass("@2xl:hidden");
      expect(boxLabel.closest(".ring-2")).toContainElement(
        card.querySelectorAll('[data-testid="tiptap-editor"]')[1] as HTMLElement
      );
    });

    it("keeps the expected result label inside its box when stacked", () => {
      mockFields = twoSteps;

      render(<StepsForm {...defaultProps} />);

      const card = screen
        .getByTestId("step-editor-0")
        .querySelector(".bg-muted")!;
      const labels = [...card.querySelectorAll("label")].filter((label) =>
        label.textContent?.includes("common.fields.expectedResult")
      );
      expect(labels).toHaveLength(1);
      expect(labels[0]).not.toHaveClass("@2xl:hidden");
      expect(labels[0].closest(".ring-2")).not.toBeNull();
    });

    it("offers the toggle only once there is a step to lay out", () => {
      mockFields = [];
      const { rerender } = render(<StepsForm {...defaultProps} />);
      expect(screen.queryByTestId("step-layout-toggle")).toBeNull();

      mockFields = twoSteps;
      rerender(<StepsForm {...defaultProps} />);
      expect(screen.getByTestId("step-layout-toggle")).toBeInTheDocument();
    });

    it("lets step cards grow to the available width", () => {
      mockFields = twoSteps;

      render(<StepsForm {...defaultProps} />);

      const card = screen
        .getByTestId("step-editor-0")
        .querySelector(".bg-muted")!;
      expect(card).toHaveClass("w-full");
      expect(card.className).not.toContain("min-w-[650px]");
    });
  });

  it("renders empty state when no steps exist with add step button", () => {
    mockFields = [];

    render(<StepsForm {...defaultProps} />);

    // Should show the steps form container
    expect(screen.getByTestId("steps-form")).toBeInTheDocument();

    // Should show add step button
    expect(screen.getByTestId("add-step-button")).toBeInTheDocument();
  });

  it("renders list of steps with step editors", () => {
    mockFields = [
      { id: "step-1", step: null, expectedResult: null, isShared: false },
      { id: "step-2", step: null, expectedResult: null, isShared: false },
    ];

    render(<StepsForm {...defaultProps} />);

    // Should show both step editors
    expect(screen.getByTestId("step-editor-0")).toBeInTheDocument();
    expect(screen.getByTestId("step-editor-1")).toBeInTheDocument();
  });

  it("calls append when add step button is clicked", async () => {
    mockFields = [];
    const user = userEvent.setup();

    render(<StepsForm {...defaultProps} />);

    const addButton = screen.getByTestId("add-step-button");
    await user.click(addButton);

    expect(mockAppend).toHaveBeenCalledOnce();
  });

  it("renders delete button for each step when not readOnly", () => {
    mockFields = [
      { id: "step-1", step: null, expectedResult: null, isShared: false },
    ];

    render(<StepsForm {...defaultProps} readOnly={false} />);

    // Delete button should be present (with testid delete-step-0)
    expect(screen.getByTestId("delete-step-0")).toBeInTheDocument();
  });

  it("hides add/delete buttons in readOnly mode", () => {
    mockFields = [
      { id: "step-1", step: null, expectedResult: null, isShared: false },
    ];

    render(<StepsForm {...defaultProps} readOnly={true} />);

    // Add step button should not be present in readOnly mode
    expect(screen.queryByTestId("add-step-button")).not.toBeInTheDocument();

    // Delete button should not be present in readOnly mode
    expect(screen.queryByTestId("delete-step-0")).not.toBeInTheDocument();
  });

  it("renders shared step groups in combobox when available", async () => {
    useFindManySharedStepGroup.mockReturnValue({
      data: [
        { id: 1, name: "Shared Group 1", projectId: 1 } as any,
        { id: 2, name: "Shared Group 2", projectId: 1 } as any,
      ],
      isLoading: false,
    } as any);

    mockFields = [];

    render(<StepsForm {...defaultProps} />);

    // Add shared steps button should be present
    // (hideSharedStepsButtons is false by default)
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("hides shared step buttons when hideSharedStepsButtons is true", () => {
    mockFields = [];

    render(<StepsForm {...defaultProps} hideSharedStepsButtons={true} />);

    // "Add Shared Steps" and "Create Shared Steps" buttons should be hidden
    const addStepButton = screen.getByTestId("add-step-button");
    expect(addStepButton).toBeInTheDocument();

    // Only the add step button should be visible (not shared step buttons)
    const buttons = screen.getAllByRole("button");
    // Should only have the add-step-button visible
    expect(buttons.length).toBe(1);
  });

  it("renders shared step group placeholder differently from regular step", () => {
    mockFields = [
      {
        id: "shared-1-123",
        isShared: true,
        sharedStepGroupId: 1,
        sharedStepGroupName: "My Shared Group",
        step: null,
        expectedResult: null,
      },
    ];

    render(<StepsForm {...defaultProps} />);

    // Shared step group should show group name label
    expect(screen.getByText(/My Shared Group/)).toBeInTheDocument();
  });
});
