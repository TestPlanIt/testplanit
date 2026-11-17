import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdateResultField } = vi.hoisted(() => ({
  mockUpdateResultField: vi.fn(),
}));

const NUMBER_TYPE = {
  id: 3,
  type: "Number",
  options: {
    specificOptions: [
      { key: "minValue", displayName: "Min" },
      { key: "maxValue", displayName: "Max" },
    ],
  },
};

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    caseFields: { useFindMany: () => ({ data: [] }) },
    resultFields: {
      useUpdate: () => ({ mutateAsync: mockUpdateResultField }),
      useFindMany: () => ({ data: [] }),
    },
    fieldOptions: {
      useCreate: () => ({ mutateAsync: vi.fn() }),
      useUpdate: () => ({ mutateAsync: vi.fn() }),
      useUpdateMany: () => ({ mutateAsync: vi.fn() }),
    },
    caseFieldTypes: { useFindMany: () => ({ data: [NUMBER_TYPE] }) },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/ui/help-popover", () => ({ HelpPopover: () => null }));
vi.mock("@/components/tiptap/TipTapEditor", () => ({ default: () => null }));
vi.mock("@/components/DraggableFieldOptions", () => ({
  DraggableList: () => null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
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

import { EditResultField } from "./EditResultField";

function numberField(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    displayName: "Score",
    systemName: "score",
    hint: "",
    isEnabled: true,
    isRequired: false,
    isRestricted: false,
    isChecked: false,
    defaultValue: null,
    minValue: 0,
    maxValue: 100,
    initialHeight: null,
    typeId: NUMBER_TYPE.id,
    type: { id: NUMBER_TYPE.id, type: NUMBER_TYPE.type },
    fieldOptions: [],
    templates: [],
    ...overrides,
  } as any;
}

const submit = () =>
  fireEvent.click(screen.getByTestId("result-field-submit-button"));

describe("EditResultField — numeric range round-trips zero", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateResultField.mockResolvedValue({ id: 11 });
  });

  it("keeps an existing minimum of 0 when the field is saved", async () => {
    render(
      <EditResultField
        resultfield={numberField()}
        open={true}
        onClose={() => {}}
      />
    );

    expect((screen.getByLabelText("Min") as HTMLInputElement).value).toBe("0");
    submit();

    await waitFor(() => expect(mockUpdateResultField).toHaveBeenCalledTimes(1));
    const data = mockUpdateResultField.mock.calls[0][0].data;
    expect(data.minValue).toBe(0);
    expect(data.maxValue).toBe(100);
  });

  it("saves a minimum typed as 0", async () => {
    render(
      <EditResultField
        resultfield={numberField({ minValue: 5 })}
        open={true}
        onClose={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Min"), { target: { value: "0" } });
    submit();

    await waitFor(() => expect(mockUpdateResultField).toHaveBeenCalledTimes(1));
    expect(mockUpdateResultField.mock.calls[0][0].data.minValue).toBe(0);
  });

  it("still clears the range when both inputs are emptied", async () => {
    render(
      <EditResultField
        resultfield={numberField()}
        open={true}
        onClose={() => {}}
      />
    );

    fireEvent.change(screen.getByLabelText("Min"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Max"), { target: { value: "" } });
    submit();

    await waitFor(() => expect(mockUpdateResultField).toHaveBeenCalledTimes(1));
    const data = mockUpdateResultField.mock.calls[0][0].data;
    expect(data.minValue).toBeNull();
    expect(data.maxValue).toBeNull();
  });
});
