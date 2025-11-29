import { render, screen, waitFor } from "~/test/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "@testing-library/react";
import LoadingSpinner from "./LoadingSpinner";

describe("LoadingSpinner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render the spinner SVG with correct accessibility attributes", () => {
    render(<LoadingSpinner delay={0} />);

    // Advance timers to trigger the setTimeout
    act(() => {
      vi.runAllTimers();
    });

    const spinnerByTitle = screen.getByTitle("Loading...");
    expect(spinnerByTitle).toBeInTheDocument();

    const spinnerByRole = screen.getByRole("status");
    expect(spinnerByRole).toBeInTheDocument();

    expect(spinnerByRole).toHaveClass("animate-spin");
    const pathElement = spinnerByRole.querySelector("path");
    expect(pathElement).toHaveAttribute("d", "M21 12a9 9 0 1 1-6.219-8.56");
  });

  it("should apply additional className to the outer div", () => {
    const testClassName = "my-custom-spinner-class";
    render(<LoadingSpinner className={testClassName} delay={0} />);

    // Advance timers to trigger the setTimeout
    act(() => {
      vi.runAllTimers();
    });

    const spinnerSvg = screen.getByTitle("Loading...");
    const wrapper = spinnerSvg.closest(
      'div[class*="flex justify-center items-center"]'
    );
    expect(wrapper).toHaveClass(testClassName);
  });

  it("should not render immediately when delay is set", () => {
    render(<LoadingSpinner delay={100} />);

    // Should not be visible immediately
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("should render after delay has passed", () => {
    render(<LoadingSpinner delay={100} />);

    // Should not be visible immediately
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // Advance time by delay amount
    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should be visible after delay
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
