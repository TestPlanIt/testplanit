import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { usePanelCollapsed } from "./usePanelCollapsed";

describe("usePanelCollapsed", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("starts expanded when nothing is stored", () => {
    const { result } = renderHook(() => usePanelCollapsed("code-pins"));

    expect(result.current.collapsed).toBe(false);
    expect(result.current.hydrated).toBe(true);
  });

  it("restores a stored collapsed state", () => {
    window.localStorage.setItem("case-panel-collapsed:code-pins", "true");

    const { result } = renderHook(() => usePanelCollapsed("code-pins"));

    expect(result.current.collapsed).toBe(true);
  });

  it("persists each toggle", () => {
    const { result } = renderHook(() => usePanelCollapsed("code-pins"));

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(true);
    expect(window.localStorage.getItem("case-panel-collapsed:code-pins")).toBe(
      "true"
    );

    act(() => result.current.toggle());
    expect(result.current.collapsed).toBe(false);
    expect(window.localStorage.getItem("case-panel-collapsed:code-pins")).toBe(
      "false"
    );
  });

  it("keeps each panel's state separate", () => {
    window.localStorage.setItem("case-panel-collapsed:linked-cases", "true");

    const { result } = renderHook(() => usePanelCollapsed("code-pins"));

    expect(result.current.collapsed).toBe(false);
  });
});
