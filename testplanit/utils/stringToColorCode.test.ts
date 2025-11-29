import { describe, it, expect } from "vitest";
import { stringToColorCode } from "./stringToColorCode"; // Import from the local util file

describe("stringToColorCode Utility", () => {
  it("should return an object with colorCode and textColor", () => {
    const result = stringToColorCode("test");
    expect(result).toHaveProperty("colorCode");
    expect(result).toHaveProperty("textColor");
    expect(typeof result.colorCode).toBe("string");
    expect(typeof result.textColor).toBe("string");
  });

  it("should generate a valid hex color code starting with #", () => {
    const { colorCode } = stringToColorCode("another test");
    expect(colorCode).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("should return either text-white or text-black for textColor", () => {
    const { textColor } = stringToColorCode("yet another test");
    expect(["text-white", "text-black"]).toContain(textColor);
  });

  it("should be deterministic (same input yields same output)", () => {
    const input = "deterministic test";
    const result1 = stringToColorCode(input);
    const result2 = stringToColorCode(input);
    expect(result1).toEqual(result2);
  });

  it("should handle empty string input", () => {
    const result = stringToColorCode("");
    expect(result).toHaveProperty("colorCode");
    expect(result).toHaveProperty("textColor");
    expect(result.colorCode).toMatch(/^#[0-9a-f]{6}$/i);
    expect(["text-white", "text-black"]).toContain(result.textColor);
  });

  // Example tests for text color contrast based on generated background
  it("should return text-white for input generating a dark background (e.g., 'Dark Background')", () => {
    // Input 'Dark Background' generates colorCode: '#4c2031' which is dark.
    const { textColor } = stringToColorCode("Dark Background");
    expect(textColor).toBe("text-white");
  });

  it("should return text-black for input generating a light background (e.g., 'Test')", () => {
    // Input 'Test' generates hash 2603496 -> #27b9e8 (light blue/cyan), luminance ~157.
    const { textColor } = stringToColorCode("Test");
    expect(textColor).toBe("text-black");
  });
});
