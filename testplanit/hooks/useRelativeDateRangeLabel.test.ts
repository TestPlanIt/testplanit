import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values ? ` ${JSON.stringify(values)}` : ""}`,
}));

import { useRelativeDateRangeLabel } from "./useRelativeDateRangeLabel";

describe("useRelativeDateRangeLabel", () => {
  it("names presets from the date-range strings, with three under common", () => {
    const { result } = renderHook(() => useRelativeDateRangeLabel());
    expect(result.current({ preset: "lastWeek" })).toBe(
      "reports.ui.dateRange.lastWeek"
    );
    expect(result.current({ preset: "last7Days" })).toBe(
      "common.operators.last7"
    );
    expect(result.current({ preset: "last30Days" })).toBe(
      "common.operators.last30"
    );
    expect(result.current({ preset: "thisYear" })).toBe(
      "common.operators.thisYear"
    );
  });

  it("names a rolling window by unit with its count", () => {
    const { result } = renderHook(() => useRelativeDateRangeLabel());
    expect(result.current({ preset: "lastN", amount: 14, unit: "days" })).toBe(
      'reports.ui.dateRange.rolling.days {"count":14}'
    );
  });
});
