import { beforeEach, describe, expect, it, vi } from "vitest";
import { CustomFieldFilter, SearchableEntityType } from "~/types/search";
import {
  addCustomFieldFilters, addDateRangeFilter, addIssueFilters,
  addMilestoneFilters, addProjectFilters, addRepositoryCaseFilters, addSessionFilters,
  addSharedStepFilters, addTestRunFilters, buildCustomFieldQuery, buildElasticsearchQuery, buildSearchAggregations, buildSort, getEntityTypeCounts, getEntityTypeFromIndex, processFacets, stripNestedClauses
} from "./searchQueryBuilder";

// Mock the server/db module for buildElasticsearchQuery tests
vi.mock("~/server/db", () => ({
  db: {
    projectAssignment: {
      findMany: vi.fn().mockResolvedValue([
        { projectId: 1 },
        { projectId: 2 },
      ]),
    },
  },
}));

// ============================================================
// getEntityTypeFromIndex
// ============================================================
describe("getEntityTypeFromIndex", () => {
  describe("single-tenant index names", () => {
    it.each([
      ["testplanit-repository-cases", SearchableEntityType.REPOSITORY_CASE],
      ["testplanit-shared-steps", SearchableEntityType.SHARED_STEP],
      ["testplanit-test-runs", SearchableEntityType.TEST_RUN],
      ["testplanit-sessions", SearchableEntityType.SESSION],
      ["testplanit-projects", SearchableEntityType.PROJECT],
      ["testplanit-issues", SearchableEntityType.ISSUE],
      ["testplanit-milestones", SearchableEntityType.MILESTONE],
    ])("maps %s to %s", (indexName, expectedType) => {
      expect(getEntityTypeFromIndex(indexName)).toBe(expectedType);
    });
  });

  describe("multi-tenant index names", () => {
    it.each([
      ["testplanit-abc123-repository-cases", SearchableEntityType.REPOSITORY_CASE],
      ["testplanit-tenant-xyz-shared-steps", SearchableEntityType.SHARED_STEP],
      ["testplanit-my-org-test-runs", SearchableEntityType.TEST_RUN],
      ["testplanit-t1-sessions", SearchableEntityType.SESSION],
      ["testplanit-org99-projects", SearchableEntityType.PROJECT],
      ["testplanit-tenant-id-issues", SearchableEntityType.ISSUE],
      ["testplanit-company-milestones", SearchableEntityType.MILESTONE],
    ])("maps %s to %s", (indexName, expectedType) => {
      expect(getEntityTypeFromIndex(indexName)).toBe(expectedType);
    });
  });

  it("falls back to REPOSITORY_CASE for unknown index names", () => {
    expect(getEntityTypeFromIndex("unknown-index")).toBe(
      SearchableEntityType.REPOSITORY_CASE
    );
  });

  it("falls back to REPOSITORY_CASE for empty string", () => {
    expect(getEntityTypeFromIndex("")).toBe(
      SearchableEntityType.REPOSITORY_CASE
    );
  });
});

