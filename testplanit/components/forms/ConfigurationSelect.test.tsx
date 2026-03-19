import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock next-intl (global mock from setup handles this, but we add translations for this component)
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const map: Record<string, string> = {
      "access.none": "None",
    };
    // Return last segment for unknown keys (consistent with existing tests)
    return map[key] ?? key.split(".").pop() ?? key;
  },
  useLocale: () => "en-US",
}));

// Mock ~/lib/hooks
const mockUseFindFirstConfigurations = vi.fn();
vi.mock("~/lib/hooks", () => ({
  useFindFirstConfigurations: (...args: any[]) => mockUseFindFirstConfigurations(...args),
}));

// Mock searchConfigurations server action
vi.mock("~/app/actions/searchConfigurations", () => ({
  searchConfigurations: vi.fn().mockResolvedValue({ options: [], total: 0 }),
}));

// Mock AsyncCombobox — renders a simplified select that calls onValueChange
const mockAsyncComboboxOnValueChange = vi.fn();
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: ({
    value,
    onValueChange,
    placeholder,
    disabled,
    showUnassigned,
    unassignedLabel,
  }: any) => {
    // Store the callback for test use
    mockAsyncComboboxOnValueChange.mockImplementation(onValueChange);
    return (
      <div data-testid="async-combobox" data-disabled={disabled}>
        <span data-testid="combobox-value">
          {value ? value.name : placeholder || ""}
        </span>
        {showUnassigned && (
          <button
            data-testid="unassigned-option"
            onClick={() => onValueChange(null)}
          >
            {unassignedLabel}
          </button>
        )}
        <button
          data-testid="combobox-trigger"
          disabled={disabled}
          onClick={() => {
            /* simulates selection of first option */
            onValueChange({ id: 42, name: "Test Config" });
          }}
        >
          Select
        </button>
      </div>
    );
  },
}));

import { ConfigurationSelect } from "./ConfigurationSelect";

describe("ConfigurationSelect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFindFirstConfigurations.mockReturnValue({ data: null });
  });

  it("renders AsyncCombobox", () => {
    render(
      <ConfigurationSelect value={null} onChange={vi.fn()} />
    );

    expect(screen.getByTestId("async-combobox")).toBeInTheDocument();
  });

  it("shows placeholder when value is null", () => {
    render(
      <ConfigurationSelect value={null} onChange={vi.fn()} />
    );

    // When value is null, resolvedValue is null, so AsyncCombobox gets value=null
    const comboboxValue = screen.getByTestId("combobox-value");
    expect(comboboxValue.textContent).toBe("");
  });

  it("shows configuration name when value is set and data is loaded", () => {
    mockUseFindFirstConfigurations.mockReturnValue({
      data: { id: 5, name: "My Configuration" },
    });

    render(
      <ConfigurationSelect value={5} onChange={vi.fn()} />
    );

    const comboboxValue = screen.getByTestId("combobox-value");
    expect(comboboxValue.textContent).toBe("My Configuration");
  });

  it("calls onChange with null when unassigned option is selected", () => {
    const onChange = vi.fn();

    render(
      <ConfigurationSelect value={null} onChange={onChange} />
    );

    const unassignedBtn = screen.getByTestId("unassigned-option");
    fireEvent.click(unassignedBtn);

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("calls onChange with config id when option is selected", () => {
    const onChange = vi.fn();

    render(
      <ConfigurationSelect value={null} onChange={onChange} />
    );

    const trigger = screen.getByTestId("combobox-trigger");
    fireEvent.click(trigger);

    expect(onChange).toHaveBeenCalledWith(42);
  });

  it("passes disabled prop to AsyncCombobox", () => {
    render(
      <ConfigurationSelect value={null} onChange={vi.fn()} disabled={true} />
    );

    const combobox = screen.getByTestId("async-combobox");
    expect(combobox.getAttribute("data-disabled")).toBe("true");
  });

  it("passes disabled=false when not disabled", () => {
    render(
      <ConfigurationSelect value={null} onChange={vi.fn()} disabled={false} />
    );

    const combobox = screen.getByTestId("async-combobox");
    expect(combobox.getAttribute("data-disabled")).toBe("false");
  });

  it("queries useFindFirstConfigurations with the current value id", () => {
    mockUseFindFirstConfigurations.mockReturnValue({ data: null });

    render(
      <ConfigurationSelect value={10} onChange={vi.fn()} />
    );

    expect(mockUseFindFirstConfigurations).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 10 },
      })
    );
  });

  it("queries useFindFirstConfigurations with undefined when value is null", () => {
    mockUseFindFirstConfigurations.mockReturnValue({ data: null });

    render(
      <ConfigurationSelect value={null} onChange={vi.fn()} />
    );

    expect(mockUseFindFirstConfigurations).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: undefined },
      })
    );
  });
});
