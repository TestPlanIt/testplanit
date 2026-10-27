import { describe, expect, it } from "vitest";

import { contrastingTextColor } from "./contrastingTextColor";

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

describe("status-surface ink across the seeded palette", () => {
  // db/seed.ts, nine families of six shades, darkest first. Any colour an
  // admin can choose for a status, tag, result or milestone comes from here.
  const SEEDED = [
    ["#333435", "#6C6D6E", "#838485", "#9A9B9C", "#B1B2B3", "#C8C9CA"],
    ["#8D2007", "#BD2B0A", "#ED360C", "#F44B25", "#F66F51", "#F88F77"],
    ["#783702", "#A54C03", "#D76304", "#FA7C14", "#FB9846", "#FCB478"],
    ["#664400", "#996600", "#CC8800", "#FFAA00", "#FFBB33", "#FFCC66"],
    ["#164621", "#206530", "#2A843F", "#36AB51", "#51C86C", "#7BD590"],
    ["#0A4C57", "#0E6B7C", "#128BA1", "#16ABC5", "#27CAE7", "#55D5EC"],
    ["#134664", "#195D84", "#1F74A4", "#258AC4", "#58A5D1", "#8CC1DF"],
    ["#372C77", "#493A9C", "#5D4CBD", "#786AC8", "#8C80D0", "#A79EDB"],
    ["#632243", "#7A2A53", "#983468", "#BE4182", "#CB679B", "#D88DB4"],
  ].flat();

  it("clears 4.5:1 on every seeded shade", () => {
    for (const shade of SEEDED) {
      const ink = contrastingTextColor(shade);
      expect(
        contrastRatio(ink, shade),
        `${ink} on ${shade}`
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("takes black on the five shades the retired perceptual pick got wrong", () => {
    // These chose white and shipped below AA in light and the brand themes.
    for (const shade of [
      "#838485",
      "#258AC4",
      "#128BA1",
      "#ED360C",
      "#786AC8",
    ]) {
      expect(contrastingTextColor(shade), shade).toBe("#000000");
    }
  });

  it("still takes white on genuinely dark fills", () => {
    expect(contrastingTextColor("#000000")).toBe("#ffffff");
    expect(contrastingTextColor("#164621")).toBe("#ffffff");
    expect(contrastingTextColor("#372C77")).toBe("#ffffff");
  });
});