// ============================================================
// stripNestedClauses
// ============================================================
describe("stripNestedClauses", () => {
  it("strips nested queries from must → bool → should", () => {
    const query = {
      bool: {
        must: [
          {
            bool: {
              should: [
                { query_string: { query: "test" } },
                { nested: { path: "steps", query: { match: {} } } },
                { nested: { path: "items", query: { match: {} } } },
                { nested: { path: "customFields", query: { match: {} } } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
        filter: [],
      },
    };

    const result = stripNestedClauses(query);

    // Should keep only the query_string, not the nested queries
    expect(result.bool.must).toHaveLength(1);
    expect(result.bool.must[0].bool.should).toHaveLength(1);
    expect(result.bool.must[0].bool.should[0]).toEqual({
      query_string: { query: "test" },
    });
  });

  it("strips nested queries from filter array", () => {
    const query = {
      bool: {
        must: [],
        filter: [
          { term: { isDeleted: false } },
          { nested: { path: "tags", query: { terms: { "tags.id": [1] } } } },
          { nested: { path: "customFields", query: { bool: {} } } },
          { exists: { field: "projectId" } },
        ],
      },
    };

    const result = stripNestedClauses(query);

    expect(result.bool.filter).toHaveLength(2);
    expect(result.bool.filter[0]).toEqual({ term: { isDeleted: false } });
    expect(result.bool.filter[1]).toEqual({ exists: { field: "projectId" } });
  });

  it("removes must clause entirely when all should items are nested", () => {
    const query = {
      bool: {
        must: [
          {
            bool: {
              should: [
                { nested: { path: "steps", query: {} } },
                { nested: { path: "items", query: {} } },
              ],
              minimum_should_match: 1,
            },
          },
        ],
        filter: [],
      },
    };

    const result = stripNestedClauses(query);

    // The entire must clause should be removed since all should items were nested
    expect(result.bool.must).toHaveLength(0);
  });

  it("preserves non-nested queries in both must and filter", () => {
    const query = {
      bool: {
        must: [
          { match: { name: "test" } },
        ],
        filter: [
          { term: { isDeleted: false } },
          { terms: { projectId: [1, 2] } },
        ],
      },
    };

    const result = stripNestedClauses(query);

    expect(result.bool.must).toHaveLength(1);
    expect(result.bool.must[0]).toEqual({ match: { name: "test" } });
    expect(result.bool.filter).toHaveLength(2);
  });

  it("returns query unchanged if no bool wrapper", () => {
    const query = { match_all: {} };
    expect(stripNestedClauses(query)).toEqual({ match_all: {} });
  });

  it("returns null/undefined input unchanged", () => {
    expect(stripNestedClauses(null)).toBeNull();
    expect(stripNestedClauses(undefined)).toBeUndefined();
  });

  it("does not mutate the original query", () => {
    const original = {
      bool: {
        must: [
          {
            bool: {
              should: [
                { query_string: { query: "test" } },
                { nested: { path: "steps", query: {} } },
              ],
            },
          },
        ],
        filter: [
          { term: { isDeleted: false } },
          { nested: { path: "tags", query: {} } },
        ],
      },
    };

    const originalMustLength = original.bool.must[0].bool.should.length;
    const originalFilterLength = original.bool.filter.length;

    stripNestedClauses(original);

    // Original should not be modified
    expect(original.bool.must[0].bool.should).toHaveLength(originalMustLength);
    expect(original.bool.filter).toHaveLength(originalFilterLength);
  });
});

// ============================================================
// buildCustomFieldQuery
// ============================================================
describe("buildCustomFieldQuery", () => {
  const makeCf = (overrides: Partial<CustomFieldFilter>): CustomFieldFilter => ({
    fieldId: 1,
    fieldName: "Test Field",
    fieldType: "Text String",
    operator: "equals",
    value: "test",
    ...overrides,
  });

  describe("Checkbox", () => {
    it("returns term query on valueBoolean", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Checkbox", value: true }))).toEqual({
        term: { "customFields.valueBoolean": true },
      });
    });
  });

  describe("Date", () => {
    it("equals returns term query", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Date", operator: "equals", value: "2024-01-01" }))).toEqual({
        term: { "customFields.valueDate": "2024-01-01" },
      });
    });

    it("gt returns range query", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Date", operator: "gt", value: "2024-01-01" }))).toEqual({
        range: { "customFields.valueDate": { gt: "2024-01-01" } },
      });
    });

    it("lt returns range query", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Date", operator: "lt", value: "2024-12-31" }))).toEqual({
        range: { "customFields.valueDate": { lt: "2024-12-31" } },
      });
    });

    it("between returns range query with gte and lte", () => {
      expect(buildCustomFieldQuery(makeCf({
        fieldType: "Date",
        operator: "between",
        value: "2024-01-01",
        value2: "2024-12-31",
      }))).toEqual({
        range: { "customFields.valueDate": { gte: "2024-01-01", lte: "2024-12-31" } },
      });
    });

    it("unknown operator returns null", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Date", operator: "contains" }))).toBeNull();
    });
  });

  describe("Number", () => {
    it("equals returns term query", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Number", operator: "equals", value: 42 }))).toEqual({
        term: { "customFields.valueNumeric": 42 },
      });
    });

    it.each(["gt", "lt", "gte", "lte"] as const)("%s returns range query", (op) => {
      const result = buildCustomFieldQuery(makeCf({ fieldType: "Number", operator: op, value: 100 }));
      expect(result).toEqual({
        range: { "customFields.valueNumeric": { [op]: 100 } },
      });
    });

    it("between returns range query with gte and lte", () => {
      expect(buildCustomFieldQuery(makeCf({
        fieldType: "Number",
        operator: "between",
        value: 10,
        value2: 100,
      }))).toEqual({
        range: { "customFields.valueNumeric": { gte: 10, lte: 100 } },
      });
    });

    it("unknown operator returns null", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Number", operator: "contains" }))).toBeNull();
    });
  });

  describe("Multi-Select", () => {
    it("in operator with array returns terms query on valueArray", () => {
      expect(buildCustomFieldQuery(makeCf({
        fieldType: "Multi-Select",
        operator: "in",
        value: ["a", "b", "c"],
      }))).toEqual({
        terms: { "customFields.valueArray": ["a", "b", "c"] },
      });
    });

    it("in operator with non-array returns null", () => {
      expect(buildCustomFieldQuery(makeCf({
        fieldType: "Multi-Select",
        operator: "in",
        value: "not-an-array",
      }))).toBeNull();
    });

    it("non-in operator returns null", () => {
      expect(buildCustomFieldQuery(makeCf({
        fieldType: "Multi-Select",
        operator: "equals",
        value: ["a"],
      }))).toBeNull();
    });
  });

  describe("Select", () => {
    it("returns term query on valueKeyword", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "Select", value: "HIGH" }))).toEqual({
        term: { "customFields.valueKeyword": "HIGH" },
      });
    });
  });

  describe("Text String / Link", () => {
    it.each(["Text String", "Link"])("%s with contains returns match query", (fieldType) => {
      expect(buildCustomFieldQuery(makeCf({ fieldType, operator: "contains", value: "hello" }))).toEqual({
        match: { "customFields.value": "hello" },
      });
    });

    it.each(["Text String", "Link"])("%s with equals returns term on valueKeyword", (fieldType) => {
      expect(buildCustomFieldQuery(makeCf({ fieldType, operator: "equals", value: "exact" }))).toEqual({
        term: { "customFields.valueKeyword": "exact" },
      });
    });
  });

  describe("Text Long / Steps", () => {
    it.each(["Text Long", "Steps"])("%s returns match query on value", (fieldType) => {
      expect(buildCustomFieldQuery(makeCf({ fieldType, value: "long text" }))).toEqual({
        match: { "customFields.value": "long text" },
      });
    });
  });

  describe("Unknown field type", () => {
    it("returns match query on value as default", () => {
      expect(buildCustomFieldQuery(makeCf({ fieldType: "UnknownType", value: "val" }))).toEqual({
        match: { "customFields.value": "val" },
      });
    });
  });
});

