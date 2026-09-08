import { describe, expect, it } from "vitest";

import {
  contrastingTextColor,
  perceptualTextColor,
} from "./contrastingTextColor";

/** WCAG 2.x contrast ratio, computed independently of the implementation. */
function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const h = hex.replace("#", "");
    const channels = [0, 2, 4].map(
      (i) => parseInt(h.slice(i, i + 2), 16) / 255
    );
    const [r, g, bl] = channels.map((s) =>
      s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrastingTextColor", () => {
  it("picks black for the seeded green that failed the a11y gate on white", () => {
    // #36ab51 against white is 2.95:1 — the violation this exists to fix.
    expect(contrastRatio("#36ab51", "#ffffff")).toBeLessThan(4.5);
    expect(contrastingTextColor("#36ab51")).toBe("#000000");
  });

  it("picks white on dark backgrounds and black on light ones", () => {
    expect(contrastingTextColor("#000000")).toBe("#ffffff");
    expect(contrastingTextColor("#1e3a8a")).toBe("#ffffff");
    expect(contrastingTextColor("#ffffff")).toBe("#000000");
    expect(contrastingTextColor("#fef08a")).toBe("#000000");
  });

  it("clears 4.5:1 for every 8-bit-per-channel background", () => {
    // The black/white curves cross at ~4.58:1, so the better of the two always
    // clears the normal-text minimum. Sample the cube rather than walk all 16M.
    for (let r = 0; r < 256; r += 17) {
      for (let g = 0; g < 256; g += 17) {
        for (let b = 0; b < 256; b += 17) {
          const bg = `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
          expect(contrastRatio(bg, contrastingTextColor(bg))).toBeGreaterThan(
            4.5
          );
        }
      }
    }
  });

  it("accepts shorthand and unprefixed hex", () => {
    expect(contrastingTextColor("#000")).toBe("#ffffff");
    expect(contrastingTextColor("36ab51")).toBe("#000000");
  });

  it("reads rgb()/rgba() strings (the JUnit result fallback colours)", () => {
    expect(contrastingTextColor("rgb(1, 2, 3)")).toBe("#ffffff");
    expect(contrastingTextColor("rgb(239, 68, 68)")).toBe("#000000");
    expect(contrastingTextColor("rgba(0, 0, 0, 0.5)")).toBe("#ffffff");
  });

  it("falls back to black when the colour cannot be parsed", () => {
    expect(contrastingTextColor("")).toBe("#000000");
    expect(contrastingTextColor("hsl(200, 50%, 50%)")).toBe("#000000");
    expect(contrastingTextColor("rgb(999, 0, 0)")).toBe("#000000");
  });
});

describe("perceptualTextColor", () => {
  it("picks white on the seeded violet where the strict WCAG pick is black", () => {
    // Skipped's seeded colour: black wins the ratio 4.70:1 vs 4.47:1, but
    // black on mid-violet is what the bug report called hard to read.
    expect(contrastingTextColor("#786AC8")).toBe("#000000");
    expect(perceptualTextColor("#786AC8")).toBe("#ffffff");
  });

  it("still picks black on genuinely light backgrounds", () => {
    expect(perceptualTextColor("#ffffff")).toBe("#000000");
    expect(perceptualTextColor("#fef08a")).toBe("#000000");
    // The seeded green that motivated the strict picker keeps black too.
    expect(perceptualTextColor("#36ab51")).toBe("#000000");
  });

  it("picks white on dark and mid-saturation backgrounds", () => {
    expect(perceptualTextColor("#000000")).toBe("#ffffff");
    expect(perceptualTextColor("#258AC4")).toBe("#ffffff");
    // Light gray stays black — white there would be 2.6:1.
    expect(perceptualTextColor("rgb(161, 161, 170)")).toBe("#000000");
  });
});
