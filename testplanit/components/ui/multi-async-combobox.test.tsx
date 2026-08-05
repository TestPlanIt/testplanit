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
      "common.actions.clearAll": "Clear All",
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

describe("MultiAsyncCombobox selection toolbar", () => {
  const renderCombobox = (
    props: Partial<React.ComponentProps<typeof MultiAsyncCombobox<Option>>> = {}
  ) =>
    render(
      <MultiAsyncCombobox<Option>
        value={[]}
        onValueChange={vi.fn()}
        fetchOptions={async () => makeOptions(3)}
        renderOption={(option) => <span>{option.label}</span>}
        getOptionValue={(option) => option.id}
        getOptionLabel={(option) => option.label}
        placeholder="Search"
        {...props}
      />
    );

  it("clears every selection when Clear All is clicked", async () => {
    const onValueChange = vi.fn();
    renderCombobox({ value: makeOptions(2), onValueChange });

    fireEvent.click(screen.getByRole("combobox"));

    fireEvent.click(
      await screen.findByTestId("multi-async-combobox-clear-all")
    );

    expect(onValueChange).toHaveBeenCalledWith([]);
  });

  it("offers no Clear All while nothing is selected", async () => {
    renderCombobox();

    fireEvent.click(screen.getByRole("combobox"));

    expect(await screen.findByText("Item 1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("multi-async-combobox-clear-all")
    ).not.toBeInTheDocument();
  });

  it("selects every match — not just the page on screen — from Select All", async () => {
    const onValueChange = vi.fn();
    const all = makeOptions(25);
    renderCombobox({
      onValueChange,
      pageSize: 10,
      fetchOptions: async (_query, page, pageSize) => ({
        results: all.slice(page * pageSize, (page + 1) * pageSize),
        total: all.length,
      }),
    });

    fireEvent.click(screen.getByRole("combobox"));

    fireEvent.click(await screen.findByText(/Select All/));

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith(all);
    });
  });
});
