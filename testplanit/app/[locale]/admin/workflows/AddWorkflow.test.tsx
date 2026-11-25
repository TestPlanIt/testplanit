import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkflow, mockCreateManyAssignment } = vi.hoisted(() => ({
  mockCreateWorkflow: vi.fn(),
  mockCreateManyAssignment: vi.fn(),
}));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    fieldIcon: { useFindFirst: () => ({ data: { id: 1 } }) },
    color: { useFindFirst: () => ({ data: { id: 1 } }) },
    workflows: {
      useCreate: () => ({ mutateAsync: mockCreateWorkflow }),
      // A default already exists for every scope, so the dialog does not
      // force the new state to be the default (which would lock Enabled on).
      useFindMany: () => ({
        data: [{ scope: "CASES" }, { scope: "RUNS" }, { scope: "SESSIONS" }],
        isLoading: false,
      }),
    },
    projectWorkflowAssignment: {
      useCreateMany: () => ({ mutateAsync: mockCreateManyAssignment }),
    },
    projects: { useFindMany: () => ({ data: [] }) },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("~/hooks/useReviewFeatureEnabled", () => ({
  useReviewFeatureEnabled: () => ({ systemEnabled: false }),
}));
const aiModel = vi.hoisted(() => ({ active: true }));
vi.mock("~/hooks/useHasActiveAiModel", () => ({
  useHasActiveAiModel: () => aiModel.active,
}));

vi.mock("@/components/FieldIconPicker", () => ({
  FieldIconPicker: () => null,
}));
vi.mock("@/components/ui/help-popover", () => ({ HelpPopover: () => null }));
vi.mock("@/components/ui/multi-async-combobox", () => ({
  MultiAsyncCombobox: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const SelectContext = React.createContext<{
    value?: string;
    onValueChange?: (value: string) => void;
  }>({});
  return {
    Select: ({ value, onValueChange, children }: any) => (
      <SelectContext.Provider value={{ value, onValueChange }}>
        {children}
      </SelectContext.Provider>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectGroup: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ value, children }: any) => {
      const select = React.useContext(SelectContext);
      return (
        <button
          type="button"
          role="option"
          aria-selected={select.value === value}
          onClick={() => select.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
  };
});

import { AddWorkflows } from "./AddWorkflow";

// Switch order in the form: Default, then Enabled.
const enabledSwitch = () =>
  screen.getAllByRole("switch")[1] as HTMLButtonElement;

async function fillRequiredFields(name: string) {
  fireEvent.change(screen.getByPlaceholderText("name"), {
    target: { value: name },
  });
  fireEvent.click(screen.getByRole("option", { name: "NOT_STARTED" }));
}

describe("AddWorkflows — enabled flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWorkflow.mockResolvedValue({ id: 7 });
    mockCreateManyAssignment.mockResolvedValue({ count: 0 });
  });

  it("creates the state disabled when Enabled is switched off", async () => {
    render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="CASES" />
    );

    await fillRequiredFields("Blocked");
    expect(enabledSwitch().getAttribute("aria-checked")).toBe("true");
    fireEvent.click(enabledSwitch());
    expect(enabledSwitch().getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "actions.submit" }));

    await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));
    expect(mockCreateWorkflow.mock.calls[0][0].data.isEnabled).toBe(false);
  });

  it("creates the state enabled by default", async () => {
    render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="CASES" />
    );

    await fillRequiredFields("Ready");
    fireEvent.click(screen.getByRole("button", { name: "actions.submit" }));

    await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));
    expect(mockCreateWorkflow.mock.calls[0][0].data.isEnabled).toBe(true);
  });
});

describe("AddWorkflows — AI drafts flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateWorkflow.mockResolvedValue({ id: 7 });
    mockCreateManyAssignment.mockResolvedValue({ count: 0 });
  });

  const aiSwitch = () => screen.queryByTestId("add-ai-draft-switch");
  const submit = () =>
    fireEvent.click(screen.getByRole("button", { name: "actions.submit" }));

  it("creates a case state that holds AI drafts when the switch is on", async () => {
    render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="CASES" />
    );
    await fillRequiredFields("AI-Generated");
    fireEvent.click(aiSwitch()!);
    submit();

    await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));
    expect(mockCreateWorkflow.mock.calls[0][0].data).toMatchObject({
      name: "AI-Generated",
      scope: "CASES",
      isAiDraft: true,
      isDefault: false,
      order: 0,
    });
  });

  it("leaves the flag off unless it is switched on", async () => {
    render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="CASES" />
    );
    await fillRequiredFields("Ready");
    submit();

    await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));
    expect(mockCreateWorkflow.mock.calls[0][0].data.isAiDraft).toBe(false);
    expect(mockCreateWorkflow.mock.calls[0][0].data).not.toHaveProperty(
      "order"
    );
  });

  it("hides the switch until an AI model is active", () => {
    aiModel.active = false;
    try {
      render(
        <AddWorkflows open={true} onClose={() => {}} defaultScope="CASES" />
      );
      expect(aiSwitch()).toBeNull();
    } finally {
      aiModel.active = true;
    }
  });

  it("offers the switch for test case states only", () => {
    const { unmount } = render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="RUNS" />
    );
    expect(aiSwitch()).toBeNull();
    unmount();
    render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="SESSIONS" />
    );
    expect(aiSwitch()).toBeNull();
  });

  it("switches the flag off and locks it when the state is made the default", async () => {
    render(
      <AddWorkflows open={true} onClose={() => {}} defaultScope="CASES" />
    );
    await fillRequiredFields("Draft");
    fireEvent.click(aiSwitch()!);
    expect(aiSwitch()!.getAttribute("aria-checked")).toBe("true");

    // Default is the first switch in the form.
    fireEvent.click(screen.getAllByRole("switch")[0]);
    expect(aiSwitch()!.getAttribute("aria-checked")).toBe("false");
    expect(aiSwitch()).toBeDisabled();
    expect(
      screen.getByText("editWorkflow.aiDraftDefaultDisabled")
    ).toBeInTheDocument();
    submit();

    await waitFor(() => expect(mockCreateWorkflow).toHaveBeenCalledTimes(1));
    expect(mockCreateWorkflow.mock.calls[0][0].data).toMatchObject({
      isDefault: true,
      isAiDraft: false,
    });
  });
});
