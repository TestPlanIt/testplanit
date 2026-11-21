import { describe, expect, it } from "vitest";
import {
  buildDefaultQaseMapping,
  normalizeQaseMapping,
  validateQaseMapping,
  type QaseAnalysis,
} from "./mapping";

const analysis: QaseAnalysis = {
  source: {
    projects: [
      {
        code: "WEB",
        title: "Web Shop",
        cases: 1,
        suites: 1,
        milestones: 0,
        runs: 0,
        defects: 0,
      },
    ],
    users: [{ id: "1", name: "Ada", email: "ADA@example.test" }],
    caseStatuses: [
      { id: "0", title: "Actual" },
      { id: "1", title: "Draft" },
    ],
    fields: [
      {
        key: "system:priority",
        title: "Priority",
        targetType: "Dropdown",
        options: [{ id: "1", title: "High" }],
      },
      {
        key: "system:description",
        title: "Description",
        targetType: "Text Long",
        options: [],
      },
      {
        key: "custom:7",
        title: "Browser",
        targetType: "Dropdown",
        options: [],
      },
    ],
  },
  existing: {
    projects: [{ id: 5, name: "web shop" }],
    users: [{ id: "u1", name: "Ada L", email: "ada@example.test" }],
    workflows: [
      {
        id: 11,
        name: "Draft",
        isDefault: true,
        icon: { name: "circle" },
        color: { value: "#000" },
      },
      {
        id: 12,
        name: "Done",
        isDefault: false,
        icon: { name: "circle" },
        color: { value: "#000" },
      },
    ],
    templates: [{ id: 3, name: "Default" }],
    caseFields: [
      {
        id: 21,
        displayName: "Priority",
        systemName: "priority",
        type: "Dropdown",
        options: [],
      },
      {
        id: 22,
        displayName: "Description",
        systemName: "description",
        type: "Text String",
        options: [],
      },
    ],
  },
  storageConfigured: true,
};

describe("buildDefaultQaseMapping", () => {
  const config = buildDefaultQaseMapping(analysis);

  it("matches projects by name and users by email, ignoring case", () => {
    expect(config.projects.WEB.mappedTo).toBe(5);
    expect(config.users["1"].mappedTo).toBe("u1");
  });

  it("maps a status to the state of the same name, else the default state", () => {
    expect(config.caseStatuses["1"].mappedTo).toBe(11);
    expect(config.caseStatuses["0"].mappedTo).toBe(11);
  });

  it("reuses a same-named field only when its type matches", () => {
    expect(config.fields["system:priority"]).toEqual({
      action: "map",
      mappedTo: 21,
      name: "",
    });
    expect(config.fields["system:description"]).toEqual({
      action: "create",
      mappedTo: null,
      name: "Description (Qase)",
    });
    expect(config.fields["custom:7"]).toEqual({
      action: "create",
      mappedTo: null,
      name: "Browser",
    });
  });

  it("proposes a new template and is valid as built", () => {
    expect(config.template).toEqual({
      action: "create",
      mappedTo: null,
      name: "Qase",
    });
    expect(validateQaseMapping(config, analysis)).toEqual([]);
  });
});

describe("validateQaseMapping", () => {
  const valid = () => buildDefaultQaseMapping(analysis);

  it("reports an unmapped project and status", () => {
    const config = valid();
    config.projects.WEB.mappedTo = null;
    config.caseStatuses["0"].mappedTo = 999;
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "project_unmapped", subject: "Web Shop" },
      { code: "status_unmapped", subject: "Actual" },
    ]);
  });

  it("reports a template name that exists and a missing template", () => {
    const config = valid();
    config.template = { action: "create", mappedTo: null, name: "default" };
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "template_name_taken", subject: "default" },
    ]);
    config.template = { action: "map", mappedTo: null, name: "" };
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "template_missing" },
    ]);
  });

  it("reports field problems and ignores skipped fields", () => {
    const config = valid();
    config.fields["system:description"] = {
      action: "map",
      mappedTo: 22,
      name: "",
    };
    config.fields["custom:7"] = { action: "map", mappedTo: 21, name: "" };
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "field_type_mismatch", subject: "Description" },
      { code: "field_target_reused", subject: "Browser" },
    ]);
    config.fields["system:description"] = {
      action: "create",
      mappedTo: null,
      name: "priority",
    };
    config.fields["custom:7"] = { action: "skip", mappedTo: null, name: "" };
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "field_name_taken", subject: "priority" },
    ]);
    config.fields["system:description"].name = "";
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "field_name_missing", subject: "Description" },
    ]);
  });
});

describe("normalizeQaseMapping", () => {
  it("keeps valid entries and drops everything else", () => {
    expect(
      normalizeQaseMapping({
        projects: { WEB: { mappedTo: 5 }, BAD: { mappedTo: "5" } },
        users: { "1": { mappedTo: "u1" }, "2": { mappedTo: 7 } },
        caseStatuses: { "0": { mappedTo: 11.5 } },
        template: { action: "delete", name: "  Mine  " },
        fields: { "custom:7": { action: "skip", mappedTo: -1, name: 4 } },
        extra: true,
      })
    ).toEqual({
      projects: { WEB: { mappedTo: 5 }, BAD: { mappedTo: null } },
      users: { "1": { mappedTo: "u1" }, "2": { mappedTo: null } },
      caseStatuses: { "0": { mappedTo: null } },
      template: { action: "create", mappedTo: null, name: "Mine" },
      fields: { "custom:7": { action: "skip", mappedTo: null, name: "" } },
    });
    expect(normalizeQaseMapping(null).template.action).toBe("create");
  });
});
