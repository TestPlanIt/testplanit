import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// --- Mocks ---

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant,
    className,
    onClick,
    onDoubleClick,
    ...props
  }: {
    children: React.ReactNode;
    variant?: string;
    className?: string;
    onClick?: (e: React.MouseEvent) => void;
    onDoubleClick?: (e: React.MouseEvent) => void;
    [key: string]: unknown;
  }) => (
    <span
      data-testid="badge"
      data-variant={variant}
      className={className}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      {...props}
    >
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: React.forwardRef(
    (
      {
        value,
        onChange,
        onBlur,
        onKeyDown,
        className,
        autoFocus,
        ...props
      }: {
        value?: string;
        onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
        onBlur?: () => void;
        onKeyDown?: (e: React.KeyboardEvent) => void;
        className?: string;
        autoFocus?: boolean;
        [key: string]: unknown;
      },
      ref: React.Ref<HTMLInputElement>
    ) => (
      <input
        ref={ref}
        data-testid="tag-input"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        className={className}
        autoFocus={autoFocus}
        {...props}
      />
    )
  ),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  TooltipTrigger: ({
    children,
    asChild: _asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => <>{children}</>,
  TooltipContent: ({
    children,
    side,
  }: {
    children: React.ReactNode;
    side?: string;
  }) => (
    <div data-testid="tooltip-content" data-side={side}>
      {children}
    </div>
  ),
}));

vi.mock("~/utils", () => ({
  cn: (...args: (string | undefined | false | null)[]) =>
    args.filter(Boolean).join(" "),
}));

vi.mock("lucide-react", () => ({
  Tag: () => <svg data-testid="icon-tag" />,
}));

// --- Import Component Under Test ---
import { TagChip } from "./TagChip";

// --- Fixtures ---

const baseProps = {
  tagName: "my-tag",
  isExisting: true,
  isAccepted: true,
  onToggle: vi.fn(),
  onEdit: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ---

describe("TagChip", () => {
  it("renders the tag name", () => {
    render(<TagChip {...baseProps} />);
    expect(screen.getByText("my-tag")).toBeInTheDocument();
  });

  it("accepted state: Badge has variant=default", () => {
    render(<TagChip {...baseProps} isAccepted={true} />);
    const badge = screen.getByTestId("badge");
    expect(badge.getAttribute("data-variant")).toBe("default");
  });

  it("rejected state: Badge has variant=outline and opacity class", () => {
    render(<TagChip {...baseProps} isAccepted={false} />);
    const badge = screen.getByTestId("badge");
    expect(badge.getAttribute("data-variant")).toBe("outline");
    expect(badge.className).toContain("opacity-50");
  });

  it("click calls onToggle after 200ms debounce", () => {
    const onToggle = vi.fn();
    render(<TagChip {...baseProps} onToggle={onToggle} />);

    const badge = screen.getByTestId("badge");
    // Use fireEvent.click to avoid userEvent's async timing issues with fake timers
    fireEvent.click(badge);

    // Before debounce, not yet called
    expect(onToggle).not.toHaveBeenCalled();

    // Advance past the 200ms timer
    vi.advanceTimersByTime(250);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("double-click shows input with current tag name", () => {
    render(<TagChip {...baseProps} tagName="edit-me" />);
    const badge = screen.getByTestId("badge");

    fireEvent.dblClick(badge);

    const input = screen.getByTestId("tag-input");
    expect(input).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("edit-me");
  });

  it("Enter key commits edit and calls onEdit with new value", () => {
    const onEdit = vi.fn();
    render(<TagChip {...baseProps} tagName="old-name" onEdit={onEdit} />);

    const badge = screen.getByTestId("badge");
    fireEvent.dblClick(badge);

    const input = screen.getByTestId("tag-input") as HTMLInputElement;
    // Simulate changing the value
    fireEvent.change(input, { target: { value: "new-name" } });

    // Press Enter to commit
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEdit).toHaveBeenCalledWith("new-name");
    // Should exit editing mode
    expect(screen.queryByTestId("tag-input")).not.toBeInTheDocument();
  });

  it("Escape key cancels edit without calling onEdit", () => {
    const onEdit = vi.fn();
    render(<TagChip {...baseProps} tagName="original" onEdit={onEdit} />);

    const badge = screen.getByTestId("badge");
    fireEvent.dblClick(badge);

    const input = screen.getByTestId("tag-input");
    fireEvent.change(input, { target: { value: "changed" } });

    // Press Escape to cancel
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onEdit).not.toHaveBeenCalled();
    // Should exit editing mode
    expect(screen.queryByTestId("tag-input")).not.toBeInTheDocument();
  });

  it("existing accepted tag shows tooltipAssign in tooltip content", () => {
    render(
      <TagChip {...baseProps} isExisting={true} isAccepted={true} />
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "tooltipAssign"
    );
  });

  it("existing rejected tag shows tooltipExisting in tooltip content", () => {
    render(
      <TagChip {...baseProps} isExisting={true} isAccepted={false} />
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "tooltipExisting"
    );
  });

  it("new tag shows tooltipNew in tooltip content", () => {
    render(
      <TagChip {...baseProps} isExisting={false} isAccepted={true} />
    );
    expect(screen.getByTestId("tooltip-content")).toHaveTextContent(
      "tooltipNew"
    );
  });
});
