import { describe, expect, it } from "vitest";
import {
  diffCaseVersionContent,
  flattenVersionContent,
} from "./caseVersionDiff";

describe("caseVersionDiff", () => {
  it("flattens custom fields by display name and relations by reserved key", () => {
    const flat = flattenVersionContent({
      steps: [{ step: "a" }],
      tags: ["smoke"],
      issues: [],
      parameters: null,
      caseFieldVersionValues: [
        { field: "Priority", value: "High" },
        { field: "Component", value: "API" },
      ],
    });
    expect(flat).toMatchObject({
      Priority: "High",
      Component: "API",
      Steps: [{ step: "a" }],
      Tags: ["smoke"],
      Issues: [],
      Parameters: null,
    });
  });

  it("reports a changed custom field value", () => {
    const changes = diffCaseVersionContent(
      { caseFieldVersionValues: [{ field: "Priority", value: "Low" }] },
      { caseFieldVersionValues: [{ field: "Priority", value: "High" }] }
    );
    expect(changes?.Priority).toEqual({ old: "Low", new: "High" });
  });

  it("reports added and removed custom fields", () => {
    const changes = diffCaseVersionContent(
      { caseFieldVersionValues: [{ field: "Old", value: "x" }] },
      { caseFieldVersionValues: [{ field: "New", value: "y" }] }
    );
    expect(changes?.Old?.old).toBe("x");
    expect(changes?.New?.new).toBe("y");
  });

  it("reports changed steps, tags, issues, and parameters", () => {
    const changes = diffCaseVersionContent(
      {
        steps: [{ step: "a" }],
        tags: ["x"],
        issues: [{ id: 1 }],
        parameters: { p: 1 },
      },
      {
        steps: [{ step: "b" }],
        tags: ["y"],
        issues: [],
        parameters: { p: 2 },
      }
    );
    expect(changes?.Steps).toEqual({
      old: [{ step: "a" }],
      new: [{ step: "b" }],
    });
    expect(changes?.Tags).toEqual({ old: ["x"], new: ["y"] });
    expect(changes?.Issues).toEqual({ old: [{ id: 1 }], new: [] });
    expect(changes?.Parameters).toEqual({ old: { p: 1 }, new: { p: 2 } });
  });

  it("returns undefined when content is unchanged (e.g. a rename-only edit)", () => {
    const content = {
      steps: [{ step: "a" }],
      tags: ["x"],
      issues: [],
      parameters: null,
      caseFieldVersionValues: [{ field: "Priority", value: "High" }],
    };
    expect(diffCaseVersionContent(content, content)).toBeUndefined();
  });
});
