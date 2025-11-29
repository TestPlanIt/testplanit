import { describe, it, expect } from "vitest";
import { getDateFnsLocale } from "./locales";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";

describe("getDateFnsLocale", () => {
  it("should return the correct locale object for known locales", () => {
    expect(getDateFnsLocale("en-US")).toBe(enUS);
    expect(getDateFnsLocale("es-ES")).toBe(es);
    expect(getDateFnsLocale("fr-FR")).toBe(fr);
  });

  it("should return the default locale (enUS) for unknown locales", () => {
    expect(getDateFnsLocale("unknown")).toBe(enUS);
    expect(getDateFnsLocale("xx-XX")).toBe(enUS);
  });

  it("should return the default locale (enUS) for empty string input", () => {
    expect(getDateFnsLocale("")).toBe(enUS);
  });

  it("should return the default locale (enUS) for partial matches (if any)", () => {
    // Assuming 'en' is not directly in the map
    expect(getDateFnsLocale("en")).toBe(enUS);
  });

  // Note: Testing with null/undefined might cause type errors if strictNullChecks is on,
  // but we can test the behavior if needed, assuming it defaults.
  it("should return the default locale (enUS) for null/undefined (runtime check)", () => {
    expect(getDateFnsLocale(null as any)).toBe(enUS);
    expect(getDateFnsLocale(undefined as any)).toBe(enUS);
  });
});
