import { describe, expect, it } from "vitest";
import { trashItemTypeByName } from "@/api/admin/trash/itemTypes";
import { softDeletedItemTypes } from "@/[locale]/admin/trash/itemTypes";
import { ApplicationArea } from "~/zenstack/models";
import { schema } from "~/zenstack/schema";
import {
  userTrashItemTypes,
  type UserTrashChild,
  type UserTrashProjectSource,
  originalName,
} from "./itemTypes";

type ModelDef = {
  name: string;
  fields: Record<string, { type: string }>;
};

const models = schema.models as unknown as Record<string, ModelDef>;
const modelByDelegate = Object.fromEntries(
  Object.values(models).map((model) => [
    model.name.charAt(0).toLowerCase() + model.name.slice(1),
    model,
  ])
);

function walkChildren(
  children: UserTrashChild[],
  visit: (c: UserTrashChild) => void
) {
  for (const child of children) {
    visit(child);
    if (child.children) walkChildren(child.children, visit);
  }
}

describe("user Trash item types", () => {
  it("are a subset of the Admin > Trash registry with a display entry each", () => {
    for (const entry of userTrashItemTypes) {
      const admin = trashItemTypeByName[entry.itemType];
      expect(admin, entry.itemType).toBeDefined();
      expect(admin.modelName).toBe(entry.modelName);
      expect(admin.delegate).toBe(entry.delegate);
      expect(
        softDeletedItemTypes.some((d) => d.name === entry.itemType),
        `${entry.itemType} has no icon/label entry`
      ).toBe(true);
    }
    expect(new Set(userTrashItemTypes.map((e) => e.itemType)).size).toBe(
      userTrashItemTypes.length
    );
  });

  it("only exposes types with a human-readable name and a reachable project", () => {
    for (const entry of userTrashItemTypes) {
      const model = models[entry.modelName];
      expect(model.fields[entry.nameField]?.type, entry.itemType).toBe(
        "String"
      );
      const source: UserTrashProjectSource = entry.project;
      if (source.kind === "own") {
        expect(model.fields.projectId?.type, entry.itemType).toBe("Int");
      } else {
        for (const parent of source.parents) {
          expect(
            model.fields[parent.fk],
            `${entry.itemType}.${parent.fk}`
          ).toBeDefined();
          const parentModel = modelByDelegate[parent.delegate];
          expect(parentModel, parent.delegate).toBeDefined();
          const projectRow = parent.projectVia
            ? modelByDelegate[parent.projectVia.delegate]
            : parentModel;
          expect(projectRow.fields.projectId?.type, parent.delegate).toBe(
            "Int"
          );
          expect(
            projectRow.fields[parent.nameField]?.type,
            parent.delegate
          ).toBe("String");
          expect(Object.values(ApplicationArea)).toContain(parent.area);
        }
      }
      expect(Object.values(ApplicationArea)).toContain(entry.area);
      if (entry.parent) {
        expect(
          model.fields[entry.parent.fk],
          `${entry.itemType}.${entry.parent.fk}`
        ).toBeDefined();
        expect(modelByDelegate[entry.parent.delegate]).toBeDefined();
      }
    }
  });

  it("restores only soft-deletable owned children through real foreign keys", () => {
    for (const entry of userTrashItemTypes) {
      walkChildren(entry.children, (child) => {
        const model = modelByDelegate[child.delegate];
        expect(model, `${entry.itemType} → ${child.delegate}`).toBeDefined();
        expect(
          model.fields.isDeleted,
          `${child.delegate} is not soft-deletable`
        ).toBeDefined();
        expect(
          model.fields[child.fk],
          `${child.delegate}.${child.fk}`
        ).toBeDefined();
        if (child.self) expect(child.delegate).toBe(entry.delegate);
      });
    }
  });

  it("keeps admin-scoped and nameless types out", () => {
    const names = userTrashItemTypes.map((e) => e.itemType);
    for (const excluded of [
      "User",
      "Roles",
      "Templates",
      "Comment",
      "Tags",
      "Projects",
    ]) {
      expect(names).not.toContain(excluded);
    }
  });

  it("strips the _deleted_<timestamp> suffix folders get on delete", () => {
    expect(originalName("Smoke_deleted_1793307981637")).toBe("Smoke");
    expect(originalName("Smoke_deleted_12_deleted_34")).toBe(
      "Smoke_deleted_12"
    );
    expect(originalName("Smoke")).toBe("Smoke");
    expect(originalName("Smoke_deleted_")).toBe("Smoke_deleted_");
  });
});
