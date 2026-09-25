import { describe, expect, it } from "vitest";

import {
  applySavedImportMapping,
  buildSavedImportMappingConfig,
  isSameImportMapping,
  parseSavedImportMappingConfig,
  SAVED_IMPORT_MAPPING_CONFIG_VERSION,
  scoreImportMappingMatch,
} from "./savedImportMapping";

describe("buildSavedImportMappingConfig / parseSavedImportMappingConfig", () => {
  it("round-trips columns and settings", () => {
    const config = buildSavedImportMappingConfig({
      columns: [
        { column: "Title", field: "name" },
        { column: "Notes", field: null },
      ],
      settings: {
        delimiter: ";",
        hasHeaders: true,
        encoding: "Windows-1252",
        rowMode: "multi",
      },
    });

    expect(parseSavedImportMappingConfig(config)).toEqual({
      version: SAVED_IMPORT_MAPPING_CONFIG_VERSION,
      columns: [
        { column: "Title", field: "name" },
        { column: "Notes", field: null },
      ],
      settings: {
        delimiter: ";",
        hasHeaders: true,
        encoding: "Windows-1252",
        rowMode: "multi",
      },
    });
  });

  it("defaults settings to empty when none are given", () => {
    const config = buildSavedImportMappingConfig({
      columns: [{ column: "user", field: "user" }],
    });
    expect(parseSavedImportMappingConfig(config)?.settings).toEqual({});
  });

  it("rejects malformed and unknown-version configs", () => {
    expect(parseSavedImportMappingConfig(null)).toBeNull();
    expect(parseSavedImportMappingConfig({ version: 1 })).toBeNull();
    expect(
      parseSavedImportMappingConfig({ version: 2, columns: [], settings: {} })
    ).toBeNull();
    expect(
      parseSavedImportMappingConfig({
        version: 1,
        columns: [],
        settings: { delimiter: "#" },
      })
    ).toBeNull();
  });
});

describe("applySavedImportMapping", () => {
  const fields = ["name", "steps", "expectedResult", "priority"];

  it("sets saved columns and keeps auto-matched values on the rest", () => {
    const result = applySavedImportMapping(
      [
        { column: "Title", field: "name" },
        { column: "Prio", field: null },
        { column: "Action", field: "steps" },
      ],
      [{ column: "Prio", field: "priority" }],
      fields
    );

    expect(result.mappings).toEqual([
      { column: "Title", field: "name" },
      { column: "Prio", field: "priority" },
      { column: "Action", field: "steps" },
    ]);
    expect(result.missingColumns).toEqual([]);
    expect(result.unavailableFields).toEqual([]);
  });

  it("lets a saved Ignore Column override an auto match", () => {
    const result = applySavedImportMapping(
      [{ column: "Title", field: "name" }],
      [{ column: "Title", field: null }],
      fields
    );
    expect(result.mappings).toEqual([{ column: "Title", field: null }]);
  });

  it("reports saved columns missing from the file", () => {
    const result = applySavedImportMapping(
      [{ column: "Title", field: "name" }],
      [
        { column: "Title", field: "name" },
        { column: "Gone", field: "priority" },
      ],
      fields
    );
    expect(result.missingColumns).toEqual(["Gone"]);
  });

  it("ignores columns whose saved field isn't available", () => {
    const result = applySavedImportMapping(
      [{ column: "Severity", field: "priority" }],
      [{ column: "Severity", field: "severity" }],
      fields
    );
    expect(result.mappings).toEqual([{ column: "Severity", field: null }]);
    expect(result.unavailableFields).toEqual([
      { column: "Severity", field: "severity" },
    ]);
  });

  it("clears an auto match that takes a field a saved column claimed", () => {
    const result = applySavedImportMapping(
      [
        { column: "Title", field: "name" },
        { column: "Case", field: null },
      ],
      [{ column: "Case", field: "name" }],
      fields
    );
    expect(result.mappings).toEqual([
      { column: "Title", field: null },
      { column: "Case", field: "name" },
    ]);
  });
});

describe("scoreImportMappingMatch", () => {
  const saved = [
    { column: "Title", field: "name" },
    { column: "Steps", field: "steps" },
  ];

  it("scores 1 when the file has exactly the saved columns", () => {
    expect(scoreImportMappingMatch(saved, ["Steps", "Title"])).toBe(1);
  });

  it("scores the share of file columns covered", () => {
    expect(
      scoreImportMappingMatch(saved, ["Title", "Steps", "Owner", "Area"])
    ).toBe(0.5);
  });

  it("scores 0 when a saved column is missing from the file", () => {
    expect(scoreImportMappingMatch(saved, ["Title", "Owner"])).toBe(0);
  });

  it("scores 0 for empty input", () => {
    expect(scoreImportMappingMatch([], ["Title"])).toBe(0);
    expect(scoreImportMappingMatch(saved, [])).toBe(0);
  });
});

describe("isSameImportMapping", () => {
  const saved = {
    version: 1 as const,
    columns: [
      { column: "Title", field: "name" },
      { column: "Notes", field: null },
    ],
    settings: { delimiter: ";" as const, hasHeaders: true },
  };

  it("matches the same columns and settings in any order", () => {
    expect(
      isSameImportMapping(saved, {
        columns: [
          { column: "Notes", field: null },
          { column: "Title", field: "name" },
        ],
        settings: { hasHeaders: true, delimiter: ";" },
      })
    ).toBe(true);
  });

  it("differs when a field, a column or a setting differs", () => {
    const settings = { delimiter: ";" as const, hasHeaders: true };
    expect(
      isSameImportMapping(saved, {
        columns: [
          { column: "Title", field: null },
          { column: "Notes", field: null },
        ],
        settings,
      })
    ).toBe(false);
    expect(
      isSameImportMapping(saved, {
        columns: [{ column: "Title", field: "name" }],
        settings,
      })
    ).toBe(false);
    expect(
      isSameImportMapping(saved, {
        columns: saved.columns,
        settings: { ...settings, delimiter: "," },
      })
    ).toBe(false);
  });
});
