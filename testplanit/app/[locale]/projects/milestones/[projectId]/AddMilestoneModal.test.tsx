import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindManyTypes, mockCreateMilestone } = vi.hoisted(() => ({
  mockFindManyTypes: vi.fn(),
  mockCreateMilestone: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestoneTypes: { useFindMany: () => mockFindManyTypes() },
    milestones: {
      useFindMany: () => ({ data: [], isLoading: false }),
      useCreate: () => ({ mutateAsync: mockCreateMilestone }),
    },
  }),
}));

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { id: "user-1", access: "ADMIN" } } }),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ projectId: "7" }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/tiptap/TipTapEditor", () => ({ default: () => null }));
vi.mock("@/components/forms/DatePickerField", () => ({
  DatePickerField: () => null,
}));
vi.mock("@/components/forms/MilestoneSelect", () => ({
  MilestoneSelect: () => null,
  transformMilestones: () => [],
}));
vi.mock("@/components/DynamicIcon", () => ({ default: () => null }));
vi.mock("@/components/ui/help-popover", () => ({ HelpPopover: () => null }));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

// Radix Select needs pointer APIs jsdom lacks; a context-backed stub keeps
// the selected value observable and lets a test pick an option by clicking.
vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  const Ctx = ReactModule.createContext<{
    onValueChange?: (v: string) => void;
  }>({});
  return {
    Select: ({ children, value, onValueChange }: any) => (
      <Ctx.Provider value={{ onValueChange }}>
        <div data-testid="type-select" data-value={value}>
          {children}
        </div>
      </Ctx.Provider>
    ),
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectGroup: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => {
      const { onValueChange } = ReactModule.useContext(Ctx);
      return (
        <button
          type="button"
          data-testid={`type-option-${value}`}
          onClick={() => onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
  };
});

import { AddMilestone } from "./AddMilestoneModal";

const makeType = (id: number, isDefault = false) => ({
  id,
  name: `Type ${id}`,
  isDefault,
  icon: null,
});

const saveButton = () => screen.getByRole("button", { name: /save/i });

describe("AddMilestone — milestone type gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMilestone.mockResolvedValue({ id: 99 });
  });

  it("keeps Save enabled when none of the project's types is the default", () => {
    mockFindManyTypes.mockReturnValue({
      data: [makeType(1), makeType(2)],
      isLoading: false,
    });

    render(<AddMilestone open={true} onClose={() => {}} />);

    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("add-milestone-no-types-alert")).toBeNull();
    // Nothing is pre-selected when there is no default to fall back on.
    expect(screen.getByTestId("type-select").getAttribute("data-value")).toBe(
      ""
    );
  });

  it("saves with the type the user picks when there is no default", async () => {
    mockFindManyTypes.mockReturnValue({
      data: [makeType(1), makeType(2)],
      isLoading: false,
    });

    render(<AddMilestone open={true} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("common.name"), {
      target: { value: "Sprint 1" },
    });
    fireEvent.click(screen.getByTestId("type-option-2"));
    fireEvent.click(saveButton());

    await waitFor(() => expect(mockCreateMilestone).toHaveBeenCalledTimes(1));
    expect(mockCreateMilestone.mock.calls[0][0].data.milestoneType).toEqual({
      connect: { id: 2 },
    });
  });

  it("pre-selects the default type when the project has one", () => {
    mockFindManyTypes.mockReturnValue({
      data: [makeType(1), makeType(2, true)],
      isLoading: false,
    });

    render(<AddMilestone open={true} onClose={() => {}} />);

    expect(screen.getByTestId("type-select").getAttribute("data-value")).toBe(
      "2"
    );
  });

  it("pre-selects the only available type when there is no default", () => {
    mockFindManyTypes.mockReturnValue({
      data: [makeType(5)],
      isLoading: false,
    });

    render(<AddMilestone open={true} onClose={() => {}} />);

    expect(screen.getByTestId("type-select").getAttribute("data-value")).toBe(
      "5"
    );
  });

  it("explains and blocks Save when the project has no milestone types at all", () => {
    mockFindManyTypes.mockReturnValue({ data: [], isLoading: false });

    render(<AddMilestone open={true} onClose={() => {}} />);

    expect(screen.getByTestId("add-milestone-no-types-alert")).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not show the no-types notice while the types are still loading", () => {
    mockFindManyTypes.mockReturnValue({ data: undefined, isLoading: true });

    render(<AddMilestone open={true} onClose={() => {}} />);

    expect(screen.queryByTestId("add-milestone-no-types-alert")).toBeNull();
  });
});
