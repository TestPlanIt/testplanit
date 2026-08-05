import { describe, expect, it } from "vitest";

import { buildFilterDimensions } from "~/lib/repository/filterDimensions";
import {
  MAX_FILTER_PREDICATES,
  MAX_VALUES_PER_PREDICATE,
  type FilterPredicate,
} from "~/lib/schemas/repositoryFilterPredicates";
import {
  buildSavedRepositoryViewConfig,
  dynamicViewAxisFieldId,
  hasSavableRepositoryViewState,
  isRepositoryViewAxis,
  parseSavedRepositoryViewConfig,
  parseSavedRepositoryViewConfigWithReport,
  SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
  SAVED_REPOSITORY_VIEW_SEARCH_MAX_LENGTH,
} from "~/lib/schemas/savedRepositoryView";

const PROJECT_ID = 7;

/** Registry with one live dynamic field (id 42) — id 99 is the "deleted" one. */
const registry = buildFilterDimensions({
  dynamicFields: [{ fieldId: 42, type: "Dropdown" }],
});

const options = { registry, expectedProjectId: PROJECT_ID };

describe("savedRepositoryView contract", () => {
  it("round-trips predicates, axis and search through save/load", () => {
    const predicates: FilterPredicate[] = [
      { dimension: "templates", operator: "in", values: [1, 2] },
      { dimension: "tags", operator: "none", values: [] },
      { dimension: "field_42", operator: "any", values: [5] },
    ];

    const stored = buildSavedRepositoryViewConfig({
      projectId: PROJECT_ID,
      predicates,
      axis: "dynamic_42_Dropdown",
      search: "  login  ",
    });

    // Persisted values must survive the JSON boundary Prisma writes them over.
    const criteria = parseSavedRepositoryViewConfig(
      JSON.parse(JSON.stringify(stored)),
      options
    );

    expect(criteria).toEqual({
      projectId: PROJECT_ID,
      predicates,
      axis: "dynamic_42_Dropdown",
      search: "login",
    });
  });

  it("drops a predicate on a dimension that no longer exists and keeps the rest", () => {
    const stored = buildSavedRepositoryViewConfig({
      projectId: PROJECT_ID,
      predicates: [
        { dimension: "templates", operator: "in", values: [1] },
        // A custom field that has since been deleted from the project.
        { dimension: "field_99", operator: "in", values: [3] },
        // A run-only dimension, absent from the repository-mode registry.
        { dimension: "status", operator: "in", values: [4] },
      ],
      axis: "folders",
      search: "",
    });

    const result = parseSavedRepositoryViewConfigWithReport(stored, options);

    expect(result.status).toBe("ok");
    expect(result.criteria?.predicates).toEqual([
      { dimension: "templates", operator: "in", values: [1] },
    ]);
    expect(result.droppedPredicateCount).toBe(2);
  });

  it("drops predicates with an unknown operator or bad values, never throwing", () => {
    const result = parseSavedRepositoryViewConfigWithReport(
      {
        version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
        projectId: PROJECT_ID,
        predicates: [
          { dimension: "templates", operator: "contains", values: ["x"] },
          { dimension: "templates", operator: "in", values: ["not-an-id"] },
          "garbage",
          null,
          { dimension: "tags", operator: "any", values: [] },
        ],
      },
      options
    );

    expect(result.status).toBe("ok");
    expect(result.criteria?.predicates).toEqual([
      { dimension: "tags", operator: "any", values: [] },
    ]);
    expect(result.droppedPredicateCount).toBe(4);
  });

  it("treats a non-array predicates field as no filters", () => {
    const result = parseSavedRepositoryViewConfigWithReport(
      {
        version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
        projectId: PROJECT_ID,
        predicates: "templates:in:1",
      },
      options
    );

    expect(result.status).toBe("ok");
    expect(result.criteria?.predicates).toEqual([]);
    expect(result.criteria?.search).toBe("");
    expect(result.criteria?.axis).toBeNull();
  });

  it("rejects a config saved by a newer version instead of half-applying it", () => {
    const result = parseSavedRepositoryViewConfigWithReport(
      {
        version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION + 1,
        projectId: PROJECT_ID,
        predicates: [{ dimension: "templates", operator: "in", values: [1] }],
        columns: ["id", "title"],
      },
      options
    );

    expect(result.status).toBe("version-mismatch");
    expect(result.criteria).toBeNull();
    expect(parseSavedRepositoryViewConfig({ version: 0 }, options)).toBeNull();
  });

  it("rejects malformed configs and configs from another project", () => {
    expect(parseSavedRepositoryViewConfig(null, options)).toBeNull();
    expect(parseSavedRepositoryViewConfig("not-json", options)).toBeNull();
    expect(
      parseSavedRepositoryViewConfig(
        { version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION },
        options
      )
    ).toBeNull();

    const otherProject = buildSavedRepositoryViewConfig({
      projectId: PROJECT_ID + 1,
      predicates: [],
      axis: "folders",
      search: "",
    });
    expect(parseSavedRepositoryViewConfig(otherProject, options)).toBeNull();
    // Without expectedProjectId the same config parses — the owning project
    // simply comes back in the criteria.
    expect(
      parseSavedRepositoryViewConfig(otherProject, { registry })?.projectId
    ).toBe(PROJECT_ID + 1);
  });

  it("degrades a grouping axis whose custom field was deleted", () => {
    const stored = buildSavedRepositoryViewConfig({
      projectId: PROJECT_ID,
      predicates: [],
      axis: "dynamic_99_Dropdown",
      search: "",
    });

    const result = parseSavedRepositoryViewConfigWithReport(stored, {
      ...options,
      knownDynamicAxisFieldIds: new Set([42]),
    });

    expect(result.status).toBe("ok");
    expect(result.criteria?.axis).toBeNull();
    expect(result.axisDropped).toBe(true);

    // Without the known-field set the axis is kept (structure-only check).
    expect(
      parseSavedRepositoryViewConfigWithReport(stored, options).criteria?.axis
    ).toBe("dynamic_99_Dropdown");
  });

  it("drops a structurally invalid axis on both the write and read paths", () => {
    const stored = buildSavedRepositoryViewConfig({
      projectId: PROJECT_ID,
      predicates: [],
      axis: "not-a-view",
      search: "",
    }) as { axis: string | null };

    expect(stored.axis).toBeNull();

    const result = parseSavedRepositoryViewConfigWithReport(
      {
        version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
        projectId: PROJECT_ID,
        predicates: [],
        axis: "not-a-view",
      },
      options
    );
    expect(result.criteria?.axis).toBeNull();
    expect(result.axisDropped).toBe(true);
  });

  it("clamps predicate and value counts on the write path", () => {
    const predicates: FilterPredicate[] = Array.from(
      { length: MAX_FILTER_PREDICATES + 5 },
      () => ({ dimension: "templates", operator: "in", values: [1] })
    );
    predicates[0] = {
      dimension: "templates",
      operator: "in",
      values: Array.from({ length: MAX_VALUES_PER_PREDICATE + 3 }, (_, i) => i),
    };

    const stored = buildSavedRepositoryViewConfig({
      projectId: PROJECT_ID,
      predicates,
      axis: null,
      search: "x".repeat(SAVED_REPOSITORY_VIEW_SEARCH_MAX_LENGTH + 50),
    }) as unknown as { predicates: FilterPredicate[]; search: string };

    expect(stored.predicates).toHaveLength(MAX_FILTER_PREDICATES);
    expect(stored.predicates[0].values).toHaveLength(MAX_VALUES_PER_PREDICATE);
    expect(stored.search).toHaveLength(SAVED_REPOSITORY_VIEW_SEARCH_MAX_LENGTH);

    const result = parseSavedRepositoryViewConfigWithReport(stored, options);
    expect(result.criteria?.predicates).toHaveLength(MAX_FILTER_PREDICATES);
    expect(result.droppedPredicateCount).toBe(0);
  });

  it("reports read-path cap truncation for an over-cap stored config", () => {
    const result = parseSavedRepositoryViewConfigWithReport(
      {
        version: SAVED_REPOSITORY_VIEW_CONFIG_VERSION,
        projectId: PROJECT_ID,
        predicates: Array.from({ length: MAX_FILTER_PREDICATES + 2 }, () => ({
          dimension: "templates",
          operator: "in",
          values: [1],
        })),
      },
      options
    );

    expect(result.truncation.predicatesDropped).toBe(2);
    expect(result.criteria?.predicates).toHaveLength(MAX_FILTER_PREDICATES);
  });

  it("recognizes static and dynamic axes", () => {
    expect(isRepositoryViewAxis("folders")).toBe(true);
    expect(isRepositoryViewAxis("dynamic_42_Text Long")).toBe(true);
    expect(isRepositoryViewAxis("dynamic_42")).toBe(false);
    expect(isRepositoryViewAxis("nope")).toBe(false);
    expect(dynamicViewAxisFieldId("dynamic_42_Dropdown")).toBe(42);
    expect(dynamicViewAxisFieldId("folders")).toBeNull();
  });

  it("knows when there is nothing worth saving", () => {
    expect(
      hasSavableRepositoryViewState({
        predicates: [],
        axis: null,
        search: "  ",
      })
    ).toBe(false);
    expect(
      hasSavableRepositoryViewState({
        predicates: [],
        axis: "folders",
        search: "",
      })
    ).toBe(true);
    expect(
      hasSavableRepositoryViewState({
        predicates: [{ dimension: "tags", operator: "any", values: [] }],
        axis: null,
        search: "",
      })
    ).toBe(true);
  });
});
