import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ICU placeholder backstop for translated catalogs.
 *
 * Translations are machine-generated (`crowdin pre-translate --method=mt` in
 * .github/workflows/crowdin-sync.yml). MT engines read the ICU count
 * placeholder `#` as the literal "number sign" and localize it: French turned
 * "See all # Test Cases" into "Voir tous les cas de test n°", German into
 * "Anzahl Testfälle", Korean dropped it outright. The message still renders and
 * nothing throws — the number just silently vanishes from the UI.
 *
 * Checks are deliberately restricted to patterns that cannot be confused with a
 * plural branch body. `{minutes}` in `{count, plural, =1 {minute} other
 * {minutes}}` is body text, not an argument, so a naive `\{(\w+)\}` sweep
 * reports hundreds of false positives; only the forms below are unambiguous.
 */

const ROOT = process.cwd();
const MESSAGES = path.join(ROOT, "messages");
const SOURCE_LOCALE = "en-US";

/** `{name, plural|select|…}` — a comma plus a known keyword marks a real argument. */
const TYPED_ARG =
  /\{\s*([a-zA-Z_]\w*)\s*,\s*(?:plural|selectordinal|select|number|date|time)\b/g;
/** Any plural-style argument, used to tell structured messages from flat ones. */
const PLURAL_ARG = /\{\s*\w+\s*,\s*(?:plural|selectordinal|select)\b/;
/** `{name}` — only unambiguous in a message with no branches to be confused with. */
const SIMPLE_ARG = /\{\s*([a-zA-Z_]\w*)\s*\}/g;

type Flat = Record<string, string>;

function flatten(node: unknown, prefix = "", out: Flat = {}): Flat {
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(
      node as Record<string, unknown>
    )) {
      const next = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") out[next] = value;
      else flatten(value, next, out);
    }
  }
  return out;
}

function readCatalog(locale: string): Flat {
  return flatten(
    JSON.parse(fs.readFileSync(path.join(MESSAGES, `${locale}.json`), "utf8"))
  );
}

function matchAll(message: string, re: RegExp): Set<string> {
  return new Set([...message.matchAll(re)].map((m) => m[1]));
}

const locales = fs
  .readdirSync(MESSAGES)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((l) => l !== SOURCE_LOCALE)
  .sort();

const source = readCatalog(SOURCE_LOCALE);

describe("i18n ICU placeholders", () => {
  it("finds locale catalogs to check", () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  describe.each(locales)("%s", (locale) => {
    const translated = readCatalog(locale);
    const shared = Object.keys(source).filter((key) => key in translated);

    it("keeps the ICU `#` count placeholder", () => {
      const dropped = shared
        .filter(
          (key) => PLURAL_ARG.test(source[key]) && source[key].includes("#")
        )
        .filter((key) => !translated[key].includes("#"))
        .map(
          (key) =>
            `${key}\n    ${SOURCE_LOCALE}: ${source[key]}\n    ${locale}: ${translated[key]}`
        );

      expect(
        dropped,
        `${locale} dropped the ICU '#' count placeholder in ${dropped.length} message(s). ` +
          `'#' renders the count, so translating or deleting it removes the number from the UI.`
      ).toEqual([]);
    });

    it("keeps every typed ICU argument", () => {
      const dropped = shared.flatMap((key) => {
        const expected = matchAll(source[key], TYPED_ARG);
        if (expected.size === 0) return [];
        const actual = matchAll(translated[key], TYPED_ARG);
        const missing = [...expected].filter((name) => !actual.has(name));
        if (missing.length === 0) return [];
        return [
          `${key} (missing: ${missing.join(", ")})\n    ${SOURCE_LOCALE}: ${source[key]}\n    ${locale}: ${translated[key]}`,
        ];
      });

      expect(
        dropped,
        `${locale} dropped typed ICU argument(s) in ${dropped.length} message(s).`
      ).toEqual([]);
    });

    it("keeps every simple {argument} in messages without plural branches", () => {
      const dropped = shared
        .filter((key) => !PLURAL_ARG.test(source[key]))
        .flatMap((key) => {
          const expected = matchAll(source[key], SIMPLE_ARG);
          if (expected.size === 0) return [];
          const actual = matchAll(translated[key], SIMPLE_ARG);
          const missing = [...expected].filter((name) => !actual.has(name));
          if (missing.length === 0) return [];
          return [
            `${key} (missing: ${missing.join(", ")})\n    ${SOURCE_LOCALE}: ${source[key]}\n    ${locale}: ${translated[key]}`,
          ];
        });

      expect(
        dropped,
        `${locale} dropped simple ICU argument(s) in ${dropped.length} message(s). ` +
          `A missing argument renders as literal text instead of the value.`
      ).toEqual([]);
    });
  });
});
