import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { rowRange, useRangeSelect } from "./useRangeSelect";

const click = (shiftKey: boolean) => ({ shiftKey, preventDefault: vi.fn() });

function setup(selectableIds: string[]) {
  return renderHook(() => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return { selected, ...useRangeSelect(selectableIds, setSelected) };
  });
}

describe("rowRange", () => {
  it("runs from the anchor to the clicked row in either direction", () => {
    expect(rowRange(["a", "b", "c", "d"], "b", "d")).toEqual(["b", "c", "d"]);
    expect(rowRange(["a", "b", "c", "d"], "d", "b")).toEqual(["b", "c", "d"]);
  });

  it("is null when a row is not in the list", () => {
    expect(rowRange(["a", "b"], "z", "b")).toBeNull();
  });
});

describe("useRangeSelect", () => {
  it("selects the rows between the anchor and a shift-click", () => {
    const { result } = setup(["a", "b", "c", "d"]);
    const event = click(true);
    let handled = false;
    act(() => {
      result.current.anchor("a");
      handled = result.current.onClick("c", event);
    });
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect([...result.current.selected].sort()).toEqual(["a", "b", "c"]);
  });

  it("skips rows that cannot be selected", () => {
    // "b" is disabled, so it is not among the selectable ids.
    const { result } = setup(["a", "c", "d"]);
    act(() => {
      result.current.anchor("a");
      result.current.onClick("d", click(true));
    });
    expect([...result.current.selected].sort()).toEqual(["a", "c", "d"]);
  });

  it("leaves a plain click, or a shift-click with no anchor, to the caller", () => {
    const { result } = setup(["a", "b", "c"]);
    let handled = true;
    act(() => {
      handled = result.current.onClick("b", click(true));
    });
    expect(handled).toBe(false);
    act(() => {
      result.current.anchor("a");
      handled = result.current.onClick("c", click(false));
    });
    expect(handled).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });
});
