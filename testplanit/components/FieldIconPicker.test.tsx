import { render, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseFindManyFieldIcon = vi.fn();
const mockUseFindManyColor = vi.fn();

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    fieldIcon: { useFindMany: (...args: any[]) => mockUseFindManyFieldIcon(...args) },
    color: { useFindMany: (...args: any[]) => mockUseFindManyColor(...args) },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("./DynamicIcon", () => ({
  default: () => <span data-testid="dynamic-icon" />,
}));

vi.mock("@/components/ColorPicker", () => ({
  ColorPicker: () => <div data-testid="color-picker" />,
}));

import { FieldIconPicker } from "./FieldIconPicker";

const icons = [
  { id: 1, name: "layout-list" },
  { id: 2, name: "circle" },
];

// Deliberately unsorted to prove the darkest shade (order 0) is chosen, not
// the first array entry.
const colors = [
  {
    id: 30,
    order: 2,
    value: "#838485",
    colorFamily: { id: 1, name: "Black", order: 1 },
  },
  {
    id: 31,
    order: 0,
    value: "#333435",
    colorFamily: { id: 1, name: "Black", order: 1 },
  },
  {
    id: 40,
    order: 0,
    value: "#8D2007",
    colorFamily: { id: 2, name: "Red", order: 2 },
  },
];

describe("FieldIconPicker color default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseFindManyFieldIcon.mockReturnValue({
      data: icons,
      isLoading: false,
    });
    mockUseFindManyColor.mockReturnValue({ data: colors, isLoading: false });
  });

  it("defaults to the darkest black color when none is selected", async () => {
    const onColorSelect = vi.fn();

    render(
      <FieldIconPicker onIconSelect={vi.fn()} onColorSelect={onColorSelect} />
    );

    await waitFor(() => expect(onColorSelect).toHaveBeenCalledWith(31));
  });

  it("does not override an explicitly selected color", async () => {
    const onColorSelect = vi.fn();
    const onIconSelect = vi.fn();

    render(
      <FieldIconPicker
        onIconSelect={onIconSelect}
        onColorSelect={onColorSelect}
        initialColorId={40}
        initialIconId={2}
      />
    );

    // Let any effects flush.
    await waitFor(() => expect(onIconSelect).not.toHaveBeenCalled());
    expect(onColorSelect).not.toHaveBeenCalled();
  });

  it("does not attempt a color default when no color handler is provided", async () => {
    const onIconSelect = vi.fn();

    expect(() =>
      render(<FieldIconPicker onIconSelect={onIconSelect} />)
    ).not.toThrow();

    // Icon still auto-defaults to layout-list; no color handler to call.
    await waitFor(() => expect(onIconSelect).toHaveBeenCalledWith(1));
  });
});