// ============================================================
// buildSearchAggregations
// ============================================================
describe("buildSearchAggregations", () => {
  it("includes tags nested aggregation when entity types include repository cases", () => {
    const aggs = buildSearchAggregations(["tags"], [SearchableEntityType.REPOSITORY_CASE]);
    expect(aggs.tags).toBeDefined();
    expect(aggs.tags.nested).toEqual({ path: "tags" });
    // Must NOT have ignore_unmapped (not valid for nested aggs)
    expect(aggs.tags.nested.ignore_unmapped).toBeUndefined();
  });

  it("includes tags aggregation when entity types is empty (all types)", () => {
    const aggs = buildSearchAggregations(["tags"], []);
    expect(aggs.tags).toBeDefined();
  });

  it("includes tags aggregation when entity types is undefined", () => {
    const aggs = buildSearchAggregations(["tags"]);
    expect(aggs.tags).toBeDefined();
  });

  it("excludes tags aggregation when only projects and issues are searched", () => {
    const aggs = buildSearchAggregations(
      ["tags"],
      [SearchableEntityType.PROJECT, SearchableEntityType.ISSUE]
    );
    expect(aggs.tags).toBeUndefined();
  });

  it("excludes tags aggregation for milestones + shared steps only", () => {
    const aggs = buildSearchAggregations(
      ["tags"],
      [SearchableEntityType.MILESTONE, SearchableEntityType.SHARED_STEP]
    );
    expect(aggs.tags).toBeUndefined();
  });

  it("builds terms aggregation for standard facets", () => {
    const aggs = buildSearchAggregations(["projectId", "stateId"], []);
    expect(aggs.projectId).toEqual({ terms: { field: "projectId", size: 50 } });
    expect(aggs.stateId).toEqual({ terms: { field: "stateId", size: 50 } });
  });

  it("handles mix of tags and standard facets", () => {
    const aggs = buildSearchAggregations(
      ["tags", "projectId"],
      [SearchableEntityType.REPOSITORY_CASE]
    );
    expect(aggs.tags).toBeDefined();
    expect(aggs.tags.nested).toEqual({ path: "tags" });
    expect(aggs.projectId).toEqual({ terms: { field: "projectId", size: 50 } });
  });

  it("returns empty object for empty facets array", () => {
    const aggs = buildSearchAggregations([], []);
    expect(aggs).toEqual({});
  });
});

