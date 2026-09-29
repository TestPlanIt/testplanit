import { isTiptapEmpty } from "~/lib/tiptap/isTiptapEmpty";
import { ensureTipTapJSON } from "~/utils/tiptapConversion";

/** What a writer knows about a template field. */
export interface CoercibleField {
  fieldName: string;
  fieldType: string;
  fieldOptions?: { id: number; name: string; isDefault?: boolean }[];
  isRequired?: boolean;
  isRestricted?: boolean;
  isChecked?: boolean | null;
  defaultValue?: string | null;
  minValue?: number | null;
  maxValue?: number | null;
}

export type CoercionResult =
  { ok: true; value: unknown } | { ok: false; error: string };

const fail = (field: CoercibleField, why: string): CoercionResult => ({
  ok: false,
  error: `Custom field '${field.fieldName}' ${why}`,
});

const isBlank = (value: unknown): boolean =>
  value == null ||
  (typeof value === "string" && value.trim() === "") ||
  (Array.isArray(value) && value.length === 0);

function resolveOption(
  field: CoercibleField,
  value: unknown
): number | undefined {
  const options = field.fieldOptions ?? [];
  const asId =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : undefined;
  if (asId !== undefined && options.some((o) => o.id === asId)) return asId;
  if (typeof value === "string") {
    const wanted = value.trim().toLowerCase();
    return options.find((o) => o.name.trim().toLowerCase() === wanted)?.id;
  }
  return undefined;
}

function checkRange(field: CoercibleField, n: number): CoercionResult {
  if (field.minValue != null && n < field.minValue) {
    return fail(field, `must be at least ${field.minValue}.`);
  }
  if (field.maxValue != null && n > field.maxValue) {
    return fail(field, `must be at most ${field.maxValue}.`);
  }
  return { ok: true, value: n };
}

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

/**
 * Turn a value an API client sent for a custom field into the value the web
 * UI stores for that field type, or say why it can't be one.
 *
 * Shapes, per type: Text String → string; Text Long → a serialized Tiptap
 * document (Markdown, HTML or plain text converted); Integer / Number → a
 * number within the field's min/max; Checkbox → a boolean (also "true",
 * "false", 1 and 0); Date → an ISO timestamp, with a bare date pinned to noon
 * UTC so it reads as the same day in every timezone; Dropdown → an option id
 * (by id or name, case-insensitive); Multi-Select → an array of option ids;
 * Link → an http(s) URL.
 */
export function coerceCaseFieldValue(
  field: CoercibleField,
  value: unknown
): CoercionResult {
  switch (field.fieldType) {
    case "Text String":
      if (typeof value === "string") return { ok: true, value };
      if (typeof value === "number" || typeof value === "boolean") {
        return { ok: true, value: String(value) };
      }
      return fail(field, "expects text.");

    case "Text Long":
      if (typeof value === "string") {
        return { ok: true, value: JSON.stringify(ensureTipTapJSON(value)) };
      }
      if (
        value &&
        typeof value === "object" &&
        (value as { type?: unknown }).type === "doc"
      ) {
        return { ok: true, value: JSON.stringify(value) };
      }
      return fail(field, "expects text or a rich-text document.");

    case "Integer": {
      const n = toNumber(value);
      if (n === undefined || !Number.isInteger(n)) {
        return fail(field, "expects a whole number.");
      }
      return checkRange(field, n);
    }

    case "Number": {
      const n = toNumber(value);
      if (n === undefined) return fail(field, "expects a number.");
      return checkRange(field, n);
    }

    case "Checkbox": {
      if (typeof value === "boolean") return { ok: true, value };
      const text = String(value).trim().toLowerCase();
      if (text === "true" || text === "1") return { ok: true, value: true };
      if (text === "false" || text === "0") return { ok: true, value: false };
      return fail(field, "expects true or false.");
    }

    case "Date": {
      if (typeof value !== "string" && !(value instanceof Date)) {
        return fail(field, "expects a date (YYYY-MM-DD or an ISO timestamp).");
      }
      const text = value instanceof Date ? value.toISOString() : value.trim();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
        ? new Date(`${text}T12:00:00.000Z`)
        : new Date(text);
      if (Number.isNaN(date.getTime())) {
        return fail(field, "expects a date (YYYY-MM-DD or an ISO timestamp).");
      }
      return { ok: true, value: date.toISOString() };
    }

    case "Dropdown": {
      const id = resolveOption(field, value);
      if (id === undefined) {
        return fail(field, "expects one of its options, by name or id.");
      }
      return { ok: true, value: id };
    }

    case "Multi-Select": {
      const values = Array.isArray(value) ? value : [value];
      const ids: number[] = [];
      for (const v of values) {
        const id = resolveOption(field, v);
        if (id === undefined) {
          return fail(field, "expects its options, by name or id.");
        }
        if (!ids.includes(id)) ids.push(id);
      }
      return { ok: true, value: ids };
    }

    case "Link": {
      if (typeof value === "string") {
        try {
          const url = new URL(value.trim());
          if (url.protocol === "http:" || url.protocol === "https:") {
            return { ok: true, value: value.trim() };
          }
        } catch {
          // fall through
        }
      }
      return fail(field, "expects an http(s) URL.");
    }

    case "Steps":
      return fail(field, "is a Steps field; send steps instead.");

    default:
      return { ok: true, value };
  }
}

/**
 * The value the web UI's Add Case form starts a field with, or `undefined`
 * when it starts empty: the Dropdown option marked default, a Checkbox's
 * `isChecked`, and the `defaultValue` of Text String, Link and Text Long.
 */
export function defaultCaseFieldValue(field: CoercibleField): unknown {
  switch (field.fieldType) {
    case "Dropdown":
      return field.fieldOptions?.find((o) => o.isDefault)?.id;
    case "Checkbox":
      return field.isChecked ?? false;
    case "Text String":
    case "Link":
      return field.defaultValue ? field.defaultValue : undefined;
    case "Text Long":
      return field.defaultValue
        ? JSON.stringify(ensureTipTapJSON(field.defaultValue))
        : undefined;
    default:
      return undefined;
  }
}

/** A value that leaves a required field unfilled. */
export function isMissingValue(field: CoercibleField, value: unknown): boolean {
  if (isBlank(value)) return true;
  if (field.fieldType === "Text Long" && typeof value === "string") {
    try {
      return isTiptapEmpty(JSON.parse(value));
    } catch {
      return false;
    }
  }
  return false;
}
