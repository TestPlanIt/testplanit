import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { describe, expect, it, vi } from "vitest";
import type { FilterInputValue } from "@/components/filterInputValue";
import { LinkFilterInput } from "@/components/LinkFilterInput";
import { NumericFilterInput } from "@/components/NumericFilterInput";
import { StepsFilterInput } from "@/components/StepsFilterInput";
import { TextFilterInput } from "@/components/TextFilterInput";

/**
 * The four inputs the chip editor keys values into share one contract, and
 * the chip editor depends on both halves of it: `onValueChange` reports the
 * entry on every edit WITHOUT committing (emitting empty `values` while it is
 * incomplete, so an abandoned entry cannot leave a stale value pending), and
 * `onConfirm` fires only for a valid entry, which is what applies it.
 */
/**
 * The structured props the chip editor passes. `fieldType` is required
 * because NumericFilterInput requires it, and the component type has to
 * supply every prop each of the four demands; the other three ignore it.
 */
interface TypedInputProps {
  fieldId: number;
  fieldType: string;
  currentFilter: string | null;
  value?: FilterInputValue | null;
  onValueChange?: (next: FilterInputValue) => void;
  onConfirm?: () => void;
  operators?: readonly string[];
}

interface TypedInputCase {
  name: string;
  /** The four shapes differ past the shared structured props (fieldType). */
  Component: ComponentType<TypedInputProps>;
  fieldType: string;
  /** A complete entry, and what it should report. */
  valid: { typed: string; values: Array<string | number> };
  /** Edited to this, the entry is incomplete. */
  incomplete: string;
  betweenOperator?: boolean;
}

const CASES: TypedInputCase[] = [
  {
    name: "NumericFilterInput",
    Component: NumericFilterInput,
    fieldType: "Number",
    valid: { typed: "12", values: [12] },
    incomplete: "",
    betweenOperator: true,
  },
  {
    name: "StepsFilterInput",
    Component: StepsFilterInput,
    fieldType: "Steps",
    valid: { typed: "3", values: [3] },
    incomplete: "",
    betweenOperator: true,
  },
  {
    name: "TextFilterInput",
    Component: TextFilterInput,
    fieldType: "Text String",
    valid: { typed: "login", values: ["login"] },
    incomplete: "   ",
  },
  {
    name: "LinkFilterInput",
    Component: LinkFilterInput,
    fieldType: "Link",
    valid: { typed: "example.com", values: ["example.com"] },
    incomplete: "   ",
  },
];

function setup(testCase: TypedInputCase, operator = "eq") {
  const onValueChange = vi.fn<(next: FilterInputValue) => void>();
  const onConfirm = vi.fn();
  const { Component } = testCase;
  render(
    <Component
      fieldId={1}
      currentFilter={null}
      value={{ operator, values: [] }}
      onValueChange={onValueChange}
      onConfirm={onConfirm}
      operators={["eq", "gt", "between", "any"]}
      fieldType={testCase.fieldType}
    />
  );
  return {
    onValueChange,
    onConfirm,
    // Numeric/Steps render number inputs, which carry no textbox role.
    input: document.querySelector(
      'input:not([type="hidden"])'
    ) as HTMLInputElement,
    apply: () => screen.getByTestId("filter-input-apply"),
  };
}

describe.each(CASES)("$name", (testCase) => {
  it("reports an edit without confirming it", () => {
    const { onValueChange, onConfirm, input } = setup(testCase);

    fireEvent.change(input, { target: { value: testCase.valid.typed } });

    expect(onValueChange).toHaveBeenCalledWith({
      operator: "eq",
      values: testCase.valid.values,
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("reports an empty value set once the entry is incomplete", () => {
    const { onValueChange, input } = setup(testCase);

    fireEvent.change(input, { target: { value: testCase.valid.typed } });
    onValueChange.mockClear();
    fireEvent.change(input, { target: { value: testCase.incomplete } });

    // Without this the chip editor would keep the last valid value pending
    // and apply it after the field had been cleared.
    expect(onValueChange).toHaveBeenCalledWith({
      operator: "eq",
      values: [],
    });
  });

  it("confirms a valid entry from the apply button", () => {
    const { onConfirm, input, apply } = setup(testCase);

    fireEvent.change(input, { target: { value: testCase.valid.typed } });
    fireEvent.click(apply());

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirms a valid entry on Enter", () => {
    const { onConfirm, input } = setup(testCase);

    fireEvent.change(input, { target: { value: testCase.valid.typed } });
    fireEvent.keyPress(input, { key: "Enter", code: "Enter", charCode: 13 });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not confirm an incomplete entry", () => {
    const { onConfirm, input, apply } = setup(testCase);

    fireEvent.change(input, { target: { value: testCase.incomplete } });
    fireEvent.keyPress(input, { key: "Enter", code: "Enter", charCode: 13 });

    expect(onConfirm).not.toHaveBeenCalled();
    expect(apply()).toBeDisabled();
  });

  it("labels the apply control", () => {
    const { apply } = setup(testCase);
    expect(apply()).toHaveAccessibleName("common.actions.apply");
  });

  it("offers no value entry or apply control for a valueless operator", () => {
    setup(testCase, "any");

    // `any`/`none` need nothing keyed in, so there is no entry to confirm —
    // closing the editor is what applies them. Covered at the bar level in
    // RepositoryFilterBar.closeCommit.test.tsx.
    expect(document.querySelector('input:not([type="hidden"])')).toBeNull();
    expect(screen.queryByTestId("filter-input-apply")).not.toBeInTheDocument();
  });
});

describe.each(CASES.filter((c) => c.betweenOperator))(
  "$name between",
  (testCase) => {
    it("reports empty until both bounds are present and ordered", () => {
      const onValueChange = vi.fn<(next: FilterInputValue) => void>();
      const { Component } = testCase;
      render(
        <Component
          fieldId={1}
          currentFilter={null}
          value={{ operator: "between", values: [] }}
          onValueChange={onValueChange}
          operators={["eq", "between"]}
          fieldType={testCase.fieldType}
        />
      );
      const inputs = Array.from(
        document.querySelectorAll('input:not([type="hidden"])')
      ) as HTMLInputElement[];
      expect(inputs).toHaveLength(2);

      // Lower bound only: not yet applicable.
      fireEvent.change(inputs[0], { target: { value: "2" } });
      expect(onValueChange).toHaveBeenLastCalledWith({
        operator: "between",
        values: [],
      });

      // Out of order: still not applicable.
      fireEvent.change(inputs[1], { target: { value: "1" } });
      expect(onValueChange).toHaveBeenLastCalledWith({
        operator: "between",
        values: [],
      });

      fireEvent.change(inputs[1], { target: { value: "9" } });
      expect(onValueChange).toHaveBeenLastCalledWith({
        operator: "between",
        values: [2, 9],
      });
    });
  }
);
