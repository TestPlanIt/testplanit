import { describe, it, expect } from "vitest";
import { formatEmailDate, formatEmailDateTime, getServerDateFnsLocale } from "./server-date-formatter";
import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";

describe("server-date-formatter", () => {
  const testDate = new Date('2025-07-10T14:45:00Z');

  describe("getServerDateFnsLocale", () => {
    it("should return correct locale for en-US", () => {
      expect(getServerDateFnsLocale("en-US")).toBe(enUS);
      expect(getServerDateFnsLocale("en_US")).toBe(enUS);
    });

    it("should return correct locale for es-ES", () => {
      expect(getServerDateFnsLocale("es-ES")).toBe(es);
      expect(getServerDateFnsLocale("es_ES")).toBe(es);
    });

    it("should return correct locale for fr-FR", () => {
      expect(getServerDateFnsLocale("fr-FR")).toBe(fr);
      expect(getServerDateFnsLocale("fr_FR")).toBe(fr);
    });

    it("should return enUS as default for unknown locale", () => {
      expect(getServerDateFnsLocale("unknown")).toBe(enUS);
      expect(getServerDateFnsLocale("xx-XX")).toBe(enUS);
    });
  });

  describe("formatEmailDate", () => {
    it("should format date in English", () => {
      const result = formatEmailDate(testDate, "en-US");
      expect(result).toBe("July 10, 2025");
    });

    it("should format date in Spanish", () => {
      const result = formatEmailDate(testDate, "es-ES");
      expect(result).toBe("julio 10, 2025");
    });
  });

  describe("formatEmailDateTime", () => {
    it("should format date time in English", () => {
      const result = formatEmailDateTime(testDate, "en-US");
      expect(result).toContain("July 10, 2025 at");
      expect(result).toMatch(/at \d{2}:\d{2} [AP]M$/);
    });

    it("should format date time in Spanish", () => {
      const result = formatEmailDateTime(testDate, "es-ES");
      expect(result).toContain("julio 10, 2025 a las");
      expect(result).toMatch(/a las \d{2}:\d{2} [AP]M$/);
    });

    it("should handle underscore locale format", () => {
      const result = formatEmailDateTime(testDate, "es_ES");
      expect(result).toContain("julio 10, 2025 a las");
    });
  });
});