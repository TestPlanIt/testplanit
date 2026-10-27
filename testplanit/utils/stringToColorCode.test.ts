import { describe, expect, it } from "vitest";
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
    // 'Dark Background' hashes to #182ceb, relative luminance 0.08 — white is
    // 8.08:1 there, black only 2.60:1.
    const { textColor } = stringToColorCode("Dark Background");
    expect(textColor).toBe("text-white");
  });

  it("should return text-black for input generating a light background (e.g., 'Test')", () => {
    // 'Test' hashes to #b2b827, relative luminance 0.44 — black is 9.78:1
    // there, white only 2.15:1.
    const { textColor } = stringToColorCode("Test");
    expect(textColor).toBe("text-black");
  });

  /**
   * The assertion that makes the original bug impossible to reintroduce.
   *
   * The pick used to sum raw channels with red and blue transposed, which put
   * 14.2% of the generator's whole output space below 4.5:1 (worst #ff9900 at
   * 2.14:1). Asserting the ratio rather than a specific colour means any future
   * change to either the hash or the pick has to stay readable.
   */
  describe("contrast of the chosen text colour", () => {
    const relativeLuminance = (hex: string) => {
      const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      const [r, g, b] = channels.map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratioAgainst = (hex: string, textColor: string) => {
      const bg = relativeLuminance(hex);
      const fg = textColor === "text-white" ? 1 : 0;
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    };

    // Spread across the hash space rather than a handful of names, so the
    // sample actually exercises both sides of the black/white flip.
    const names = Array.from({ length: 400 }, (_, i) => `user ${i} name`);

    it("always clears WCAG AA for body text", () => {
      const failures = names
        .map((n) => {
          const { colorCode, textColor } = stringToColorCode(n);
          return {
            n,
            colorCode,
            textColor,
            ratio: ratioAgainst(colorCode, textColor),
          };
        })
        .filter((r) => r.ratio < 4.5);

      expect(failures).toEqual([]);
    });

    it("picks the better of black and white, not merely a plausible one", () => {
      for (const n of names.slice(0, 50)) {
        const { colorCode, textColor } = stringToColorCode(n);
        const chosen = ratioAgainst(colorCode, textColor);
        const other = ratioAgainst(
          colorCode,
          textColor === "text-white" ? "text-black" : "text-white"
        );
        expect(chosen).toBeGreaterThanOrEqual(other);
      }
    });
  });
});
