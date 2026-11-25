import { describe, expect, it } from "vitest";
import { buildFilterDimensions } from "./filterDimensions";
import { parseFilterParams } from "./filterUrlCodec";

// The updated-cases notification links to the repository with these filters
// (components/NotificationContent.tsx). If the URL syntax changes, the link
// would open an unfiltered repository without any error.
describe("the filters the updated-cases notification links with", () => {
  const registry = buildFilterDimensions();

  it("parse as the issue's cases that have a suggestion waiting", () => {
    expect(
      parseFilterParams(["issues:any:100", "suggestions:is:1"], registry)
    ).toEqual([
      { dimension: "issues", operator: "any", values: [100] },
      { dimension: "suggestions", operator: "is", values: [1] },
    ]);
  });
});
