import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace?: string) => (key: string, params?: Record<string, unknown>) => {
      const parameters: Record<string, string> = {
        chooserTitle: "Insert parameter",
        chooserDescription:
          "Choose a parameter to insert at the cursor position.",
        chooserSearchPlaceholder: "Search parameters...",
        chooserEmpty: "No parameters declared yet.",
        chooserConfigureLink: "Configure parameters",
      };
      const common: Record<string, string> = { cancel: "Cancel" };
      const dict = namespace === "common" ? common : parameters;
      let value = dict[key] ?? key;
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          value = value.replace(`{${k}}`, String(v));
        });
      }
      return value;
    },
}));

import { ParameterChooserDialog } from "@/components/tiptap/ParameterChooserDialog";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

const ITEMS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
  { id: 2, name: "userAge", type: "INTEGER", defaultValue: "30" },
  { id: 3, name: "env", type: "SELECT", defaultValue: null },
];

describe("ParameterChooserDialog", () => {
  it("renders title, description, and dialog testid when open", () => {
    render(
      <ParameterChooserDialog
        open
        onOpenChange={vi.fn()}
        parameters={ITEMS}
        onPick={vi.fn()}
      />
    );
    expect(screen.getByTestId("parameter-chooser-dialog")).toBeInTheDocument();
    expect(screen.getByText("Insert parameter")).toBeInTheDocument();
    expect(
      screen.getByText("Choose a parameter to insert at the cursor position.")
    ).toBeInTheDocument();
  });

  it("renders search input with placeholder and the testid", () => {
    render(
      <ParameterChooserDialog
        open
        onOpenChange={vi.fn()}
        parameters={ITEMS}
        onPick={vi.fn()}
      />
    );
    const input = screen.getByTestId(
      "parameter-chooser-search-input"
    ) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    expect(input.placeholder).toBe("Search parameters...");
  });

  it("renders one item per parameter with name and type", () => {
    render(
      <ParameterChooserDialog
        open
        onOpenChange={vi.fn()}
        parameters={ITEMS}
        onPick={vi.fn()}
      />
    );
    expect(screen.getByTestId("parameter-chooser-item-username")).toBeVisible();
    expect(screen.getByTestId("parameter-chooser-item-userAge")).toBeVisible();
    expect(screen.getByTestId("parameter-chooser-item-env")).toBeVisible();
    expect(screen.getByText("STRING")).toBeInTheDocument();
    expect(screen.getByText("INTEGER")).toBeInTheDocument();
    expect(screen.getByText("SELECT")).toBeInTheDocument();
  });

  it("filters items by case-insensitive prefix match against name", () => {
    render(
      <ParameterChooserDialog
        open
        onOpenChange={vi.fn()}
        parameters={ITEMS}
        onPick={vi.fn()}
      />
    );
    const input = screen.getByTestId(
      "parameter-chooser-search-input"
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "User" } });
    // Both `username` and `userAge` start with "user" (case-insensitive).
    expect(screen.getByTestId("parameter-chooser-item-username")).toBeVisible();
    expect(screen.getByTestId("parameter-chooser-item-userAge")).toBeVisible();
    expect(
      screen.queryByTestId("parameter-chooser-item-env")
    ).not.toBeInTheDocument();
  });

  it("calls onPick(parameter) and onOpenChange(false) when an item is clicked", () => {
    const onPick = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ParameterChooserDialog
        open
        onOpenChange={onOpenChange}
        parameters={ITEMS}
        onPick={onPick}
      />
    );
    fireEvent.click(screen.getByTestId("parameter-chooser-item-userAge"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("renders empty-state copy + Configure link when parameters list is empty", () => {
    const onOpenChange = vi.fn();
    const onOpenSheet = vi.fn();
    render(
      <ParameterChooserDialog
        open
        onOpenChange={onOpenChange}
        parameters={[]}
        onPick={vi.fn()}
        onOpenSheet={onOpenSheet}
      />
    );
    expect(screen.getByTestId("parameter-chooser-empty")).toBeInTheDocument();
    expect(screen.getByText("No parameters declared yet.")).toBeInTheDocument();
    const configureLink = screen.getByText("Configure parameters");
    fireEvent.click(configureLink);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onOpenSheet).toHaveBeenCalledTimes(1);
  });
});
