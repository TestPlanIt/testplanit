import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";

// --- Mocks ---

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, opts?: Record<string, unknown>) => {
    if (opts && typeof opts === "object") {
      const values = Object.entries(opts)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `${key}(${values})`;
    }
    return key;
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value, className }: { value?: number; className?: string }) => (
    <div data-testid="progress-bar" data-value={value} className={className} />
  ),
}));

vi.mock("lucide-react", () => ({
  CheckCircle2: () => <svg data-testid="icon-check" />,
  X: () => <svg data-testid="icon-x" />,
  XCircle: () => <svg data-testid="icon-xcircle" />,
}));

// --- Import Component Under Test ---
import { AutoTagProgress } from "./AutoTagProgress";

// --- Fixtures ---

const baseProps = {
  status: "idle" as const,
  progress: null,
  error: null,
  onReview: vi.fn(),
  onCancel: vi.fn(),
  onDismiss: undefined,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// --- Tests ---

describe("AutoTagProgress", () => {
  it("returns null when status is idle", () => {
    const { container } = render(<AutoTagProgress {...baseProps} status="idle" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows starting text and cancel button when status is waiting with no progress", () => {
    render(
      <AutoTagProgress {...baseProps} status="waiting" progress={null} />
    );

    expect(screen.getByText("starting")).toBeInTheDocument();
    // Progress bar rendered without a specific value
    const bar = screen.getByTestId("progress-bar");
    expect(bar).toBeInTheDocument();
    expect(bar.getAttribute("data-value")).toBeNull();

    // Cancel button shown
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("shows analyzed text and progress bar value when status is active with progress", () => {
    render(
      <AutoTagProgress
        {...baseProps}
        status="active"
        progress={{ analyzed: 5, total: 10 }}
      />
    );

    expect(
      screen.getByText("analyzed(analyzed=5, total=10)")
    ).toBeInTheDocument();

    const bar = screen.getByTestId("progress-bar");
    expect(bar.getAttribute("data-value")).toBe("50");
  });

  it("calls onCancel when cancel button clicked in active state", async () => {
    const onCancel = vi.fn();
    render(
      <AutoTagProgress
        {...baseProps}
        status="active"
        progress={{ analyzed: 3, total: 9 }}
        onCancel={onCancel}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows complete text and review button when status is completed", () => {
    render(<AutoTagProgress {...baseProps} status="completed" />);

    expect(screen.getByText("complete")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /reviewSuggestions/i })
    ).toBeInTheDocument();
  });

  it("calls onReview when review button clicked in completed state", async () => {
    const onReview = vi.fn();
    render(
      <AutoTagProgress {...baseProps} status="completed" onReview={onReview} />
    );

    await userEvent.click(
      screen.getByRole("button", { name: /reviewSuggestions/i })
    );
    expect(onReview).toHaveBeenCalledOnce();
  });

  it("shows dismiss button when completed and onDismiss provided, calls onDismiss on click", async () => {
    const onDismiss = vi.fn();
    render(
      <AutoTagProgress
        {...baseProps}
        status="completed"
        onDismiss={onDismiss}
      />
    );

    // The dismiss button is a plain <button> (not a Button component) wrapping X icon
    const dismissBtn = screen.getAllByRole("button").find(
      (btn) => btn !== screen.queryByRole("button", { name: /reviewSuggestions/i })
    );
    expect(dismissBtn).toBeInTheDocument();
    await userEvent.click(dismissBtn!);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not show dismiss button when completed and onDismiss is not provided", () => {
    render(
      <AutoTagProgress
        {...baseProps}
        status="completed"
        onDismiss={undefined}
      />
    );

    // Only review button should exist
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /reviewSuggestions/i })
    ).toBeInTheDocument();
  });

  it("shows error message and dismiss button when status is failed with error", () => {
    render(
      <AutoTagProgress
        {...baseProps}
        status="failed"
        error="Something went wrong"
      />
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("shows fallback failed text when status is failed with no error message", () => {
    render(
      <AutoTagProgress {...baseProps} status="failed" error={null} />
    );

    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("calls onCancel when dismiss button clicked in failed state", async () => {
    const onCancel = vi.fn();
    render(
      <AutoTagProgress
        {...baseProps}
        status="failed"
        error="Oops"
        onCancel={onCancel}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