// ============================================================
// processFacets
// ============================================================
describe("processFacets", () => {
  it("processes tags nested aggregation correctly", () => {
    const aggregations = {
      tags: {
        tag_ids: {
          buckets: [
            { key: 1, doc_count: 10 },
            { key: 2, doc_count: 5 },
          ],
        },
      },
    };

    const result = processFacets(aggregations, ["tags"]);
    expect(result.tags).toEqual({
      field: "tags",
      buckets: [
        { key: 1, count: 10 },
        { key: 2, count: 5 },
      ],
    });
  });

  it("processes standard term aggregations", () => {
    const aggregations = {
      projectId: {
        buckets: [
          { key: 1, doc_count: 100 },
          { key: 2, doc_count: 50 },
        ],
      },
    };

    const result = processFacets(aggregations, ["projectId"]);
    expect(result.projectId).toEqual({
      field: "projectId",
      buckets: [
        { key: 1, count: 100 },
        { key: 2, count: 50 },
      ],
    });
  });

  it("returns undefined when no aggregations", () => {
    expect(processFacets(null, ["tags"])).toBeUndefined();
    expect(processFacets(undefined, ["tags"])).toBeUndefined();
  });

  it("returns undefined when no requested facets", () => {
    expect(processFacets({ tags: {} }, undefined)).toBeUndefined();
  });

  it("skips facets that are not in aggregation results", () => {
    const result = processFacets({}, ["tags", "projectId"]);
    expect(result).toEqual({});
  });
});

// ============================================================
// buildSort
// ============================================================
describe("buildSort", () => {
  it("transforms single sort field", () => {
    expect(buildSort([{ field: "name", order: "asc" }])).toEqual([
      { name: { order: "asc" } },
    ]);
  });

  it("transforms multiple sort fields", () => {
    expect(buildSort([
      { field: "name", order: "asc" },
      { field: "createdAt", order: "desc" },
    ])).toEqual([
      { name: { order: "asc" } },
      { createdAt: { order: "desc" } },
    ]);
  });

  it("returns empty array for empty input", () => {
    expect(buildSort([])).toEqual([]);
  });
});

