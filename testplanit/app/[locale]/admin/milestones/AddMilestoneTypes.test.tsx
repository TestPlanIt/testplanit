import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindFirstDefault, mockCreateType, mockCreateManyAssignment } =
  vi.hoisted(() => ({
    mockFindFirstDefault: vi.fn(),
    mockCreateType: vi.fn(),
    mockCreateManyAssignment: vi.fn(),
  }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    milestoneTypes: {
      useFindFirst: () => mockFindFirstDefault(),
      useCreate: () => ({ mutateAsync: mockCreateType }),
    },
    milestoneTypesAssignment: {
      useCreateMany: () => ({ mutateAsync: mockCreateManyAssignment }),
    },
    projects: {
      useFindMany: () => ({ data: [{ id: 1 }, { id: 2 }], isLoading: false }),
    },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/FieldIconPicker", () => ({
  FieldIconPicker: () => null,
}));
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

import { AddMilestoneType } from "./AddMilestoneTypes";

const defaultSwitch = () => screen.getByRole("switch") as HTMLButtonElement;

describe("AddMilestoneType — first default guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateType.mockResolvedValue({ id: 42 });
    mockCreateManyAssignment.mockResolvedValue({ count: 2 });
  });

  it("locks the switch on and warns when no default type exists", () => {
    mockFindFirstDefault.mockReturnValue({ data: null, isLoading: false });

    render(<AddMilestoneType open={true} onClose={() => {}} />);

    expect(defaultSwitch().getAttribute("aria-checked")).toBe("true");
    expect(defaultSwitch().disabled).toBe(true);
    expect(
      screen.getByTestId("milestone-type-first-default-warning")
    ).toBeTruthy();
  });

  it("creates the type as the default and assigns it to every project", async () => {
    mockFindFirstDefault.mockReturnValue({ data: null, isLoading: false });

    render(<AddMilestoneType open={true} onClose={() => {}} />);

    fireEvent.change(screen.getByPlaceholderText("name"), {
      target: { value: "Release" },
    });
    fireEvent.click(screen.getByRole("button", { name: "actions.submit" }));

    await waitFor(() => expect(mockCreateType).toHaveBeenCalledTimes(1));
    expect(mockCreateType.mock.calls[0][0].data.isDefault).toBe(true);
    await waitFor(() =>
      expect(mockCreateManyAssignment).toHaveBeenCalledTimes(1)
    );
    expect(mockCreateManyAssignment.mock.calls[0][0].data).toEqual([
      { projectId: 1, milestoneTypeId: 42 },
      { projectId: 2, milestoneTypeId: 42 },
    ]);
  });

  it("leaves the switch free when a default type already exists", () => {
    mockFindFirstDefault.mockReturnValue({
      data: { id: 1, isDefault: true },
      isLoading: false,
    });

    render(<AddMilestoneType open={true} onClose={() => {}} />);

    expect(defaultSwitch().getAttribute("aria-checked")).toBe("false");
    expect(defaultSwitch().disabled).toBe(false);
    expect(
      screen.queryByTestId("milestone-type-first-default-warning")
    ).toBeNull();
  });

  it("does not lock the switch while the default lookup is still loading", () => {
    mockFindFirstDefault.mockReturnValue({ data: undefined, isLoading: true });

    render(<AddMilestoneType open={true} onClose={() => {}} />);

    expect(defaultSwitch().disabled).toBe(false);
    expect(
      screen.queryByTestId("milestone-type-first-default-warning")
    ).toBeNull();
  });
});
