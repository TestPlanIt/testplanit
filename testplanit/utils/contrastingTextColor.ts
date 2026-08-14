/**
 * Foreground colour for text drawn on an arbitrary background.
 *
 * Status, tag and milestone-type colours are chosen by admins, so no fixed
 * foreground is safe: white on the seeded green (#36ab51) is 2.95:1, below the
 * 4.5:1 WCAG 1.4.3 minimum. Picking whichever of black/white contrasts better
 * is always enough — the two ratios are equal at a relative luminance of
 * ~0.179, where both are 4.58:1, so the better of the pair never drops below
 * that for any background.
 *
 * Callers publish the result as the `--status-surface-fg` custom property on
 * an element marked `data-status-surface`, and ONLY the accessible themes read
 * it (styles/globals.css). The brand themes keep whatever text colour they set
 * inline, so this never changes their appearance.
 *
 * Note this is the WCAG relative-luminance formula (sRGB channels linearised
 * first), not the raw-channel approximation in utils/stringToColorCode.ts.
 */

import type { CSSProperties } from "react";

const BLACK = "#000000";
const WHITE = "#ffffff";

/**
 * Expands #rgb, tolerates a missing #, reads rgb()/rgba() (the JUnit result
 * fallback colours are rgb() strings), returns null for anything else.
 */
function parseColor(color: string): [number, number, number] | null {
  const trimmed = color.trim();
  const rgbMatch = trimmed.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,[^)]*)?\)$/i
  );
  if (rgbMatch) {
    const channels = [rgbMatch[1], rgbMatch[2], rgbMatch[3]].map(Number);
    if (channels.some((c) => c > 255)) return null;
    return channels as [number, number, number];
  }
  const hex = trimmed.replace(/^#/, "");
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** WCAG 2.x relative luminance. */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rl, gl, bl] = [r, g, b].map((channel) => {
    const s = channel / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Black or white, whichever contrasts better with `backgroundColor`.
 * Unparseable input falls back to black, the safer default on the light
 * surfaces these badges sit on.
 */
export function contrastingTextColor(backgroundColor: string): string {
  const rgb = parseColor(backgroundColor);
  if (!rgb) return BLACK;

  const luminance = relativeLuminance(rgb);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithWhite >= contrastWithBlack ? WHITE : BLACK;
}

/**
 * The pick for text set INLINE on a status surface — what the brand themes
 * show. The strict WCAG comparison above flips to black right at the ratio
 * tie, where mid-saturation backgrounds (the seeded violet Skipped,
 * #786AC8, is luminance 0.185 — black "wins" 4.70:1 vs 4.47:1) read far
 * better with white to human eyes. Prefer white unless black's ratio beats
 * it by 1.5×, which moves the flip to luminance ~0.23 — light backgrounds
 * (greens, ambers) still get black. Accessible themes ignore this: they
 * consume the strict pick via --status-surface-fg (statusSurfaceVars).
 */
export function perceptualTextColor(backgroundColor: string): string {
  const rgb = parseColor(backgroundColor);
  if (!rgb) return BLACK;

  const luminance = relativeLuminance(rgb);
  const contrastWithWhite = 1.05 / (luminance + 0.05);
  const contrastWithBlack = (luminance + 0.05) / 0.05;
  return contrastWithBlack >= contrastWithWhite * 1.5 ? BLACK : WHITE;
}

/**
 * Spread into the `style` of an element painted with an admin-chosen colour,
 * alongside `data-status-surface`. Publishes the readable foreground without
 * applying it — see the accessible-theme rule in styles/globals.css.
 */
export function statusSurfaceVars(backgroundColor: string): CSSProperties {
  return {
    "--status-surface-fg": contrastingTextColor(backgroundColor),
  } as CSSProperties;
}
