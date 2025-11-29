import { describe, it, expect } from "vitest";
import { DateFormat, TimeFormat } from "@prisma/client";
import { mapDateTimeFormatString } from "./mapDateTimeFormat";

describe("mapDateTimeFormatString Utility", () => {
  // Test known DateFormat enum values
  it("should map DateFormat.MM_DD_YYYY_SLASH correctly", () => {
    expect(mapDateTimeFormatString(DateFormat.MM_DD_YYYY_SLASH)).toBe(
      "MM/dd/yyyy"
    );
  });
  it("should map DateFormat.YYYY_MM_DD correctly", () => {
    expect(mapDateTimeFormatString(DateFormat.YYYY_MM_DD)).toBe("yyyy-MM-dd");
  });
  // Add more DateFormat tests as needed...

  // Test known TimeFormat enum values
  it("should map TimeFormat.HH_MM_A correctly", () => {
    expect(mapDateTimeFormatString(TimeFormat.HH_MM_A)).toBe("hh:mm a");
  });
  it("should map TimeFormat.HH_MM correctly", () => {
    expect(mapDateTimeFormatString(TimeFormat.HH_MM)).toBe("HH:mm");
  });
  // Add more TimeFormat tests as needed...

  // Test combined date and time formats (using space separator)
  it("should map combined DateFormat and TimeFormat correctly", () => {
    const combinedFormat = `${DateFormat.DD_MM_YYYY_DASH} ${TimeFormat.HH_MM_A}`;
    expect(mapDateTimeFormatString(combinedFormat)).toBe("dd-MM-yyyy hh:mm a");
  });
  it("should handle combined format with only date part matching", () => {
    const combinedFormat = `${DateFormat.D_MMM_YYYY} InvalidTime`;
    // Expect it to return the original string as the combined logic fails
    expect(mapDateTimeFormatString(combinedFormat)).toBe(combinedFormat);
  });
  it("should handle combined format with only time part matching", () => {
    const combinedFormat = `InvalidDate ${TimeFormat.HH_MM_Z}`;
    // Expect it to return the original string as the combined logic fails
    expect(mapDateTimeFormatString(combinedFormat)).toBe(combinedFormat);
  });

  // Test passthrough for raw date-fns format strings
  it("should pass through a raw date-fns format string", () => {
    const rawFormat = "yyyy/MM/dd 'at' HH:mm:ss";
    expect(mapDateTimeFormatString(rawFormat)).toBe(rawFormat);
  });

  // Test passthrough for potentially invalid inputs
  it("should pass through an unknown string", () => {
    const unknownFormat = "ThisIsNotAValidFormat";
    expect(mapDateTimeFormatString(unknownFormat)).toBe(unknownFormat);
  });

  it("should pass through an empty string", () => {
    const emptyFormat = "";
    expect(mapDateTimeFormatString(emptyFormat)).toBe(emptyFormat);
  });
});
