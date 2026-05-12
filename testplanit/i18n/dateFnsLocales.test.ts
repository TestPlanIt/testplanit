import { enUS } from "date-fns/locale/en-US";
import { es } from "date-fns/locale/es";
import { fr } from "date-fns/locale/fr";
import { it } from "date-fns/locale/it";
import { de } from "date-fns/locale/de";
import { describe, expect, it as test } from "vitest";

import { dateFnsLocaleFor, dateFnsLocaleMap } from "./dateFnsLocales";
import { locales } from "./navigation";

describe("dateFnsLocaleMap", () => {
  test("covers every locale in the navigation locales array", () => {
    for (const locale of locales) {
      expect(dateFnsLocaleMap).toHaveProperty(locale);
    }
  });

  test("maps each supported locale to the correct date-fns object", () => {
    expect(dateFnsLocaleMap["en-US"]).toBe(enUS);
    expect(dateFnsLocaleMap["es-ES"]).toBe(es);
    expect(dateFnsLocaleMap["fr-FR"]).toBe(fr);
    expect(dateFnsLocaleMap["it-IT"]).toBe(it);
    expect(dateFnsLocaleMap["de-DE"]).toBe(de);
  });
});

describe("dateFnsLocaleFor", () => {
  test("returns correct locale for hyphen format", () => {
    expect(dateFnsLocaleFor("en-US")).toBe(enUS);
    expect(dateFnsLocaleFor("es-ES")).toBe(es);
    expect(dateFnsLocaleFor("fr-FR")).toBe(fr);
    expect(dateFnsLocaleFor("it-IT")).toBe(it);
    expect(dateFnsLocaleFor("de-DE")).toBe(de);
  });

  test("normalises underscore format to hyphen before lookup", () => {
    expect(dateFnsLocaleFor("it_IT")).toBe(it);
    expect(dateFnsLocaleFor("de_DE")).toBe(de);
    expect(dateFnsLocaleFor("es_ES")).toBe(es);
    expect(dateFnsLocaleFor("fr_FR")).toBe(fr);
  });

  test("falls back to enUS for unknown locales", () => {
    expect(dateFnsLocaleFor("xx-XX")).toBe(enUS);
    expect(dateFnsLocaleFor("unknown")).toBe(enUS);
    expect(dateFnsLocaleFor("")).toBe(enUS);
  });
});
