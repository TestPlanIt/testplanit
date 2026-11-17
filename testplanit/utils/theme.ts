/**
 * Which of the app's themes paint a dark surface.
 *
 * The app ships seven themes and two of them are dark: `dark` (background
 * L 4.9%) and `accessibledark` (L 9%). The rest — light, orange, green,
 * purple, accessible — are light, like `:root`.
 *
 * This list exists in two places that have to agree: here, for the code that
 * branches on the theme in JS, and the `dark` custom variant in
 * styles/tailwind.config.css, for the `dark:` utilities. A theme added later
 * that is dark belongs in both, or it silently gets light colours on a dark
 * page — which is exactly how `accessibledark` came to be missed.
 */
export const DARK_THEMES = ["dark", "accessibledark"] as const;

/**
 * Whether `theme` paints a dark surface. Takes next-themes' `theme` or
 * `resolvedTheme` (`undefined` before hydration, which reads as not dark).
 *
 * Prefer a `dark:` Tailwind utility where one will do; reach for this only
 * when the colour cannot be expressed in CSS — a value handed to an inline
 * style, a canvas, or a chart library.
 */
export const isDarkTheme = (theme?: string | null): boolean =>
  theme != null && (DARK_THEMES as readonly string[]).includes(theme);

/**
 * The `color-scheme` a theme asks the browser to use for native controls
 * (scrollbars, form widgets). `""` lets the browser decide, which is what
 * the tinted themes want.
 */
export const colorSchemeForTheme = (theme?: string | null): string => {
  if (isDarkTheme(theme)) return "dark";
  if (theme === "light" || theme === "accessible") return "light";
  return "";
};
