import { describe, expect, it } from "vitest";

import {
  formatFieldValue,
  resolveCaseScalarChanges,
  type OptionFieldMeta,
} from "./caseChangeResolve";

/**
 * Resolver contract: foreign-key ids -> display names, option ids -> labels,
 * bookkeeping columns hidden, scalar values formatted (bool, duration).
 */

// Fake transaction client — only the readers the resolvers touch.
const tx = {
  workflows: {
    findUnique: async ({ where: { id } }: any) => ({
      name: id === 14 ? "Active" : "Draft",
      color: { value: "#FFAA00" },
    }),
  },
  repositoryFolders: {
    findUnique: async () => ({ name: "Regression" }),
  },
  templates: {
    findUnique: async () => ({ templateName: "Default template" }),
  },
  user: {
    findUnique: async () => ({ name: "Dana Lee" }),
  },
  projects: {
    findUnique: async () => ({ name: "Demo Project" }),
  },
};

describe("resolveCaseScalarChanges", () => {
  it("resolves stateId to the workflow name + color", async () => {
    const changes = await resolveCaseScalarChanges(tx, {
      changedFields: ["stateId"],
      before: { stateId: 14 },
      after: { stateId: 11 },
    });
    expect(changes).toEqual([
      { label: "State", from: "Active", to: "Draft", color: "#FFAA00" },
    ]);
  });

  it("hides bookkeeping columns (currentVersion) but keeps real changes", async () => {
    const changes = await resolveCaseScalarChanges(tx, {
      changedFields: ["stateId", "currentVersion"],
      before: { stateId: 14, currentVersion: 2 },
      after: { stateId: 11, currentVersion: 3 },
    });
    expect(changes.map((c) => c.label)).toEqual(["State"]);
  });

  it("returns an empty set when only bookkeeping columns changed", async () => {
    const changes = await resolveCaseScalarChanges(tx, {
      changedFields: ["currentVersion", "order"],
      before: { currentVersion: 1, order: 5 },
      after: { currentVersion: 2, order: 6 },
    });
    expect(changes).toEqual([]);
  });

  it("formats durations and booleans", async () => {
    const changes = await resolveCaseScalarChanges(tx, {
      changedFields: ["estimate", "automated"],
      before: { estimate: 300, automated: false },
      after: { estimate: 600, automated: true },
    });
    expect(changes).toEqual([
      { label: "Estimate", from: "5 minutes", to: "10 minutes" },
      { label: "Automated", from: "No", to: "Yes" },
    ]);
  });

  it("resolves folder / template / creator foreign keys to names", async () => {
    const changes = await resolveCaseScalarChanges(tx, {
      changedFields: ["folderId", "templateId", "creatorId"],
      before: { folderId: 1, templateId: 1, creatorId: "u1" },
      after: { folderId: 2, templateId: 2, creatorId: "u2" },
    });
    expect(changes.map((c) => `${c.label}:${c.to}`)).toEqual([
      "Folder:Regression",
      "Template:Default template",
      "Created by:Dana Lee",
    ]);
  });

  it("falls back to #id when a foreign key can't be resolved", async () => {
    const emptyTx = { workflows: { findUnique: async () => null } };
    const changes = await resolveCaseScalarChanges(emptyTx, {
      changedFields: ["stateId"],
      before: { stateId: 14 },
      after: { stateId: 11 },
    });
    expect(changes[0]).toMatchObject({ from: "#14", to: "#11" });
  });
});

describe("formatFieldValue", () => {
  const dropdown: OptionFieldMeta = {
    displayName: "Type",
    type: { type: "Dropdown" },
    fieldOptions: [
      { fieldOption: { id: 157, name: "Functional" } },
      { fieldOption: { id: 161, name: "Security" } },
    ],
  };
  const multiSelect: OptionFieldMeta = {
    displayName: "access_required",
    type: { type: "Multi-Select" },
    fieldOptions: [
      { fieldOption: { id: 169, name: "Admin Tool" } },
      { fieldOption: { id: 170, name: "DB" } },
      { fieldOption: { id: 175, name: "DataDog" } },
    ],
  };

  it("resolves a dropdown option id to its label", () => {
    expect(formatFieldValue(157, dropdown)).toBe("Functional");
    expect(formatFieldValue(161, dropdown)).toBe("Security");
  });

  it("resolves a multi-select array of ids to a joined label list", () => {
    expect(formatFieldValue([170, 169, 175], multiSelect)).toBe(
      "DB, Admin Tool, DataDog"
    );
  });

  it("falls back to the raw id when an option was removed", () => {
    expect(formatFieldValue(999, dropdown)).toBe("999");
  });

  it("passes non-option field values through unchanged", () => {
    const text: OptionFieldMeta = {
      displayName: "Notes",
      type: { type: "Text String" },
      fieldOptions: [],
    };
    expect(formatFieldValue("hello world", text)).toBe("hello world");
  });

  it("renders null / empty as an em dash", () => {
    expect(formatFieldValue(null, dropdown)).toBe("—");
    expect(formatFieldValue([], multiSelect)).toBe("—");
  });
});
