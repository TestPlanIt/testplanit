import { describe, expect, it } from "vitest";
import {
  buildDefaultQaseMapping,
  normalizeQaseMapping,
  validateQaseMapping,
  unmappedQaseUser,
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
    users: [
      { id: "1", name: "Ada", email: "ADA@example.test" },
      { id: "2", name: "Grace", email: "Grace@example.test" },
      { id: "3", name: "No Address", email: "" },
    ],
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
    roles: [
      { id: 1, name: "Tester", isDefault: true },
      { id: 2, name: "Manager", isDefault: false },
    ],
  },
  storageConfigured: true,
};

describe("buildDefaultQaseMapping", () => {
  const config = buildDefaultQaseMapping(analysis);

  it("matches projects by name and users by email, ignoring case", () => {
    expect(config.projects.WEB).toEqual({
      action: "map",
      mappedTo: 5,
      name: "",
    });
    expect(config.users["1"]).toEqual({
      ...unmappedQaseUser(),
      mappedTo: "u1",
    });
  });

  it("proposes a new project when none has the Qase project's name", () => {
    const unmatched = buildDefaultQaseMapping({
      ...analysis,
      existing: { ...analysis.existing, projects: [] },
    });
    expect(unmatched.projects.WEB).toEqual({
      action: "create",
      mappedTo: null,
      name: "Web Shop",
    });
  });

  it("proposes a new user for an unknown email address", () => {
    expect(config.users["2"]).toEqual({
      action: "create",
      mappedTo: null,
      name: "Grace",
      email: "grace@example.test",
      access: "USER",
      roleId: null,
      isActive: true,
      isApi: false,
    });
    // Nothing to create an account from: the importer stands in.
    expect(config.users["3"]).toEqual(unmappedQaseUser());
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
    config.projects.WEB = { action: "map", mappedTo: null, name: "" };
    config.caseStatuses["0"].mappedTo = 999;
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "project_unmapped", subject: "Web Shop" },
      { code: "status_unmapped", subject: "Actual" },
    ]);
  });

  it("reports a new project without a name or with a name in use", () => {
    const config = valid();
    config.projects.WEB = { action: "create", mappedTo: null, name: "" };
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "project_name_missing", subject: "Web Shop" },
    ]);
    config.projects.WEB.name = "WEB SHOP";
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "project_name_taken", subject: "WEB SHOP" },
    ]);
    config.projects.WEB.name = "Web Shop from Qase";
    expect(validateQaseMapping(config, analysis)).toEqual([]);
  });

  it("reports two Qase projects that would create the same project", () => {
    const two: QaseAnalysis = {
      ...analysis,
      source: {
        ...analysis.source,
        projects: [
          ...analysis.source.projects,
          { ...analysis.source.projects[0], code: "API", title: "API" },
        ],
      },
    };
    const config = buildDefaultQaseMapping(two);
    config.projects.WEB = { action: "create", mappedTo: null, name: "Shop" };
    config.projects.API = { action: "create", mappedTo: null, name: "shop" };
    expect(validateQaseMapping(config, two)).toEqual([
      { code: "project_name_taken", subject: "shop" },
    ]);
  });

  it("reports what stops a new user from being created", () => {
    const config = valid();
    config.users["2"].email = "";
    config.users["3"] = {
      ...unmappedQaseUser(),
      action: "create",
      email: "not-an-address",
    };
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "user_email_missing", subject: "Grace" },
      { code: "user_email_invalid", subject: "No Address" },
    ]);

    config.users["2"].email = "new@example.test";
    config.users["3"].email = "new@example.test";
    config.users["3"].roleId = 99;
    expect(validateQaseMapping(config, analysis)).toEqual([
      { code: "user_email_reused", subject: "No Address" },
      { code: "user_role_missing", subject: "No Address" },
    ]);
  });

  it("needs a default role when a new user has none chosen", () => {
    const config = valid();
    const noDefault: QaseAnalysis = {
      ...analysis,
      existing: {
        ...analysis.existing,
        roles: [{ id: 2, name: "Manager", isDefault: false }],
      },
    };
    expect(validateQaseMapping(config, noDefault)).toEqual([
      { code: "user_role_missing", subject: "Grace" },
    ]);
    config.users["2"].roleId = 2;
    expect(validateQaseMapping(config, noDefault)).toEqual([]);
  });

  it("does not check an existing-user mapping", () => {
    const config = valid();
    config.users["2"] = unmappedQaseUser();
    expect(validateQaseMapping(config, analysis)).toEqual([]);
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
        projects: {
          WEB: { mappedTo: 5 },
          BAD: { mappedTo: "5" },
          NEW: { action: "create", name: "  Shop  ", extra: 1 },
        },
        users: {
          "1": { mappedTo: "u1" },
          "2": { mappedTo: 7 },
          "3": {
            action: "create",
            name: " Grace ",
            email: " Grace@Example.test ",
            access: "ROOT",
            roleId: "2",
            isActive: false,
            isApi: "yes",
          },
          "4": { action: "create", access: "ADMIN", roleId: 2, isApi: true },
        },
        caseStatuses: { "0": { mappedTo: 11.5 } },
        template: { action: "delete", name: "  Mine  " },
        fields: { "custom:7": { action: "skip", mappedTo: -1, name: 4 } },
        extra: true,
      })
    ).toEqual({
      projects: {
        WEB: { action: "map", mappedTo: 5, name: "" },
        BAD: { action: "map", mappedTo: null, name: "" },
        NEW: { action: "create", mappedTo: null, name: "Shop" },
      },
      users: {
        "1": { ...unmappedQaseUser(), mappedTo: "u1" },
        "2": unmappedQaseUser(),
        "3": {
          action: "create",
          mappedTo: null,
          name: "Grace",
          email: "grace@example.test",
          access: "USER",
          roleId: null,
          isActive: false,
          isApi: false,
        },
        "4": {
          action: "create",
          mappedTo: null,
          name: "",
          email: "",
          access: "ADMIN",
          roleId: 2,
          isActive: true,
          isApi: true,
        },
      },
      caseStatuses: { "0": { mappedTo: null } },
      template: { action: "create", mappedTo: null, name: "Mine" },
      fields: { "custom:7": { action: "skip", mappedTo: null, name: "" } },
    });
    expect(normalizeQaseMapping(null).template.action).toBe("create");
  });
});
