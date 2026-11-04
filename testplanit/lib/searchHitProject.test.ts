import { describe, expect, it } from "vitest";
import { searchHitProjectId } from "./searchHitProject";

describe("searchHitProjectId", () => {
  it("returns the one project of a single-project hit", () => {
    expect(searchHitProjectId({ projectId: 7 })).toBe(7);
  });

  it("returns the displayed (first) project of an issue hit", () => {
    expect(searchHitProjectId({ projectId: [7, 9, 12] })).toBe(7);
  });

  it("is undefined for a hit without a project", () => {
    expect(searchHitProjectId({ projectId: null })).toBeUndefined();
    expect(searchHitProjectId({ projectId: [] })).toBeUndefined();
    expect(searchHitProjectId({})).toBeUndefined();
    expect(searchHitProjectId(undefined)).toBeUndefined();
  });
});
