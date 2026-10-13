import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));

import {
  ReportDateRangeModeField,
  applyDateRangeMode,
} from "./ReportDateRangeModeField";

const relativeConfig = {
  reportType: "flaky-tests",
  startDate: "2026-01-05T00:00:00.000Z",
  endDate: "2026-01-11T23:59:59.999Z",
  dateRangePreset: "lastWeek",
  dateRangeTimezone: "Etc/UTC",
};

describe("applyDateRangeMode", () => {
  it("keeps a relative range as it is", () => {
    expect(applyDateRangeMode(relativeConfig, "relative")).toBe(relativeConfig);
  });

  it("fixes the dates the range resolves to now and drops the preset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T17:00:00.000Z"));
    try {
      expect(applyDateRangeMode(relativeConfig, "fixed")).toEqual({
        reportType: "flaky-tests",
        startDate: "2026-09-14T00:00:00.000Z",
        endDate: "2026-09-20T23:59:59.999Z",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a custom range alone in either mode", () => {
    const custom = {
      reportType: "flaky-tests",
      startDate: "2026-01-05T00:00:00.000Z",
    };
    expect(applyDateRangeMode(custom, "fixed")).toBe(custom);
  });
});

describe("ReportDateRangeModeField", () => {
  it("renders nothing for a custom range", () => {
    const { container } = render(
      <ReportDateRangeModeField
        config={{ startDate: "2026-01-05T00:00:00.000Z" }}
        dataMode="live"
        value="relative"
        onChange={() => {}}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers relative or fixed dates for a live report", () => {
    const onChange = vi.fn();
    render(
      <ReportDateRangeModeField
        config={relativeConfig}
        dataMode="live"
        value="relative"
        onChange={onChange}
      />
    );
    expect(
      screen.getByTestId("report-date-range-mode-relative")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("report-date-range-mode-fixed"));
    expect(onChange).toHaveBeenCalledWith("fixed");
  });

  it("replaces the choice with a note for a frozen report", () => {
    render(
      <ReportDateRangeModeField
        config={relativeConfig}
        dataMode="frozen"
        value="relative"
        onChange={() => {}}
      />
    );
    expect(
      screen.getByTestId("report-date-range-frozen-note")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("report-date-range-mode-fixed")).toBeNull();
  });
});