// ============================================================
// addRepositoryCaseFilters
// ============================================================
describe("addRepositoryCaseFilters", () => {
  it("adds projectIds filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { projectIds: [1, 2] });
    expect(filter).toContainEqual({ terms: { projectId: [1, 2] } });
  });

  it("adds repositoryIds filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { repositoryIds: [10] });
    expect(filter).toContainEqual({ terms: { repositoryId: [10] } });
  });

  it("adds folderIds filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { folderIds: [5, 6] });
    expect(filter).toContainEqual({ terms: { folderId: [5, 6] } });
  });

  it("adds templateIds filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { templateIds: [3] });
    expect(filter).toContainEqual({ terms: { templateId: [3] } });
  });

  it("adds stateIds filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { stateIds: [1, 2] });
    expect(filter).toContainEqual({ terms: { stateId: [1, 2] } });
  });

  it("adds creatorIds filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { creatorIds: ["user1"] });
    expect(filter).toContainEqual({ terms: { createdById: ["user1"] } });
  });

  it("adds automated boolean filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { automated: true });
    expect(filter).toContainEqual({ term: { automated: true } });
  });

  it("adds isArchived boolean filter", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { isArchived: false });
    expect(filter).toContainEqual({ term: { isArchived: false } });
  });

  it("adds nested tags filter with ignore_unmapped", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, { tagIds: [1, 2, 3] });

    const nestedFilter = filter.find((f) => f.nested?.path === "tags");
    expect(nestedFilter).toBeDefined();
    expect(nestedFilter.nested.ignore_unmapped).toBe(true);
    expect(nestedFilter.nested.query).toEqual({
      terms: { "tags.id": [1, 2, 3] },
    });
  });

  it("skips empty arrays", () => {
    const filter: any[] = [];
    addRepositoryCaseFilters(filter, {
      projectIds: [],
      repositoryIds: [],
      tagIds: [],
    });
    expect(filter).toHaveLength(0);
  });
});

// ============================================================
// addCustomFieldFilters
// ============================================================
describe("addCustomFieldFilters", () => {
  it("wraps each filter in nested with ignore_unmapped", () => {
    const filter: any[] = [];
    addCustomFieldFilters(filter, [
      { fieldId: 1, fieldName: "Priority", fieldType: "Select", operator: "equals", value: "HIGH" },
    ]);

    expect(filter).toHaveLength(1);
    expect(filter[0].nested.path).toBe("customFields");
    expect(filter[0].nested.ignore_unmapped).toBe(true);
    expect(filter[0].nested.query.bool.must[0]).toEqual({
      term: { "customFields.fieldId": 1 },
    });
  });

  it("skips filters where buildCustomFieldQuery returns null", () => {
    const filter: any[] = [];
    addCustomFieldFilters(filter, [
      { fieldId: 1, fieldName: "Count", fieldType: "Number", operator: "contains" as any, value: "x" },
    ]);
    // Number with "contains" operator returns null
    expect(filter).toHaveLength(0);
  });

  it("handles multiple custom field filters", () => {
    const filter: any[] = [];
    addCustomFieldFilters(filter, [
      { fieldId: 1, fieldName: "F1", fieldType: "Checkbox", operator: "equals", value: true },
      { fieldId: 2, fieldName: "F2", fieldType: "Select", operator: "equals", value: "LOW" },
    ]);
    expect(filter).toHaveLength(2);
  });
});

// ============================================================
// addTestRunFilters
// ============================================================
describe("addTestRunFilters", () => {
  it("adds projectIds filter", () => {
    const filter: any[] = [];
    addTestRunFilters(filter, { projectIds: [1] });
    expect(filter).toContainEqual({ terms: { projectId: [1] } });
  });

  it("adds configurationIds as configId filter", () => {
    const filter: any[] = [];
    addTestRunFilters(filter, { configurationIds: [10, 20] });
    expect(filter).toContainEqual({ terms: { configId: [10, 20] } });
  });

  it("adds milestoneIds filter", () => {
    const filter: any[] = [];
    addTestRunFilters(filter, { milestoneIds: [5] });
    expect(filter).toContainEqual({ terms: { milestoneId: [5] } });
  });

  it("adds isCompleted boolean filter", () => {
    const filter: any[] = [];
    addTestRunFilters(filter, { isCompleted: false });
    expect(filter).toContainEqual({ term: { isCompleted: false } });
  });

  it("adds testRunType filter", () => {
    const filter: any[] = [];
    addTestRunFilters(filter, { testRunType: "JUNIT" });
    expect(filter).toContainEqual({ term: { testRunType: "JUNIT" } });
  });
});

