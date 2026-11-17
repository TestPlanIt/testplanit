import { fireEvent, render, screen } from "@testing-library/react";
import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns?: string) => (key: string) =>
    `${ns ? `${ns}.` : ""}${key}`,
}));

import { ValuesInput } from "./values-input";

function Harness({
  initial = [],
  onChange = vi.fn(),
  ...rest
}: {
  initial?: string[];
  onChange?: (values: string[]) => void;
  separator?: string;
  disabled?: boolean;
}) {
  const [values, setValues] = useState(initial);
  return (
    <ValuesInput
      values={values}
      onChange={(next) => {
        onChange(next);
        setValues(next);
      }}
      placeholder="Add a value"
      ariaLabel="Values"
      testIdPrefix="tags"
      {...rest}
    />
  );
}

const input = () => screen.getByTestId("tags-values-input") as HTMLInputElement;
const chips = () =>
  screen.queryAllByTestId("tags-value").map((chip) => chip.textContent);

function type(value: string, key = "Enter") {
  fireEvent.change(input(), { target: { value } });
  fireEvent.keyDown(input(), { key });
}

describe("ValuesInput", () => {
  it("adds the trimmed typed value on Enter and clears the field", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(input()).toHaveAttribute("aria-label", "Values");
    expect(input()).toHaveAttribute("placeholder", "Add a value");

    type("  qa  ");

    expect(onChange).toHaveBeenLastCalledWith(["qa"]);
    expect(chips()).toEqual(["qa"]);
    expect(input().value).toBe("");
  });

  it("adds on the separator key too, but not on other keys", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} separator="," />);
    type("one", ",");
    type("two", "a");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(chips()).toEqual(["one"]);
    expect(input().value).toBe("two");
  });

  it("treats the separator as an ordinary key without one configured", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    type("one", ",");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("adds the typed value when the field loses focus", () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { value: "blurred" } });
    fireEvent.blur(input());
    expect(chips()).toEqual(["blurred"]);
  });

  it("ignores blanks and values already listed", () => {
    const onChange = vi.fn();
    render(<Harness initial={["qa"]} onChange={onChange} />);
    type("   ");
    type("qa");
    expect(onChange).not.toHaveBeenCalled();
    expect(chips()).toEqual(["qa"]);
    expect(input().value).toBe("");
  });

  it("removes the last value on Backspace in an empty field only", () => {
    const onChange = vi.fn();
    render(<Harness initial={["a", "b"]} onChange={onChange} />);

    fireEvent.change(input(), { target: { value: "x" } });
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["a"]);
    fireEvent.keyDown(input(), { key: "Backspace" });
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(chips()).toEqual([]);
  });

  it("removes a value with its remove button", () => {
    const onChange = vi.fn();
    render(<Harness initial={["a", "b", "c"]} onChange={onChange} />);
    const buttons = screen.getAllByRole("button", {
      name: "common.actions.remove",
    });
    expect(buttons).toHaveLength(3);
    fireEvent.click(buttons[1]);
    expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);
  });

  it("shows values without remove buttons and a disabled field when disabled", () => {
    render(<Harness initial={["a"]} disabled />);
    expect(chips()).toEqual(["a"]);
    expect(
      screen.queryByRole("button", { name: "common.actions.remove" })
    ).toBeNull();
    expect(input()).toBeDisabled();
  });
});
