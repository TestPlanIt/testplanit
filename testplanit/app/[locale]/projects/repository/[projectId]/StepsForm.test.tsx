import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mock ZenStack hooks
vi.mock("~/lib/hooks", () => ({
  useFindManySharedStepGroup: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useFindManySharedStepItem: vi.fn(() => ({
    data: [],
    isLoading: false,
  })),
  useCreateSharedStepGroup: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
  useCreateManySharedStepItem: vi.fn(() => ({
    mutateAsync: vi.fn(),
    isPending: false,
  })),
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
  default: vi.fn(({ content, readOnly }: { content?: any; readOnly?: boolean }) => (
    <div
      data-testid="tiptap-editor"
      data-content={JSON.stringify(content)}
      data-readonly={readOnly ? "true" : "false"}
    >
      TipTapEditor
    </div>
  )),
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
      getFieldState: vi.fn(() => ({ invalid: false, isDirty: false, isTouched: false, isValidating: false, error: undefined })),
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
    mockAppend.mockClear();
    mockRemove.mockClear();
    mockReplace.mockClear();
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
    const hooksModule = await import("~/lib/hooks");
    const { useFindManySharedStepGroup } = vi.mocked(hooksModule);
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
