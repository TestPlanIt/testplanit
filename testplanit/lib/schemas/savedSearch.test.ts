import { describe, expect, it } from "vitest";

import { SearchableEntityType } from "~/types/search";

import {
  buildSavedSearchConfig,
  parseSavedSearchConfig,
  SAVED_SEARCH_CONFIG_VERSION,
  type SavedSearchCriteria,
} from "./savedSearch";

function buildCriteria(
  overrides: Partial<SavedSearchCriteria> = {}
): SavedSearchCriteria {
  return {
    query: "login failure",
    selectedEntities: [
      SearchableEntityType.REPOSITORY_CASE,
      SearchableEntityType.TEST_RUN,
    ],
    currentProjectOnly: false,
    filters: {
      repositoryCase: {
        tagIds: [3, 7],
        automated: true,
        dateRange: {
          field: "createdAt",
          from: new Date("2026-01-01T00:00:00.000Z"),
          to: new Date("2026-02-01T00:00:00.000Z"),
        },
      },
    },
    ...overrides,
  };
}

describe("buildSavedSearchConfig", () => {
  it("stamps the current version and keeps the applyable fields", () => {
    const config = buildSavedSearchConfig(buildCriteria()) as any;
    expect(config.version).toBe(SAVED_SEARCH_CONFIG_VERSION);
    expect(config.query).toBe("login failure");
    expect(config.selectedEntities).toEqual([
      SearchableEntityType.REPOSITORY_CASE,
      SearchableEntityType.TEST_RUN,
    ]);
    expect(config.currentProjectOnly).toBe(false);
    expect(config.filters.repositoryCase?.tagIds).toEqual([3, 7]);
  });
});

describe("parseSavedSearchConfig", () => {
  it("round-trips through JSON and revives date filters to Date objects", () => {
    const config = buildSavedSearchConfig(buildCriteria());
    // Simulate the Prisma Json column: Dates serialize to ISO strings.
    const persisted = JSON.parse(JSON.stringify(config));
    expect(typeof persisted.filters.repositoryCase.dateRange.from).toBe(
      "string"
    );

    const parsed = parseSavedSearchConfig(persisted);
    expect(parsed).not.toBeNull();
    const from = parsed!.filters.repositoryCase?.dateRange?.from;
    const to = parsed!.filters.repositoryCase?.dateRange?.to;
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
    expect(from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed!.query).toBe("login failure");
    expect(parsed!.selectedEntities).toContain(
      SearchableEntityType.REPOSITORY_CASE
    );
  });

  it("revives a milestone dueDateRange", () => {
    const config = buildSavedSearchConfig(
      buildCriteria({
        selectedEntities: [SearchableEntityType.MILESTONE],
        filters: {
          milestone: {
            dueDateRange: {
              from: new Date("2026-03-01T00:00:00.000Z"),
              to: new Date("2026-03-31T00:00:00.000Z"),
            },
          },
        },
      })
    );
    const parsed = parseSavedSearchConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed!.filters.milestone?.dueDateRange?.from).toBeInstanceOf(Date);
  });

  it("preserves custom-field values without coercing them", () => {
    const config = buildSavedSearchConfig(
      buildCriteria({
        filters: {
          repositoryCase: {
            customFields: [
              {
                fieldId: 42,
                fieldName: "Priority",
                fieldType: "Select",
                operator: "equals",
                value: "High",
              },
            ],
          },
        },
      })
    );
    const parsed = parseSavedSearchConfig(JSON.parse(JSON.stringify(config)));
    expect(parsed!.filters.repositoryCase?.customFields?.[0]?.value).toBe(
      "High"
    );
  });

  it("accepts a custom field whose value key was dropped by JSON serialization", () => {
    // An unset value serializes to `undefined`, and JSON.stringify removes the
    // key entirely — the schema must treat the absent key as valid, not reject
    // the whole config.
    const config = buildSavedSearchConfig(
      buildCriteria({
        filters: {
          repositoryCase: {
            customFields: [
              {
                fieldId: 42,
                fieldName: "Priority",
                fieldType: "Select",
                operator: "equals",
                value: undefined,
              },
            ],
          },
        },
      })
    );
    const wire = JSON.parse(JSON.stringify(config));
    expect("value" in wire.filters.repositoryCase.customFields[0]).toBe(false);

    const parsed = parseSavedSearchConfig(wire);
    expect(parsed).not.toBeNull();
    expect(parsed!.filters.repositoryCase?.customFields?.[0]?.fieldId).toBe(42);
  });

  it("returns null for an unrecognized version", () => {
    const config = buildSavedSearchConfig(buildCriteria()) as Record<
      string,
      unknown
    >;
    expect(parseSavedSearchConfig({ ...config, version: 99 })).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(parseSavedSearchConfig(null)).toBeNull();
    expect(parseSavedSearchConfig({ query: 123 })).toBeNull();
    expect(
      parseSavedSearchConfig({
        version: SAVED_SEARCH_CONFIG_VERSION,
        query: "x",
        selectedEntities: ["not_a_real_entity"],
        currentProjectOnly: false,
        filters: {},
      })
    ).toBeNull();
  });
});
