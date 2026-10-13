import { describe, expect, it } from "vitest";

import {
  configurationMatchesSearch,
  sortVariantsByCategory,
} from "./configurationListUtils";

const config = (name: string, variantNames: string[]) => ({
  name,
  variants: variantNames.map((variantName) => ({
    variant: { name: variantName },
  })),
});

describe("configurationMatchesSearch", () => {
  it("matches everything when the search is blank", () => {
    expect(configurationMatchesSearch(config("A", []), "   ")).toBe(true);
  });

  it("matches the configuration name, case-insensitively", () => {
    expect(
      configurationMatchesSearch(config("Chrome, Windows 11", []), "windows")
    ).toBe(true);
  });

  it("matches a variant whose name the configuration no longer spells", () => {
    const stale = config("PROD EU", ["Staging"]);

    expect(configurationMatchesSearch(stale, "staging")).toBe(true);
    expect(configurationMatchesSearch(stale, "prod")).toBe(true);
  });

  it("requires every term, drawn from the name or any variant", () => {
    const pixel = config("Chrome, Android 16, Pixel 10", [
      "Chrome",
      "Android 16",
      "Google Pixel 10",
    ]);

    expect(configurationMatchesSearch(pixel, "google chrome")).toBe(true);
    expect(configurationMatchesSearch(pixel, "google firefox")).toBe(false);
  });

  it("does not match a term across two variant names", () => {
    expect(
      configurationMatchesSearch(config("X", ["Dev", "Ops"]), "devops")
    ).toBe(false);
  });
});

describe("sortVariantsByCategory", () => {
  const v = (name: string, category?: string) => ({
    variant: { name, category: category ? { name: category } : undefined },
  });

  it("orders by category name, then variant name", () => {
    const sorted = sortVariantsByCategory([
      v("Windows 11", "Operating System"),
      v("Staging", "Environment"),
      v("Chrome", "Browser"),
      v("Android 16", "Operating System"),
    ]);

    expect(sorted.map((x) => x.variant.name)).toEqual([
      "Chrome",
      "Staging",
      "Android 16",
      "Windows 11",
    ]);
  });

  it("does not mutate its input", () => {
    const input = [v("B", "Z"), v("A", "A")];
    sortVariantsByCategory(input);
    expect(input.map((x) => x.variant.name)).toEqual(["B", "A"]);
  });
});
