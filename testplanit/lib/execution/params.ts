import {
  MAX_CUSTOM_INPUT_KEYS,
  MAX_INPUT_VALUE_LENGTH,
  normalizeInputs,
} from "./inputs";
import {
  EXECUTION_PARAM_TYPES,
  RESERVED_INPUT_PREFIX,
  type ExecutionParam,
  type ExecutionParamType,
} from "./types";

/**
 * Dispatcher-chosen parameters on an execution target.
 *
 * The target declares them (`paramSchema`), the execute dialog renders one
 * control per parameter, and the chosen values are sent as per-execution
 * inputs, which the existing dispatch pipeline merges over the target's
 * static inputs. Nothing here touches dispatch: this module only decides
 * what a declaration may look like and how a choice becomes a string.
 *
 * Kept free of server-only imports so both dialogs can use it.
 */

export const MULTISELECT_SEPARATOR = ",";
export const MAX_PARAM_LABEL_LENGTH = 100;
export const MAX_PARAM_VALUES = 50;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type ParamSchemaError =
  | { code: "NAME_INVALID"; name: string }
  | { code: "NAME_DUPLICATE"; name: string }
  | { code: "NAME_RESERVED"; name: string }
  | { code: "NAME_COLLIDES_WITH_INPUT"; name: string }
  | { code: "LABEL_REQUIRED"; name: string }
  | { code: "VALUES_REQUIRED"; name: string }
  | { code: "VALUES_DUPLICATE"; name: string }
  | { code: "VALUES_TOO_MANY"; name: string }
  | { code: "VALUE_TOO_LONG"; name: string }
  | { code: "VALUE_HAS_SEPARATOR"; name: string }
  | { code: "DEFAULT_NOT_IN_VALUES"; name: string }
  | { code: "TOO_MANY_INPUTS"; count: number };

/** The `automation.settings.errors.*` key the UI shows for each problem. */
export const PARAM_ERROR_CODES: Record<ParamSchemaError["code"], string> = {
  NAME_INVALID: "paramNameInvalid",
  NAME_DUPLICATE: "paramNameDuplicate",
  NAME_RESERVED: "paramNameReserved",
  NAME_COLLIDES_WITH_INPUT: "paramCollidesWithInput",
  LABEL_REQUIRED: "paramLabelRequired",
  VALUES_REQUIRED: "paramValuesRequired",
  VALUES_DUPLICATE: "paramValuesDuplicate",
  VALUES_TOO_MANY: "paramValuesTooMany",
  VALUE_TOO_LONG: "paramValueTooLong",
  VALUE_HAS_SEPARATOR: "paramValueHasSeparator",
  DEFAULT_NOT_IN_VALUES: "paramDefaultNotInValues",
  TOO_MANY_INPUTS: "tooManyInputs",
};

export function describeParamError(err: ParamSchemaError): string {
  switch (err.code) {
    case "NAME_INVALID":
      return `Parameter name "${err.name}" must start with a letter or underscore and contain only letters, digits and underscores`;
    case "NAME_DUPLICATE":
      return `Parameter "${err.name}" is declared more than once`;
    case "NAME_RESERVED":
      return `Parameter "${err.name}" uses the reserved ${RESERVED_INPUT_PREFIX} prefix`;
    case "NAME_COLLIDES_WITH_INPUT":
      return `Parameter "${err.name}" has the same name as a static input`;
    case "LABEL_REQUIRED":
      return `Parameter "${err.name}" needs a label`;
    case "VALUES_REQUIRED":
      return `Parameter "${err.name}" needs at least one value`;
    case "VALUES_DUPLICATE":
      return `Parameter "${err.name}" lists the same value twice`;
    case "VALUES_TOO_MANY":
      return `Parameter "${err.name}" has more than ${MAX_PARAM_VALUES} values`;
    case "VALUE_TOO_LONG":
      return `A value of parameter "${err.name}" is longer than ${MAX_INPUT_VALUE_LENGTH} characters`;
    case "VALUE_HAS_SEPARATOR":
      return `Values of parameter "${err.name}" cannot contain "${MULTISELECT_SEPARATOR}"`;
    case "DEFAULT_NOT_IN_VALUES":
      return `The default of parameter "${err.name}" is not one of its values`;
    case "TOO_MANY_INPUTS":
      return `At most ${MAX_CUSTOM_INPUT_KEYS} static inputs and parameters are allowed together (got ${err.count})`;
  }
}

/**
 * Check a declared parameter list against the target's static inputs. The
 * per-execution merge lets a later layer win silently, so a parameter that
 * shares a name with a static input is refused here instead of overriding
 * it at dispatch time.
 */
