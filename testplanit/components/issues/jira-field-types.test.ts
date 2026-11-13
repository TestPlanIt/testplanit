import { describe, expect, it } from "vitest";
import {
  buildJiraFieldsSchema,
  isJiraSprintField,
  isJiraTeamField,
  jiraDefaultFormValue,
  jiraIdRef,
} from "./jira-field-types";

const sprintField = {
  key: "customfield_10101",
  name: "Sprint",
  required: false,
  schema: {
    type: "array",
    items: "string",
    custom: "com.pyxis.greenhopper.jira:gh-sprint",
  },
};

const epicLinkField = {
  key: "customfield_10001",
  name: "Epic Link",
  required: false,
  schema: { type: "any", custom: "com.pyxis.greenhopper.jira:gh-epic-link" },
};

describe("isJiraSprintField", () => {
  it("matches Jira Software's sprint field type", () => {
    expect(isJiraSprintField(sprintField)).toBe(true);
  });

  it("does not match by name alone", () => {
    expect(
      isJiraSprintField({
        key: "customfield_1",
        name: "Sprint",
        required: false,
        schema: { type: "string" },
      })
    ).toBe(false);
  });
});

describe("isJiraTeamField", () => {
  it("matches the Atlassian team field type under any name", () => {
    expect(
      isJiraTeamField({
        key: "customfield_10001",
        name: "Équipe",
        required: false,
        schema: {
          type: "team",
          custom:
            "com.atlassian.jira.plugin.system.customfieldtypes:atlassian-team",
        },
      })
    ).toBe(true);
  });

  it("does not treat a Server field that happens to be customfield_10001 as a team", () => {
    expect(isJiraTeamField(epicLinkField)).toBe(false);
  });
});

describe("jiraDefaultFormValue", () => {
  const field = (schema: { type: string; items?: string }, name = "F") => ({
    key: "customfield_1",
    name,
    required: false,
    schema,
  });

  it("reduces a dropdown's default object to its option id", () => {
    expect(
      jiraDefaultFormValue(field({ type: "option" }), {
        self: "https://j/1",
        value: "Major",
        id: "10020",
      })
    ).toBe("10020");
    expect(
      jiraDefaultFormValue(field({ type: "priority" }), { name: "High", id: 2 })
    ).toBe("2");
  });

  it("reduces a multi-option default to option ids", () => {
    expect(
      jiraDefaultFormValue(field({ type: "array", items: "option" }), [
        { id: "1", value: "Now" },
        { id: "2", value: "Later" },
      ])
    ).toEqual(["1", "2"]);
  });

  it("leaves the Flagged checkbox's object value and plain defaults alone", () => {
    const flagged = [{ id: "10000", value: "Impediment" }];
    expect(
      jiraDefaultFormValue(
        field({ type: "array", items: "option" }, "Flagged"),
        flagged
      )
    ).toBe(flagged);
    expect(jiraDefaultFormValue(field({ type: "string" }), "text")).toBe(
      "text"
    );
  });
});

describe("jiraIdRef", () => {
  it("wraps a picked id or an option object as { id }", () => {
    expect(jiraIdRef("10020")).toEqual({ id: "10020" });
    expect(jiraIdRef({ id: "10000", value: "Impediment" })).toEqual({
      id: "10000",
    });
  });
});

describe("buildJiraFieldsSchema", () => {
  it("accepts a single sprint id for the sprint field", () => {
    const schema = buildJiraFieldsSchema([sprintField]);

    expect(schema.safeParse({ customfield_10101: "42" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });

  it("requires a sprint when Jira marks the field required", () => {
    const schema = buildJiraFieldsSchema([{ ...sprintField, required: true }]);

    expect(schema.safeParse({ customfield_10101: "" }).success).toBe(false);
    expect(schema.safeParse({ customfield_10101: "42" }).success).toBe(true);
  });

  it("still validates other array fields as arrays", () => {
    const schema = buildJiraFieldsSchema([
      {
        key: "labels",
        name: "Labels",
        required: false,
        schema: { type: "array", items: "string" },
      },
    ]);

    expect(schema.safeParse({ labels: ["a"] }).success).toBe(true);
    expect(schema.safeParse({ labels: "a" }).success).toBe(false);
  });
});