// ============================================================
// addSessionFilters
// ============================================================
describe("addSessionFilters", () => {
  it("adds assignedToIds filter", () => {
    const filter: any[] = [];
    addSessionFilters(filter, { assignedToIds: ["user1", "user2"] });
    expect(filter).toContainEqual({ terms: { assignedToId: ["user1", "user2"] } });
  });

  it("adds templateIds filter", () => {
    const filter: any[] = [];
    addSessionFilters(filter, { templateIds: [1] });
    expect(filter).toContainEqual({ terms: { templateId: [1] } });
  });

  it("adds configurationIds as configId filter", () => {
    const filter: any[] = [];
    addSessionFilters(filter, { configurationIds: [3] });
    expect(filter).toContainEqual({ terms: { configId: [3] } });
  });
});

// ============================================================
// addSharedStepFilters
// ============================================================
describe("addSharedStepFilters", () => {
  it("adds projectIds filter", () => {
    const filter: any[] = [];
    addSharedStepFilters(filter, { projectIds: [1, 2] });
    expect(filter).toContainEqual({ terms: { projectId: [1, 2] } });
  });

  it("adds creatorIds filter", () => {
    const filter: any[] = [];
    addSharedStepFilters(filter, { creatorIds: ["user1"] });
    expect(filter).toContainEqual({ terms: { createdById: ["user1"] } });
  });
});

// ============================================================
// addProjectFilters
// ============================================================
describe("addProjectFilters", () => {
  it("adds creatorIds filter", () => {
    const filter: any[] = [];
    addProjectFilters(filter, { creatorIds: ["user1"] });
    expect(filter).toContainEqual({ terms: { createdById: ["user1"] } });
  });

  it("adds isDeleted boolean filter", () => {
    const filter: any[] = [];
    addProjectFilters(filter, { isDeleted: false });
    expect(filter).toContainEqual({ term: { isDeleted: false } });
  });
});

// ============================================================
// addIssueFilters
// ============================================================
describe("addIssueFilters", () => {
  it("adds externalIds filter", () => {
    const filter: any[] = [];
    addIssueFilters(filter, { externalIds: ["JIRA-123", "GH-456"] });
    expect(filter).toContainEqual({ terms: { externalId: ["JIRA-123", "GH-456"] } });
  });
});

// ============================================================
// addMilestoneFilters
// ============================================================
describe("addMilestoneFilters", () => {
  it("adds milestoneTypeIds filter", () => {
    const filter: any[] = [];
    addMilestoneFilters(filter, { milestoneTypeIds: [1, 2] });
    expect(filter).toContainEqual({ terms: { milestoneTypeId: [1, 2] } });
  });

  it("adds parentIds filter", () => {
    const filter: any[] = [];
    addMilestoneFilters(filter, { parentIds: [10] });
    expect(filter).toContainEqual({ terms: { parentId: [10] } });
  });

  it("adds isCompleted boolean filter", () => {
    const filter: any[] = [];
    addMilestoneFilters(filter, { isCompleted: true });
    expect(filter).toContainEqual({ term: { isCompleted: true } });
  });
});

// ============================================================
// addDateRangeFilter
// ============================================================
describe("addDateRangeFilter", () => {
  it("adds range filter with both from and to", () => {
    const filter: any[] = [];
    addDateRangeFilter(filter, { field: "createdAt", from: "2024-01-01", to: "2024-12-31" });
    expect(filter).toContainEqual({
      range: { createdAt: { gte: "2024-01-01", lte: "2024-12-31" } },
    });
  });

  it("adds range filter with only from", () => {
    const filter: any[] = [];
    addDateRangeFilter(filter, { field: "createdAt", from: "2024-01-01" });
    expect(filter).toContainEqual({
      range: { createdAt: { gte: "2024-01-01" } },
    });
  });

  it("adds range filter with only to", () => {
    const filter: any[] = [];
    addDateRangeFilter(filter, { field: "updatedAt", to: "2024-12-31" });
    expect(filter).toContainEqual({
      range: { updatedAt: { lte: "2024-12-31" } },
    });
  });

  it("does not add filter when neither from nor to is set", () => {
    const filter: any[] = [];
    addDateRangeFilter(filter, { field: "createdAt" });
    expect(filter).toHaveLength(0);
  });
});