export function validateParamSchema(
  params: ExecutionParam[],
  staticInputs: Record<string, string> = {}
): ParamSchemaError | null {
  const staticKeys = new Set(Object.keys(staticInputs));
  const total = params.length + staticKeys.size;
  if (total > MAX_CUSTOM_INPUT_KEYS) {
    return { code: "TOO_MANY_INPUTS", count: total };
  }
  const seen = new Set<string>();
  for (const param of params) {
    const name = param.name;
    if (!NAME_PATTERN.test(name)) return { code: "NAME_INVALID", name };
    if (name.toUpperCase().startsWith(RESERVED_INPUT_PREFIX)) {
      return { code: "NAME_RESERVED", name };
    }
    if (seen.has(name)) return { code: "NAME_DUPLICATE", name };
    seen.add(name);
    if (staticKeys.has(name)) {
      return { code: "NAME_COLLIDES_WITH_INPUT", name };
    }
    if (!param.label.trim()) return { code: "LABEL_REQUIRED", name };

    if (param.type === "text") {
      if ((param.default ?? "").length > MAX_INPUT_VALUE_LENGTH) {
        return { code: "VALUE_TOO_LONG", name };
      }
      continue;
    }

    if (param.values.length === 0) return { code: "VALUES_REQUIRED", name };
    if (param.values.length > MAX_PARAM_VALUES) {
      return { code: "VALUES_TOO_MANY", name };
    }
    const values = new Set<string>();
    for (const value of param.values) {
      if (value.length === 0 || value.length > MAX_INPUT_VALUE_LENGTH) {
        return { code: "VALUE_TOO_LONG", name };
      }
      if (
        param.type === "multiselect" &&
        value.includes(MULTISELECT_SEPARATOR)
      ) {
        return { code: "VALUE_HAS_SEPARATOR", name };
      }
      if (values.has(value)) return { code: "VALUES_DUPLICATE", name };
      values.add(value);
    }
    const defaults = param.type === "select" ? [param.default] : param.default;
    if (defaults.some((d) => !values.has(d))) {
      return { code: "DEFAULT_NOT_IN_VALUES", name };
    }
  }
  return null;
}

function isParamType(value: unknown): value is ExecutionParamType {
  return (
    typeof value === "string" &&
    (EXECUTION_PARAM_TYPES as readonly string[]).includes(value)
  );
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((v): v is string => typeof v === "string");
}

/**
 * Read a stored `paramSchema` column. Entries that do not fit the shape are
 * dropped rather than failing the read: the column is admin-written through
 * the validated action, so a malformed entry means a hand edit, and the
 * dialogs should still open.
 */
export function normalizeParamSchema(raw: unknown): ExecutionParam[] {
  if (!Array.isArray(raw)) return [];
  const out: ExecutionParam[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec.name !== "string" || !isParamType(rec.type)) continue;
    const label = typeof rec.label === "string" ? rec.label : rec.name;
    if (rec.type === "text") {
      out.push({
        name: rec.name,
        label,
        type: "text",
        ...(typeof rec.default === "string" ? { default: rec.default } : {}),
      });
      continue;
    }
    const values = stringList(rec.values);
    if (!values) continue;
    if (rec.type === "select") {
      out.push({
        name: rec.name,
        label,
        type: "select",
        values,
        default:
          typeof rec.default === "string" ? rec.default : (values[0] ?? ""),
      });
    } else {
      out.push({
        name: rec.name,
        label,
        type: "multiselect",
        values,
        default: stringList(rec.default) ?? [],
      });
    }
  }
  return out;
}

/** What the execute dialog shows before the dispatcher touches anything. */
export type ParamValues = Record<string, string | string[]>;

export function defaultParamValues(params: ExecutionParam[]): ParamValues {
  const out: ParamValues = {};
  for (const param of params) {
    out[param.name] =
      param.type === "multiselect" ? [...param.default] : (param.default ?? "");
  }
  return out;
}

/** Split a stored multiselect input back into the choices it was made from. */
export function splitMultiselectValue(value: string): string[] {
  return value
    .split(MULTISELECT_SEPARATOR)
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * Seed the dialog from a previous execution's stored inputs (a retry): only
 * declared parameters are read, and a choice the target no longer offers
 * falls back to the default.
 */
export function paramValuesFromInputs(
  params: ExecutionParam[],
  inputs: Record<string, string> | null | undefined
): ParamValues {
  const out = defaultParamValues(params);
  if (!inputs) return out;
  for (const param of params) {
    const stored = inputs[param.name];
    if (typeof stored !== "string") continue;
    if (param.type === "text") {
      out[param.name] = stored;
    } else if (param.type === "select") {
      if (param.values.includes(stored)) out[param.name] = stored;
    } else {
      const chosen = splitMultiselectValue(stored).filter((v) =>
        param.values.includes(v)
      );
      out[param.name] = chosen;
    }
  }
  return out;
}

/**
 * Turn the dialog's choices into the per-execution `inputs` map. Every
 * declared parameter is sent, so a CI job can rely on the key being present
 * even when the dispatcher kept the default.
 */
export function serializeParamValues(
  params: ExecutionParam[],
  values: ParamValues
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of params) {
    const value = values[param.name];
    if (param.type === "multiselect") {
      const list = Array.isArray(value) ? value : param.default;
      out[param.name] = list.join(MULTISELECT_SEPARATOR);
    } else {
      out[param.name] =
        typeof value === "string" ? value : (param.default ?? "");
    }
  }
  return out;
}

/** One input of a stored execution, labelled for display. */
export interface ParamInputDescription {
  name: string;
  label: string;
  /** A multiselect's choices one by one; any other value as stored. */
  values: string[];
}

/**
 * Describe a stored execution's `inputs` for display: the target's declared
 * parameters first, in schema order and under their labels, then any other
 * input the request carried (an API caller's custom input) under its key.
 * A declared parameter the execution did not send is left out: it was not
 * chosen, and an older execution predates it.
 */
export function describeParamInputs(
  params: ExecutionParam[],
  inputs: unknown
): ParamInputDescription[] {
  const stored = normalizeInputs(inputs);
  const out: ParamInputDescription[] = [];
  const seen = new Set<string>();
  for (const param of params) {
    const value = stored[param.name];
    if (typeof value !== "string") continue;
    seen.add(param.name);
    out.push({
      name: param.name,
      label: param.label,
      values:
        param.type === "multiselect" ? splitMultiselectValue(value) : [value],
    });
  }
  for (const [name, value] of Object.entries(stored)) {
    if (seen.has(name)) continue;
    out.push({ name, label: name, values: [value] });
  }
  return out;
}
