/**
 * ActionOverflow tests.
 *
 * The wide/compact split is the load-bearing behavior: wide containers render
 * each action as a real button carrying its data-testid, while compact
 * containers collapse the whole bar into a kebab menu whose items only exist
 * while the menu is open (and run in reverse order). E2E specs depend on the
 * test ids surviving both modes, so both paths are pinned here.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { CirclePlus, Download, Sparkles } from "lucide-react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ActionOverflow, useContainerCompact } from "./action-bar";

const ACTIONS = [
  {
    key: "import",
    icon: Download,
    label: "Import",
    onClick: vi.fn(),
    testId: "import-button",
  },
  {
    key: "generate",
    icon: Sparkles,
    label: "Generate",
    onClick: vi.fn(),
    testId: "generate-button",
  },
  {
    key: "add",
    icon: CirclePlus,
    label: "Add",
    onClick: vi.fn(),
    testId: "add-button",
    variant: "default" as const,
  },
];

describe("ActionOverflow — wide mode", () => {
  it("renders every visible action as a button with its testid", () => {
    render(
      <ActionOverflow
        compact={false}
        actions={ACTIONS}
        menuLabel="Actions"
        menuTestId="test-actions-menu"
      />
    );

    for (const a of ACTIONS) {
      expect(screen.getByTestId(a.testId!)).toBeInTheDocument();
    }
    expect(screen.queryByTestId("test-actions-menu")).not.toBeInTheDocument();
  });

  it("honors per-action variant, defaulting to outline", () => {
    render(
      <ActionOverflow
        compact={false}
        actions={ACTIONS}
        menuLabel="Actions"
        menuTestId="test-actions-menu"
      />
    );

    // The `default` variant paints bg-primary; outline buttons do not.
    expect(screen.getByTestId("add-button").className).toContain("bg-primary");
    expect(screen.getByTestId("import-button").className).not.toContain(
      "bg-primary"
    );
  });

  it("omits hidden actions and renders nothing when all are hidden", () => {
    const { rerender, container } = render(
      <ActionOverflow
        compact={false}
        actions={[{ ...ACTIONS[0], hidden: true }, ACTIONS[1]]}
        menuLabel="Actions"
      />
    );
    expect(screen.queryByTestId("import-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("generate-button")).toBeInTheDocument();

    rerender(
      <ActionOverflow
        compact={false}
        actions={ACTIONS.map((a) => ({ ...a, hidden: true }))}
        menuLabel="Actions"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("invokes the action onClick", () => {
    const onClick = vi.fn();
    render(
      <ActionOverflow
        compact={false}
        actions={[{ ...ACTIONS[0], onClick }]}
        menuLabel="Actions"
      />
    );
    fireEvent.click(screen.getByTestId("import-button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("ActionOverflow — compact mode", () => {
  it("renders only the kebab trigger until opened, then menu items with the same testids in reverse order", () => {
    render(
      <ActionOverflow
        compact
        actions={ACTIONS}
        menuLabel="Actions"
        menuTestId="test-actions-menu"
      />
    );

    // Closed: the individual action testids must not exist.
    const trigger = screen.getByTestId("test-actions-menu");
    for (const a of ACTIONS) {
      expect(screen.queryByTestId(a.testId!)).not.toBeInTheDocument();
    }

    // Radix opens its menus on pointerdown, not click.
    fireEvent.pointerDown(
      trigger,
      new PointerEvent("pointerdown", { bubbles: true })
    );

    const items = screen.getAllByRole("menuitem");
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "add-button",
      "generate-button",
      "import-button",
    ]);
  });

  it("hidden actions stay out of the menu", () => {
    render(
      <ActionOverflow
        compact
        actions={[{ ...ACTIONS[0], hidden: true }, ACTIONS[1], ACTIONS[2]]}
        menuLabel="Actions"
        menuTestId="test-actions-menu"
      />
    );
    fireEvent.pointerDown(
      screen.getByTestId("test-actions-menu"),
      new PointerEvent("pointerdown", { bubbles: true })
    );
    expect(screen.queryByTestId("import-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("generate-button")).toBeInTheDocument();
  });
});

describe("useContainerCompact", () => {
  it("reports compact synchronously from the measured width", () => {
    const widths: Record<string, number> = { narrow: 500, wide: 1000 };

    function Probe({ name }: { name: string }) {
      const { ref, compact } = useContainerCompact();
      const attach = (node: HTMLDivElement | null) => {
        if (node) {
          Object.defineProperty(node, "offsetWidth", {
            value: widths[name],
            configurable: true,
          });
        }
        ref(node);
      };
      return (
        <div
          ref={attach}
          data-testid={`probe-${name}`}
          data-compact={compact}
        />
      );
    }

    render(
      <>
        <Probe name="narrow" />
        <Probe name="wide" />
      </>
    );

    expect(
      screen.getByTestId("probe-narrow").getAttribute("data-compact")
    ).toBe("true");
    expect(screen.getByTestId("probe-wide").getAttribute("data-compact")).toBe(
      "false"
    );
  });
});