// ============================================================
// buildElasticsearchQuery
// ============================================================
describe("buildElasticsearchQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("generates query_string for text query", async () => {
    const result = await buildElasticsearchQuery(
      { query: "login bug" },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const queryString = shouldClauses.find((s: any) => s.query_string);
    expect(queryString).toBeDefined();
    expect(queryString.query_string.query).toBe("login bug");
    expect(queryString.query_string.fields).toContain("name^3");
  });

  it("includes nested steps query with ignore_unmapped when repo cases included", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test", entityTypes: [SearchableEntityType.REPOSITORY_CASE] },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const stepsNested = shouldClauses.find((s: any) => s.nested?.path === "steps");
    expect(stepsNested).toBeDefined();
    expect(stepsNested.nested.ignore_unmapped).toBe(true);
  });

  it("excludes nested steps query when only sessions searched", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test", entityTypes: [SearchableEntityType.SESSION] },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const stepsNested = shouldClauses.find((s: any) => s.nested?.path === "steps");
    expect(stepsNested).toBeUndefined();
  });

  it("includes nested items query with ignore_unmapped when shared steps included", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test", entityTypes: [SearchableEntityType.SHARED_STEP] },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const itemsNested = shouldClauses.find((s: any) => s.nested?.path === "items");
    expect(itemsNested).toBeDefined();
    expect(itemsNested.nested.ignore_unmapped).toBe(true);
  });

  it("excludes nested items query when only test runs searched", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test", entityTypes: [SearchableEntityType.TEST_RUN] },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const itemsNested = shouldClauses.find((s: any) => s.nested?.path === "items");
    expect(itemsNested).toBeUndefined();
  });

  it("includes nested customFields query with ignore_unmapped for repo cases", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test", entityTypes: [SearchableEntityType.REPOSITORY_CASE] },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const cfNested = shouldClauses.find((s: any) => s.nested?.path === "customFields");
    expect(cfNested).toBeDefined();
    expect(cfNested.nested.ignore_unmapped).toBe(true);
  });

  it("excludes nested customFields query when only projects/issues/milestones searched", async () => {
    const result = await buildElasticsearchQuery(
      {
        query: "test",
        entityTypes: [
          SearchableEntityType.PROJECT,
          SearchableEntityType.ISSUE,
          SearchableEntityType.MILESTONE,
        ],
      },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    const cfNested = shouldClauses.find((s: any) => s.nested?.path === "customFields");
    expect(cfNested).toBeUndefined();
  });

  it("includes all nested queries when entityTypes is empty (all types)", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test" },
      { access: "ADMIN" }
    );

    const shouldClauses = result.bool.must[0].bool.should;
    expect(shouldClauses.find((s: any) => s.nested?.path === "steps")).toBeDefined();
    expect(shouldClauses.find((s: any) => s.nested?.path === "items")).toBeDefined();
    expect(shouldClauses.find((s: any) => s.nested?.path === "customFields")).toBeDefined();
  });

  it("admin user does not get project access restriction", async () => {
    const result = await buildElasticsearchQuery(
      { query: "test" },
      { access: "ADMIN" }
    );

    const projectFilter = result.bool.filter.find(
      (f: any) => f.terms?.projectId
    );
    expect(projectFilter).toBeUndefined();
  });

  it("non-admin user gets project ID filter from DB", async () => {
    const { db } = await import("~/server/db");
    (db.projectAssignment.findMany as any).mockResolvedValue([
      { projectId: 10 },
      { projectId: 20 },
    ]);

    const result = await buildElasticsearchQuery(
      { query: "test" },
      { access: "USER", id: "user-123" }
    );

    const projectFilter = result.bool.filter.find(
      (f: any) => f.terms?.projectId
    );
    expect(projectFilter).toEqual({ terms: { projectId: [10, 20] } });
  });

  it("non-admin user with no project assignments gets impossible filter", async () => {
    const { db } = await import("~/server/db");
    (db.projectAssignment.findMany as any).mockResolvedValue([]);

    const result = await buildElasticsearchQuery(
      { query: "test" },
      { access: "USER", id: "user-456" }
    );

    const projectFilter = result.bool.filter.find(
      (f: any) => f.terms?.projectId
    );
    expect(projectFilter).toEqual({ terms: { projectId: [-1] } });
  });

  it("always adds isDeleted filter for non-admin", async () => {
    const result = await buildElasticsearchQuery(
      { includeDeleted: true },
      { access: "USER", id: "user-123" }
    );

    const deletedFilter = result.bool.filter.find(
      (f: any) => f.term?.isDeleted !== undefined
    );
    expect(deletedFilter).toEqual({ term: { isDeleted: false } });
  });

  it("admin can include deleted items", async () => {
    const result = await buildElasticsearchQuery(
      { includeDeleted: true },
      { access: "ADMIN" }
    );

    const deletedFilter = result.bool.filter.find(
      (f: any) => f.term?.isDeleted !== undefined
    );
    expect(deletedFilter).toBeUndefined();
  });

  it("always adds projectId exists filter", async () => {
    const result = await buildElasticsearchQuery({}, { access: "ADMIN" });
    const existsFilter = result.bool.filter.find(
      (f: any) => f.exists?.field === "projectId"
    );
    expect(existsFilter).toBeDefined();
  });

  it("generates no must clauses when no query text", async () => {
    const result = await buildElasticsearchQuery({}, { access: "ADMIN" });
    expect(result.bool.must).toHaveLength(0);
  });
});

