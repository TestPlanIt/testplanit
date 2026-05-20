import { render, screen, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  ParameterMentionSuggestion,
  type ParameterMentionSuggestionRef,
} from "~/components/tiptap/ParameterMentionSuggestion";
import type { ParameterChipMeta } from "~/lib/tiptap/parameterMentionExtension";

const ITEMS: ParameterChipMeta[] = [
  { id: 1, name: "username", type: "STRING", defaultValue: "alice" },
  { id: 2, name: "userAge", type: "INTEGER", defaultValue: "30" },
  { id: 3, name: "env", type: "SELECT", defaultValue: null },
];

describe("ParameterMentionSuggestion", () => {
  it("renders one button per item with name and type", () => {
    const command = vi.fn();
    render(<ParameterMentionSuggestion items={ITEMS} command={command} />);
    expect(screen.getByText("username")).toBeInTheDocument();
    expect(screen.getByText("userAge")).toBeInTheDocument();
    expect(screen.getByText("env")).toBeInTheDocument();
    // Type badges exist (one per item).
    expect(screen.getByText("STRING")).toBeInTheDocument();
    expect(screen.getByText("INTEGER")).toBeInTheDocument();
    expect(screen.getByText("SELECT")).toBeInTheDocument();
  });

  it("renders the empty state via the parameters.autocompleteEmpty key when items is empty", () => {
    const command = vi.fn();
    render(<ParameterMentionSuggestion items={[]} command={command} />);
    expect(
      screen.getByTestId("parameter-autocomplete-empty")
    ).toBeInTheDocument();
  });

  it("ArrowDown advances selection; Enter calls command(items[selectedIndex])", () => {
    const command = vi.fn();
    const ref = createRef<ParameterMentionSuggestionRef>();
    render(
      <ParameterMentionSuggestion ref={ref} items={ITEMS} command={command} />
    );

    // Default selection is index 0 (username). After one ArrowDown, index=1 (userAge).
    act(() => {
      const handled = ref.current!.onKeyDown({
        event: new KeyboardEvent("keydown", { key: "ArrowDown" }),
      });
      expect(handled).toBe(true);
    });
    act(() => {
      const handled = ref.current!.onKeyDown({
        event: new KeyboardEvent("keydown", { key: "Enter" }),
      });
      expect(handled).toBe(true);
    });
    expect(command).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenCalledWith(ITEMS[1]);
  });

  it("ArrowUp wraps from index 0 to the last item", () => {
    const command = vi.fn();
    const ref = createRef<ParameterMentionSuggestionRef>();
    render(
      <ParameterMentionSuggestion ref={ref} items={ITEMS} command={command} />
    );
    act(() => {
      ref.current!.onKeyDown({
        event: new KeyboardEvent("keydown", { key: "ArrowUp" }),
      });
    });
    act(() => {
      ref.current!.onKeyDown({
        event: new KeyboardEvent("keydown", { key: "Enter" }),
      });
    });
    expect(command).toHaveBeenCalledWith(ITEMS[2]);
  });

  it("returns false from onKeyDown for unhandled keys (e.g. Escape)", () => {
    const command = vi.fn();
    const ref = createRef<ParameterMentionSuggestionRef>();
    render(
      <ParameterMentionSuggestion ref={ref} items={ITEMS} command={command} />
    );
    const handled = ref.current!.onKeyDown({
      event: new KeyboardEvent("keydown", { key: "Escape" }),
    });
    expect(handled).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });

  it("clicking an item invokes command with that item", () => {
    const command = vi.fn();
    render(<ParameterMentionSuggestion items={ITEMS} command={command} />);
    fireEvent.click(screen.getByText("env"));
    expect(command).toHaveBeenCalledWith(ITEMS[2]);
  });
});
