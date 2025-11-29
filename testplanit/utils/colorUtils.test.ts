import { describe, it, expect } from "vitest";
import { hexToRgb, getBackgroundStyle, getTextStyle } from "./colorUtils";

describe("hexToRgb", () => {
  it("should convert a valid 6-digit hex code with #", () => {
    expect(hexToRgb("#ff5733")).toEqual({ r: 255, g: 87, b: 51 });
  });

  it("should convert a valid 6-digit hex code without #", () => {
    expect(hexToRgb("ff5733")).toEqual({ r: 255, g: 87, b: 51 });
  });

  it("should convert a valid 3-digit hex code with #", () => {
    expect(hexToRgb("#f0c")).toEqual({ r: 255, g: 0, b: 204 });
  });

  it("should convert a valid 3-digit hex code without #", () => {
    expect(hexToRgb("f0c")).toEqual({ r: 255, g: 0, b: 204 });
  });

  it("should return the default color for null input", () => {
    expect(hexToRgb(null as any)).toEqual({ r: 59, g: 130, b: 246 }); // Default blue
  });

  it("should return the default color for undefined input", () => {
    expect(hexToRgb(undefined as any)).toEqual({ r: 59, g: 130, b: 246 }); // Default blue
  });

  it("should return null for an invalid hex code", () => {
    expect(hexToRgb("#zzzzzz")).toBeNull();
  });

  it("should return null for an incomplete hex code", () => {
    expect(hexToRgb("#ff573")).toBeNull();
  });

  it("should handle black correctly", () => {
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("should handle white correctly", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("getBackgroundStyle", () => {
  it("should return correct rgba background style for a valid hex", () => {
    expect(getBackgroundStyle("#ff5733", 0.5)).toEqual({
      backgroundColor: "rgba(255, 87, 51, 0.5)",
    });
  });

  it("should use default opacity (0.1) if not provided", () => {
    expect(getBackgroundStyle("#3498db")).toEqual({
      backgroundColor: "rgba(52, 152, 219, 0.1)",
    });
  });

  it("should return default blue background for invalid hex", () => {
    expect(getBackgroundStyle("invalid-hex", 0.2)).toEqual({
      backgroundColor: "rgba(59, 130, 246, 0.1)", // Uses default hex AND default opacity on error
    });
  });

  it("should return default blue background for null/undefined hex", () => {
    // When color is null, it uses the default COLOR but the PROVIDED opacity
    expect(getBackgroundStyle(null as any, 0.3)).toEqual({
      backgroundColor: 'rgba(59, 130, 246, 0.3)', // Expecting opacity 0.3
    });
    // When color is undefined and opacity is default, uses default color and default opacity
    expect(getBackgroundStyle(undefined as any)).toEqual({
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
    });
  });
});

describe("getTextStyle", () => {
  it("should return the hex color as text color", () => {
    expect(getTextStyle("#abcdef")).toEqual({ color: "#abcdef" });
  });

  it("should return the default blue text color for null input", () => {
    expect(getTextStyle(null as any)).toEqual({ color: "#3b82f6" });
  });

  it("should return the default blue text color for undefined input", () => {
    expect(getTextStyle(undefined as any)).toEqual({ color: "#3b82f6" });
  });

  it("should return the default blue text color for empty string input", () => {
    expect(getTextStyle("")).toEqual({ color: "#3b82f6" });
  });
});