// ============================================================
// getEntityTypeCounts
// ============================================================
describe("getEntityTypeCounts", () => {
  it("returns counts per entity type", async () => {
    const mockClient = {
      count: vi.fn()
        .mockResolvedValueOnce({ count: 100 })
        .mockResolvedValueOnce({ count: 50 }),
    };

    const result = await getEntityTypeCounts(
      mockClient,
      ["testplanit-repository-cases", "testplanit-test-runs"],
      { bool: { must: [], filter: [] } }
    );

    expect(result[SearchableEntityType.REPOSITORY_CASE]).toBe(100);
    expect(result[SearchableEntityType.TEST_RUN]).toBe(50);
  });

  it("strips nested clauses before counting", async () => {
    const mockClient = {
      count: vi.fn().mockResolvedValue({ count: 10 }),
    };

    const queryWithNested = {
      bool: {
        must: [
          {
            bool: {
              should: [
                { query_string: { query: "test" } },
                { nested: { path: "steps", query: {} } },
              ],
            },
          },
        ],
        filter: [
          { term: { isDeleted: false } },
          { nested: { path: "tags", query: {} } },
        ],
      },
    };

    await getEntityTypeCounts(
      mockClient,
      ["testplanit-sessions"],
      queryWithNested
    );

    // The query passed to count should NOT have nested clauses
    const passedQuery = mockClient.count.mock.calls[0][0].query;
    const shouldClauses = passedQuery.bool.must[0]?.bool?.should || [];
    expect(shouldClauses.every((s: any) => !s.nested)).toBe(true);
    expect(passedQuery.bool.filter.every((f: any) => !f.nested)).toBe(true);
  });

  it("handles count errors gracefully", async () => {
    const mockClient = {
      count: vi.fn()
        .mockResolvedValueOnce({ count: 100 })
        .mockRejectedValueOnce(new Error("index not found")),
    };

    const result = await getEntityTypeCounts(
      mockClient,
      ["testplanit-repository-cases", "testplanit-nonexistent"],
      { bool: { must: [], filter: [] } }
    );

    expect(result[SearchableEntityType.REPOSITORY_CASE]).toBe(100);
    // The errored index should not have a count
    expect(Object.keys(result)).toHaveLength(1);
  });
});
