import { describe, expect, it } from "vitest";
import { unifiedSearchFiltersSchema } from "~/lib/schemas/savedSearch";
import {
  addIssueFilters,
  addMilestoneFilters,
  addProjectFilters,
  addRepositoryCaseFilters,
  addSessionFilters,
  addSharedStepFilters,
  addTestRunFilters,
} from "./searchQueryBuilder";

/**
 * Seam coverage: every filter field the UI can emit must reach Elasticsearch.
 *
 * The filter panel, the filter types, and the saved-search schema all happily
 * carry fields no query-builder code reads — `hasExternalId`, `hasParent`, the
 * duration ranges and the milestone due date all shipped that way, looking
 * functional while doing nothing. Those bugs are invisible to the UI tests
 * (which assert the emitted filter object) and to the builder tests (which only
 * cover clauses that exist), so this walks the seam between them.
 *
 * Field list comes from the saved-search schema rather than a hand-kept list:
 * a new filter has to be added there to persist, so it can't quietly skip this.
 * Adding a field without a SAMPLE entry fails, which is the point — it forces a
 * decision about whether the builder supports it.
 */

/** A representative value per filter field, used to probe the builder. */
const SAMPLES: Record<string, unknown> = {
  projectIds: [1],
  creatorIds: ["user-1"],
  tagIds: [2],
  stateIds: [3],
  dateRange: { field: "createdAt", from: new Date("2026-01-01") },
  repositoryIds: [4],
  folderIds: [5],
  templateIds: [6],
  automated: true,
  isArchived: true,
  isDeleted: true,
  isCompleted: true,
  source: ["JUNIT"],
  customFields: [
    {
      fieldId: 7,
      fieldName: "Priority",
      fieldType: "Dropdown",
      operator: "equals",
      value: "High",
    },
  ],
  estimateRange: { min: 60, max: 600 },
  elapsedRange: { min: 60, max: 600 },
  configurationIds: [8],
  milestoneIds: [9],
  testRunType: "REGULAR",
  assignedToIds: ["user-2"],
  milestoneTypeIds: [10],
  parentIds: [11],
  issueIds: [12],
  externalIds: ["AB-1"],
};

/**
 * Fields that intentionally produce no clause in their entity's builder, and
 * why. Anything not listed here has to filter for real.
 */
const EXEMPT: Record<string, string> = {
  "*.includeDeleted":
    "applied globally in buildElasticsearchQuery, not per entity",
  "sharedStep.tagIds": "shared step documents have no tags field",
  "sharedStep.stateIds": "shared step documents have no stateId field",
  "issue.tagIds": "issue documents have no tags field",
  "issue.stateIds": "issue documents have no stateId field",
  "milestone.tagIds": "milestone documents have no tags field",
  "milestone.stateIds": "milestone documents have no stateId field",
};

const BUILDERS: Record<string, (filter: any[], filters: any) => void> = {
  repositoryCase: addRepositoryCaseFilters,
  testRun: addTestRunFilters,
  session: addSessionFilters,
  sharedStep: addSharedStepFilters,
  project: addProjectFilters,
  issue: addIssueFilters,
  milestone: addMilestoneFilters,
};

/** Field names declared for one entity in the saved-search schema. */
function fieldsFor(entity: string): string[] {
  const entry = (unifiedSearchFiltersSchema as any).shape[entity];
  const object = typeof entry?.unwrap === "function" ? entry.unwrap() : entry;
  return Object.keys(object.shape);
}

describe("search filter coverage", () => {
  it("probes every entity the saved-search schema knows about", () => {
    const schemaEntities = Object.keys(
      (unifiedSearchFiltersSchema as any).shape
    ).filter(
      (key) => !["entityTypes", "query", "includeDeleted"].includes(key)
    );

    expect(schemaEntities.sort()).toEqual(Object.keys(BUILDERS).sort());
  });

  describe.each(Object.keys(BUILDERS))("%s filters", (entity) => {
    const addFilters = BUILDERS[entity];

    it("has a sample value for every field in the schema", () => {
      const missing = fieldsFor(entity).filter(
        (field) => !(field in SAMPLES) && field !== "includeDeleted"
      );

      expect(
        missing,
        `No probe value for ${entity}.${missing.join(", ")} — add one to SAMPLES so its clause is verified`
      ).toEqual([]);
    });

    it("turns every field into an Elasticsearch clause", () => {
      const dead: string[] = [];

      for (const field of fieldsFor(entity)) {
        if (EXEMPT[`*.${field}`] || EXEMPT[`${entity}.${field}`]) continue;
        if (!(field in SAMPLES)) continue; // reported by the test above

        const filter: any[] = [];
        addFilters(filter, { [field]: SAMPLES[field] });
        if (filter.length === 0) dead.push(field);
      }

      expect(
        dead,
        `${entity}: ${dead.join(", ")} reach the query builder but produce no clause — either implement them or drop the field`
      ).toEqual([]);
    });
  });

  it("keeps the exemption list honest", () => {
    for (const key of Object.keys(EXEMPT)) {
      const [entity, field] = key.split(".");
      if (entity === "*") continue;

      expect(
        fieldsFor(entity),
        `${key} is exempted but no longer exists in the schema`
      ).toContain(field);
    }
  });
});
