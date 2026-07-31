import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) => {
    const fullKey = namespace ? `${namespace}.${key}` : key;
    const map: Record<string, string> = {
      "common.labels.noResults": "No Results",
      "common.actions.previous": "Previous",
      "common.actions.next": "Next",
      "common.actions.selectAll": "Select All",
      "common.search": "Search",
      "common.placeholders.selectConfigurations": "Select",
    };
    return map[fullKey] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

import { MultiAsyncCombobox } from "./multi-async-combobox";

interface Option {
  id: number;
  label: string;
}

const makeOptions = (count: number): Option[] =>
  Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    label: `Item ${i + 1}`,
  }));

describe("MultiAsyncCombobox trigger loading state", () => {
  it("swaps the chevron for a spinner while options load, then restores it", async () => {
    let resolveFetch!: (options: Option[]) => void;
    const pending = new Promise<Option[]>((resolve) => {
      resolveFetch = resolve;
    });
    render(
      <MultiAsyncCombobox<Option>
        value={[]}
        onValueChange={vi.fn()}
        fetchOptions={() => pending}
        renderOption={(option) => <span>{option.label}</span>}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.label}
        placeholder="Search"
      />
    );

    // Closed and idle: no spinner on the trigger.
    expect(
      screen.queryByTestId("multi-async-combobox-trigger-spinner")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox"));

    await waitFor(() => {
      expect(
        screen.getByTestId("multi-async-combobox-trigger-spinner")
      ).toBeInTheDocument();
    });

    resolveFetch(makeOptions(3));

    await waitFor(() => {
      expect(
        screen.queryByTestId("multi-async-combobox-trigger-spinner")
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText("Item 1")).toBeInTheDocument();
  });
});
