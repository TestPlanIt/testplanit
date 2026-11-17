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
 * first), not a raw-channel approximation: summing raw 0-255 channels mis-ranks
 * saturated colours badly enough to pick an unreadable foreground. The
 * generated avatar and mention-chip colours in utils/stringToColorCode.ts used
 * to do exactly that, which left 14.2% of the colours they can produce below
 * 4.5:1; they now delegate here.
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
 * WCAG 2.x contrast ratio, or null when either colour is unparseable.
 *
 * For callers that paint one admin-owned shade on another and want to keep
 * that pair when it is readable: the black/white pick above is their fallback,
 * not their first choice (hooks/useIssueColors.ts).
 */
export function contrastRatio(a: string, b: string): number | null {
  const [first, second] = [parseColor(a), parseColor(b)];
  if (!first || !second) return null;
  const [hi, lo] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (x, y) => y - x
  );
  return (hi + 0.05) / (lo + 0.05);
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
 * There was a `perceptualTextColor` here, which preferred white unless
 * black's ratio beat it by 1.5x. It read better to the eye on mid-saturation
 * fills, but on five of the fifty-four seeded shades it chose the ink that
 * fails AA — Black[2] #838485 3.75:1, Indigo[3] #258AC4 3.81, Blue[2] #128BA1
 * 4.01, Red[2] #ED360C 4.09, Violet[3] #786AC8 4.47 — and only the accessible
 * themes re-derived the strict pick, so light and the brand themes shipped
 * them as they were. The surfaces that compute their ink now take the strict
 * pick above, which clears 4.5:1 on all fifty-four (worst 4.69, Violet[3]).
 * Retired 2026-10-27; don't reintroduce the preference without re-checking
 * the seed.
 */

/**
 * Spread into the `style` of an element painted with an admin-chosen colour,
 * alongside `data-status-surface`. Publishes the readable foreground without
 * applying it — see the accessible-theme rule in styles/globals.css.
 *
 * That rule is load-bearing, not a belt: not every caller inks itself from
 * the fill. `hooks/useIssueColors.ts` deliberately keeps its family ink when
 * the measured pair already clears 4.5:1, and `data-review-status` elements
 * swap in a per-theme token instead. Don't delete it as redundant.
 */
export function statusSurfaceVars(backgroundColor: string): CSSProperties {
  return {
    "--status-surface-fg": contrastingTextColor(backgroundColor),
  } as CSSProperties;
}
