import type { CSSProperties } from "react";

const FILL_ALPHA = 0.1;
const LIGHT_THEME_MAX_LIGHTNESS = 40;
const DARK_THEME_MIN_LIGHTNESS = 65;

function hexToRgb(hex: string): [number, number, number] {
  const full =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function rgbToHsl([r, g, b]: [number, number, number]): [
  number,
  number,
  number,
] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [h * 60, s * 100, l * 100];
}

/**
 * Paints a tracker label in its own colour: a solid outline, a faint fill
 * of the same colour, and text in the colour with its lightness clamped so
 * it reads on the current theme (darkened on light themes, lightened on
 * dark ones, the way GitHub does). GitHub sends the hex without a leading
 * `#`; a value that is not a hex colour leaves the element unstyled so the
 * theme's default badge shows.
 */
export function trackerLabelStyle(
  color: string | null | undefined,
  darkTheme = false
): CSSProperties | undefined {
  if (!color) return undefined;
  const hex = color.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(hex) && !/^[0-9a-fA-F]{3}$/.test(hex)) {
    return undefined;
  }
  const rgb = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(rgb);
  const lightness = darkTheme
    ? Math.max(l, DARK_THEME_MIN_LIGHTNESS)
    : Math.min(l, LIGHT_THEME_MAX_LIGHTNESS);
  const [r, g, b] = rgb;
  return {
    backgroundColor: `rgba(${r}, ${g}, ${b}, ${FILL_ALPHA})`,
    borderColor: `rgb(${r}, ${g}, ${b})`,
    color: `hsl(${Math.round(h)} ${Math.round(s)}% ${Math.round(lightness)}%)`,
  };
}
