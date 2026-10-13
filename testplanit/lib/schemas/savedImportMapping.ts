import type { JsonValue } from "@zenstackhq/orm";
import { z } from "zod/v4";

/**
 * Contents of `ImportMapping.config`: each CSV column paired with the field it
 * maps to (null = Ignore Column) plus the parse settings that produced those
 * column names. The wizard kind and the template a test-case mapping was
 * built on are columns on the row, not part of the config.
 *
 * Test-case fields are stored by system name, so a mapping still applies to
 * any other template that carries the same fields.
 */

export const SAVED_IMPORT_MAPPING_CONFIG_VERSION = 1;

export const SAVED_IMPORT_MAPPING_NAME_MAX_LENGTH = 120;
export const SAVED_IMPORT_MAPPING_DESCRIPTION_MAX_LENGTH = 500;

export const IMPORT_MAPPING_WIZARDS = [
  "TEST_CASES",
  "SHARED_STEPS",
  "DATASET",
] as const;

export type ImportMappingWizard = (typeof IMPORT_MAPPING_WIZARDS)[number];

const importMappingSettingsSchema = z.object({
  delimiter: z.enum([",", ";", ":", "|", "\t"]).optional(),
  hasHeaders: z.boolean().optional(),
  encoding: z
    .enum(["UTF-8", "ISO-8859-1", "ISO-8859-15", "Windows-1252"])
    .optional(),
  rowMode: z.enum(["single", "multi"]).optional(),
});

export type ImportMappingSettings = z.infer<typeof importMappingSettingsSchema>;

const savedImportMappingConfigSchema = z.object({
  version: z.literal(SAVED_IMPORT_MAPPING_CONFIG_VERSION),
  columns: z.array(
    z.object({
      column: z.string(),
      field: z.string().nullable(),
    })
  ),
  settings: importMappingSettingsSchema,
});

export type SavedImportMappingConfig = z.infer<
  typeof savedImportMappingConfigSchema
>;

/** One CSV column and the field it maps to; `null` means Ignore Column. */
export interface ImportColumnMapping {
  column: string;
  field: string | null;
}

export function buildSavedImportMappingConfig(input: {
  columns: ImportColumnMapping[];
  settings?: ImportMappingSettings;
}): JsonValue {
  const config: SavedImportMappingConfig = {
    version: SAVED_IMPORT_MAPPING_CONFIG_VERSION,
    columns: input.columns.map(({ column, field }) => ({ column, field })),
    settings: input.settings ?? {},
  };
  return JSON.parse(JSON.stringify(config)) as JsonValue;
}

/**
 * Validate a persisted config. Returns `null` for a malformed or
 * unknown-version config so the UI can refuse to load it instead of throwing.
 */
export function parseSavedImportMappingConfig(
  raw: unknown
): SavedImportMappingConfig | null {
  const result = savedImportMappingConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/**
 * How well a saved mapping fits the file's headers: 0 unless every saved
 * column is in the file, otherwise the share of the file's columns it covers.
 * A mapping built from a file with the same headers scores 1.
 */
export function scoreImportMappingMatch(
  saved: readonly ImportColumnMapping[],
  headers: readonly string[]
): number {
  if (saved.length === 0 || headers.length === 0) return 0;
  const fileColumns = new Set(headers);
  const savedColumns = new Set(saved.map((m) => m.column));
  for (const column of savedColumns) {
    if (!fileColumns.has(column)) return 0;
  }
  return savedColumns.size / fileColumns.size;
}

/**
 * Whether a saved mapping maps the same columns to the same fields with the
 * same settings as the current one, regardless of column order.
 */
export function isSameImportMapping(
  saved: SavedImportMappingConfig,
  current: { columns: ImportColumnMapping[]; settings?: ImportMappingSettings }
): boolean {
  if (saved.columns.length !== current.columns.length) return false;
  const savedByColumn = new Map(saved.columns.map((m) => [m.column, m.field]));
  const sameColumns = current.columns.every(
    (m) =>
      savedByColumn.has(m.column) && savedByColumn.get(m.column) === m.field
  );
  if (!sameColumns) return false;
  const settings = current.settings ?? {};
  const keys = new Set([
    ...Object.keys(saved.settings),
    ...Object.keys(settings),
  ]) as Set<keyof ImportMappingSettings>;
  return [...keys].every((key) => saved.settings[key] === settings[key]);
}

export interface AppliedImportMapping {
  mappings: ImportColumnMapping[];
  /** Saved columns the current file does not have. */
  missingColumns: string[];
  /** Saved columns whose field is not available here; left on Ignore Column. */
  unavailableFields: ImportColumnMapping[];
}

/**
 * Apply a saved mapping to the current file's mapping. Every current column
 * named in the saved mapping takes the saved field; the others keep their
 * auto-matched value unless that field was claimed by a saved column, since a
 * field maps from one column at most.
 */
export function applySavedImportMapping(
  current: ImportColumnMapping[],
  saved: ImportColumnMapping[],
  availableFields: readonly string[]
): AppliedImportMapping {
  const available = new Set(availableFields);
  const currentColumns = new Set(current.map((m) => m.column));
  const savedByColumn = new Map<string, string | null>();
  for (const { column, field } of saved) {
    if (!savedByColumn.has(column)) savedByColumn.set(column, field);
  }

  const missingColumns = [...savedByColumn.keys()].filter(
    (column) => !currentColumns.has(column)
  );
  const unavailableFields: ImportColumnMapping[] = [];
  const claimed = new Set<string>();

  const withSaved = current.map(({ column, field }) => {
    if (!savedByColumn.has(column)) return { column, field, fromSaved: false };
    const savedField = savedByColumn.get(column) ?? null;
    if (savedField === null) return { column, field: null, fromSaved: true };
    if (!available.has(savedField) || claimed.has(savedField)) {
      unavailableFields.push({ column, field: savedField });
      return { column, field: null, fromSaved: true };
    }
    claimed.add(savedField);
    return { column, field: savedField, fromSaved: true };
  });

  const mappings = withSaved.map(({ column, field, fromSaved }) => ({
    column,
    field: !fromSaved && field !== null && claimed.has(field) ? null : field,
  }));

  return { mappings, missingColumns, unavailableFields };
}
