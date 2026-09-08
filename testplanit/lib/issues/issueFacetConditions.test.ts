import { describe, expect, it } from "vitest";
import { issueFacetConditions } from "./issueFacetConditions";

describe("issueFacetConditions", () => {
  it("returns nothing when every facet is empty", () => {
    expect(
      issueFacetConditions({ status: [], priority: [], issueTypeName: [] })
    ).toEqual([]);
  });

  it("ORs the values within one facet, case-insensitively", () => {
    expect(issueFacetConditions({ status: ["Open", "In Progress"] })).toEqual([
      {
        OR: [
          { status: { equals: "Open", mode: "insensitive" } },
          { status: { equals: "In Progress", mode: "insensitive" } },
        ],
      },
    ]);
  });

  it("matches null and blank for the not-set bucket", () => {
    expect(issueFacetConditions({ issueTypeName: [null] })).toEqual([
      {
        OR: [{ OR: [{ issueTypeName: null }, { issueTypeName: "" }] }],
      },
    ]);
  });

  it("mixes the not-set bucket with real values in one facet", () => {
    expect(issueFacetConditions({ issueTypeName: [null, "Bug"] })).toEqual([
      {
        OR: [
          { OR: [{ issueTypeName: null }, { issueTypeName: "" }] },
          { issueTypeName: { equals: "Bug", mode: "insensitive" } },
        ],
      },
    ]);
  });

  it("emits one condition per selected facet so callers AND across facets", () => {
    const conditions = issueFacetConditions({
      status: ["Open"],
      priority: [],
      issueTypeName: ["Bug", "Story"],
    });

    expect(conditions).toEqual([
      { OR: [{ status: { equals: "Open", mode: "insensitive" } }] },
      {
        OR: [
          { issueTypeName: { equals: "Bug", mode: "insensitive" } },
          { issueTypeName: { equals: "Story", mode: "insensitive" } },
        ],
      },
    ]);
  });
});
