import { describe, expect, it } from "vitest";
import { formatDateRange } from "./dateFormat";

// Construct with local Y/M/D components (month is 0-indexed) so date-fns
// `format` renders the same calendar day regardless of the runner's timezone.
const AUG_26 = new Date(2025, 7, 26);
const SEP_27 = new Date(2025, 8, 27);

describe("formatDateRange", () => {
  it("joins both ends with an en-dash by default", () => {
    expect(formatDateRange(AUG_26, SEP_27)).toBe("Aug 26, 2025 – Sep 27, 2025");
  });

  it("returns just the start when the end is missing", () => {
    expect(formatDateRange(AUG_26, null)).toBe("Aug 26, 2025");
    expect(formatDateRange(AUG_26, undefined)).toBe("Aug 26, 2025");
  });

  it("returns just the end when the start is missing", () => {
    expect(formatDateRange(null, SEP_27)).toBe("Sep 27, 2025");
  });

  it("returns undefined when neither end is set", () => {
    expect(formatDateRange(null, null)).toBeUndefined();
    expect(formatDateRange(undefined, undefined)).toBeUndefined();
  });

  it("accepts ISO date strings", () => {
    expect(formatDateRange("2025-08-26T00:00:00", "2025-09-27T00:00:00")).toBe(
      "Aug 26, 2025 – Sep 27, 2025"
    );
  });

  it("honors a custom separator and format string", () => {
    expect(
      formatDateRange(AUG_26, SEP_27, { separator: "to", formatStr: "MMM d" })
    ).toBe("Aug 26 to Sep 27");
  });
});
