import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (namespace?: string) => (key: string) =>
    `${namespace}.${key}`,
}));

import {
  resetSharedReportLoading,
  SHARED_REPORT_LOADING_DELAY_MS,
  SharedReportLoading,
} from "./SharedReportLoading";

const LOADING_TEXT = "reports.sharedReport.loading";

describe("SharedReportLoading", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetSharedReportLoading();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays blank until the delay has passed, then shows the spinner", () => {
    const { container } = render(<SharedReportLoading />);

    expect(screen.getByTestId("shared-report-loading")).toBeInTheDocument();
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    expect(container.querySelector(".animate-spin")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SHARED_REPORT_LOADING_DELAY_MS - 1);
    });
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).not.toBeNull();
  });

  it("honours a custom delay", () => {
    render(<SharedReportLoading delayMs={1000} />);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
  });

  it("times a later instance from the first one's start", () => {
    const first = render(<SharedReportLoading delayMs={400} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    first.unmount();

    // The hand-off to the next loading state keeps the original start time.
    render(<SharedReportLoading delayMs={400} />);
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
  });

  it("shows a later instance immediately once the delay has elapsed", () => {
    const first = render(<SharedReportLoading delayMs={400} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    first.unmount();

    render(<SharedReportLoading delayMs={400} />);
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
  });

  it("waits the full delay again after a reset", () => {
    const first = render(<SharedReportLoading delayMs={400} />);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    first.unmount();

    resetSharedReportLoading();

    render(<SharedReportLoading delayMs={400} />);
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(screen.queryByText(LOADING_TEXT)).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText(LOADING_TEXT)).toBeInTheDocument();
  });
});
