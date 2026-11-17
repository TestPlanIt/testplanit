import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The run page's suite query stopped shipping `systemOut`/`systemErr` (they
 * made the response O(results × log size) and it reloads on every live
 * wake-up). The popovers instead get a presence flag and fetch the text per
 * result once opened — these tests pin that contract: no fetch while closed,
 * trigger only when the result has text, full text once open.
 */

const { findUniqueSpy } = vi.hoisted(() => ({ findUniqueSpy: vi.fn() }));

vi.mock("@zenstackhq/tanstack-query/react", () => ({
  useClientQueries: () => ({
    jUnitTestResult: { useFindUnique: findUniqueSpy },
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

// Context-aware popover stub: content renders only while open, and clicking
// the trigger toggles via the component's own controlled open state.
vi.mock("@/components/ui/popover", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (open: boolean) => void;
  }>({ open: false, setOpen: () => {} });
  return {
    Popover: ({ open, onOpenChange, children }: any) => (
      <Ctx.Provider value={{ open: !!open, setOpen: onOpenChange }}>
        <div data-testid="popover">{children}</div>
      </Ctx.Provider>
    ),
    PopoverTrigger: ({ children }: any) => {
      const { open, setOpen } = React.useContext(Ctx);
      return (
        <div data-testid="popover-trigger-wrap" onClick={() => setOpen(!open)}>
          {children}
        </div>
      );
    },
    PopoverContent: ({ children }: any) => {
      const { open } = React.useContext(Ctx);
      return open ? <div data-testid="popover-content">{children}</div> : null;
    },
  };
});

import SystemErrorPopover from "./SystemErrorPopover";
import SystemOutputPopover from "./SystemOutputPopover";

function lastEnabled(): boolean | undefined {
  const call = findUniqueSpy.mock.calls.at(-1);
  return call?.[1]?.enabled;
}

beforeEach(() => {
  findUniqueSpy.mockReset();
  findUniqueSpy.mockReturnValue({ data: undefined });
});

describe("SystemOutputPopover", () => {
  it("inline mode renders the text preview and never enables the fetch", () => {
    render(<SystemOutputPopover text="first line\nrest" />);
    expect(screen.getByTestId("system-output-trigger")).toBeInTheDocument();
    expect(lastEnabled()).toBe(false);
  });

  it("inline mode renders nothing for empty text", () => {
    const { container } = render(<SystemOutputPopover text="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lazy mode renders nothing when the result has no output", () => {
    const { container } = render(
      <SystemOutputPopover resultId={42} hasText={false} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(lastEnabled()).toBe(false);
  });

  it("lazy mode fetches the text only once opened", () => {
    findUniqueSpy.mockImplementation((_args: any, opts: any) => ({
      data: opts?.enabled
        ? { systemOut: "COMMAND: run\nhello world" }
        : undefined,
    }));
    render(<SystemOutputPopover resultId={42} hasText />);

    const trigger = screen.getByTestId("system-output-trigger");
    expect(trigger).toHaveTextContent("actions.viewSystemOutput");
    expect(screen.queryByTestId("popover-content")).not.toBeInTheDocument();
    expect(lastEnabled()).toBe(false);

    fireEvent.click(trigger);

    expect(lastEnabled()).toBe(true);
    expect(findUniqueSpy.mock.calls.at(-1)?.[0]).toEqual({
      where: { id: 42 },
      select: { systemOut: true },
    });
    expect(screen.getByTestId("popover-content")).toHaveTextContent(
      "hello world"
    );
  });
});

describe("SystemErrorPopover", () => {
  it("lazy mode renders nothing when the result has no error text", () => {
    const { container } = render(
      <SystemErrorPopover resultId={7} hasText={false} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lazy mode fetches systemErr on open and renders message + stack", () => {
    findUniqueSpy.mockImplementation((_args: any, opts: any) => ({
      data: opts?.enabled
        ? { systemErr: "Error: boom\n    at doIt (src/foo.ts:3:7)" }
        : undefined,
    }));
    render(<SystemErrorPopover resultId={7} hasText />);

    const trigger = screen.getByTestId("system-error-trigger");
    expect(trigger).toHaveTextContent("actions.viewSystemError");
    expect(lastEnabled()).toBe(false);

    fireEvent.click(trigger);

    expect(lastEnabled()).toBe(true);
    expect(findUniqueSpy.mock.calls.at(-1)?.[0]).toEqual({
      where: { id: 7 },
      select: { systemErr: true },
    });
    const content = screen.getByTestId("popover-content");
    expect(content).toHaveTextContent("Error: boom");
    expect(content).toHaveTextContent("doIt");
  });

  it("inline mode still renders the given text as the trigger preview", () => {
    render(<SystemErrorPopover text="AssertionError: nope" />);
    expect(screen.getByTestId("system-error-trigger")).toHaveTextContent(
      "AssertionError: nope"
    );
    expect(lastEnabled()).toBe(false);
  });
});
