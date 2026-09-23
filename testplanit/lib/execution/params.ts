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

/**
 * The inputs a configuration parameter becomes. The dialog (and an API
 * caller) sends the chosen ids under `id`; the server resolves them and
 * fills `name` and `variants` (`Category=Variant` pairs) so a job can act
 * on whichever it prefers.
 */
export function configurationInputKeys(name: string): {
  id: string;
  name: string;
  variants: string;
} {
  return { id: `${name}_ID`, name, variants: `${name}_VARIANTS` };
}

/** How many input keys a declared parameter occupies. */
export function paramInputCount(param: ExecutionParam): number {
  return param.type === "configuration" ? 3 : 1;
}

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
  | { code: "DEFAULT_NOT_SINGLE"; name: string }
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
  DEFAULT_NOT_SINGLE: "paramDefaultNotSingle",
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
    case "DEFAULT_NOT_SINGLE":
      return `Parameter "${err.name}" allows one configuration, so it can have at most one default`;
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
  const total =
    params.reduce((n, p) => n + paramInputCount(p), 0) + staticKeys.size;
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
    // A configuration parameter occupies its derived keys too, so another
    // parameter or a static input named like one of them would be
    // overwritten at execute time.
    const keys =
      param.type === "configuration"
        ? Object.values(configurationInputKeys(name))
        : [name];
    for (const key of keys) {
      if (seen.has(key)) return { code: "NAME_DUPLICATE", name: key };
      seen.add(key);
      if (staticKeys.has(key)) {
        return { code: "NAME_COLLIDES_WITH_INPUT", name: key };
      }
    }
    if (!param.label.trim()) return { code: "LABEL_REQUIRED", name };

    if (param.type === "configuration") {
      if (param.default.length > MAX_PARAM_VALUES) {
        return { code: "VALUES_TOO_MANY", name };
      }
      if (!param.multiple && param.default.length > 1) {
        return { code: "DEFAULT_NOT_SINGLE", name };
      }
      if (new Set(param.default).size !== param.default.length) {
        return { code: "VALUES_DUPLICATE", name };
      }
      continue;
    }

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

function idList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0
  );
}

/** Parse a stored `<name>_ID` input ("12" or "12,15") back into ids. */
export function parseConfigurationIds(value: string | undefined): number[] {
  if (!value) return [];
  const out: number[] = [];
  for (const part of value.split(MULTISELECT_SEPARATOR)) {
    const id = Number(part.trim());
    if (Number.isInteger(id) && id > 0 && !out.includes(id)) out.push(id);
  }
  return out;
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
    if (rec.type === "configuration") {
      const multiple = rec.multiple === true;
      const defaults = idList(rec.default);
      out.push({
        name: rec.name,
        label,
        type: "configuration",
        multiple,
        default: multiple ? defaults : defaults.slice(0, 1),
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

/**
 * What the execute dialog shows before the dispatcher touches anything.
 * Keyed by parameter name; a configuration parameter holds its chosen ids
 * as strings (one, or a list when it allows several).
 */
export type ParamValues = Record<string, string | string[]>;

export function defaultParamValues(params: ExecutionParam[]): ParamValues {
  const out: ParamValues = {};
  for (const param of params) {
    if (param.type === "multiselect") {
      out[param.name] = [...param.default];
    } else if (param.type === "configuration") {
      const ids = param.default.map(String);
      out[param.name] = param.multiple ? ids : (ids[0] ?? "");
    } else {
      out[param.name] = param.default ?? "";
    }
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
    if (param.type === "configuration") {
      // Whether a stored id is still assigned to the project is the
      // picker's business: it only offers the current ones.
      const stored = inputs[configurationInputKeys(param.name).id];
      if (typeof stored !== "string") continue;
      const ids = parseConfigurationIds(stored).map(String);
      out[param.name] = param.multiple ? ids : (ids[0] ?? "");
      continue;
    }
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
 * even when the dispatcher kept the default. A configuration parameter is
 * sent as its ids under `<name>_ID`; the server derives the rest.
 */
export function serializeParamValues(
  params: ExecutionParam[],
  values: ParamValues
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of params) {
    const value = values[param.name];
    if (param.type === "configuration") {
      const list = Array.isArray(value) ? value : value ? [value] : [];
      const ids = list.length > 0 ? list : param.default.map(String);
      out[configurationInputKeys(param.name).id] = (
        param.multiple ? ids : ids.slice(0, 1)
      ).join(MULTISELECT_SEPARATOR);
      continue;
    }
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
  /** Chosen through a parameter the target declares (vs. sent some other way). */
  declared: boolean;
}

/**
 * Describe a stored execution's `inputs` for display: the target's declared
 * parameters first, in schema order and under their labels, then any other
 * input the job received under its key. A declared parameter the execution
 * did not send is left out: it was not chosen, and an older execution
 * predates it.
 *
 * Before dispatch the stored inputs are the request's own (the parameter
 * choices); the dispatcher then stores the full set it sent, which adds the
 * target's static inputs and the reserved TESTPLANIT_* identifiers. The
 * identifiers are dropped here: they are the run, execution and plan URL the
 * page already shows.
 */
export function describeParamInputs(
  params: ExecutionParam[],
  inputs: unknown
): ParamInputDescription[] {
  const stored = normalizeInputs(inputs);
  const out: ParamInputDescription[] = [];
  const seen = new Set<string>();
  for (const param of params) {
    if (param.type === "configuration") {
      // The name is what a person recognises; the id and variants the job
      // received are folded into the same entry rather than listed as
      // separate inputs.
      const keys = configurationInputKeys(param.name);
      const name = stored[keys.name];
      const id = stored[keys.id];
      if (typeof name !== "string" && typeof id !== "string") continue;
      seen.add(keys.id).add(keys.name).add(keys.variants);
      const value = typeof name === "string" ? name : (id ?? "");
      out.push({
        name: param.name,
        label: param.label,
        values: value ? [value] : [],
        declared: true,
      });
      continue;
    }
    const value = stored[param.name];
    if (typeof value !== "string") continue;
    seen.add(param.name);
    out.push({
      name: param.name,
      label: param.label,
      values:
        param.type === "multiselect" ? splitMultiselectValue(value) : [value],
      declared: true,
    });
  }
  for (const [name, value] of Object.entries(stored)) {
    if (seen.has(name)) continue;
    if (name.toUpperCase().startsWith(RESERVED_INPUT_PREFIX)) continue;
    out.push({ name, label: name, values: [value], declared: false });
  }
  return out;
}
