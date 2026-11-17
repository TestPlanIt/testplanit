import { describe, expect, it } from "vitest";

import { colorSchemeForTheme, DARK_THEMES, isDarkTheme } from "~/utils/theme";

/**
 * The themes the app ships, as app/providers.tsx declares them. Keeping the
 * full list here is what makes the "every other theme is light" assertions
 * mean something: add a theme to the provider without deciding whether it is
 * dark and one of these cases starts failing.
 */
const ALL_THEMES = [
  "light",
  "dark",
  "green",
  "orange",
  "purple",
  "accessible",
  "accessibledark",
];

describe("isDarkTheme", () => {
  it.each(DARK_THEMES)("treats %s as a dark surface", (theme) => {
    expect(isDarkTheme(theme)).toBe(true);
  });

  it.each(
    ALL_THEMES.filter((t) => !(DARK_THEMES as readonly string[]).includes(t))
  )("treats %s as a light surface", (theme) => {
    expect(isDarkTheme(theme)).toBe(false);
  });

  it('covers accessibledark, the theme a `theme === "dark"` check missed', () => {
    expect(isDarkTheme("accessibledark")).toBe(true);
  });

  it("reads an unresolved theme as not dark", () => {
    // next-themes hands back undefined before hydration; the light surface is
    // the safer default because :root is light.
    expect(isDarkTheme(undefined)).toBe(false);
    expect(isDarkTheme(null)).toBe(false);
    expect(isDarkTheme("")).toBe(false);
  });

  it("does not match on substrings", () => {
    expect(isDarkTheme("darker")).toBe(false);
    expect(isDarkTheme("Dark")).toBe(false);
  });
});

describe("colorSchemeForTheme", () => {
  it("asks for the dark native controls on every dark theme", () => {
    expect(colorSchemeForTheme("dark")).toBe("dark");
    expect(colorSchemeForTheme("accessibledark")).toBe("dark");
  });

  it("asks for the light native controls on the plain light themes", () => {
    expect(colorSchemeForTheme("light")).toBe("light");
    expect(colorSchemeForTheme("accessible")).toBe("light");
  });

  it.each(["green", "orange", "purple"])(
    "leaves the choice to the browser for the tinted %s theme",
    (theme) => {
      expect(colorSchemeForTheme(theme)).toBe("");
    }
  );

  it("leaves the choice to the browser before the theme resolves", () => {
    expect(colorSchemeForTheme(undefined)).toBe("");
  });
});
