import { describe, expect, it } from "vitest";
import {
  formatReportPeriod,
  formatReportPeriodIso,
} from "./reportPeriodFormat";

describe("reportPeriodFormat", () => {
  const start = "2026-05-11T00:00:00.000Z";

  describe("formatReportPeriod", () => {
    it("labels a day through the locale on its UTC calendar day", () => {
      expect(formatReportPeriod(start, "daily", "en-US")).toBe("5/11/2026");
    });

    it("spells a week out as its first and last days", () => {
      expect(formatReportPeriod(start, "weekly", "en-US")).toBe(
        "May 11, 2026 - May 17, 2026"
      );
    });

    it("labels months, quarters and years", () => {
      expect(formatReportPeriod(start, "monthly", "en-US")).toBe("May 2026");
      expect(formatReportPeriod(start, "quarterly", "en-US")).toBe("Q2 2026");
      expect(formatReportPeriod(start, "annually", "en-US")).toBe("2026");
    });

    it("is empty for a missing or invalid value", () => {
      expect(formatReportPeriod(null, "monthly", "en-US")).toBe("");
      expect(formatReportPeriod("not a date", "monthly", "en-US")).toBe("");
    });
  });

  describe("formatReportPeriodIso", () => {
    it("writes locale-independent period labels", () => {
      expect(formatReportPeriodIso(start, "daily")).toBe("2026-05-11");
      expect(formatReportPeriodIso(start, "weekly")).toBe(
        "2026-05-11 – 2026-05-17"
      );
      expect(formatReportPeriodIso(start, "monthly")).toBe("2026-05");
      expect(formatReportPeriodIso(start, "quarterly")).toBe("2026-Q2");
      expect(formatReportPeriodIso(start, "annually")).toBe("2026");
    });
  });
});
