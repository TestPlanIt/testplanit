import { DbNull, JsonNull } from "@zenstackhq/orm";
import { describe, expect, it } from "vitest";

import { isNullableJsonField, normalizeJsonNullArgs } from "./jsonNullPlugin";

// Steps.step / Steps.expectedResult are `Json?`; SharedStepItem.step is
// required `Json`; RepositoryCases.steps is a to-many relation to Steps and
// Steps.testCase a to-one relation back.
describe("normalizeJsonNullArgs", () => {
  it("rewrites null on a top-level nullable Json field to DbNull", () => {
    const args = {
      data: { testCaseId: 1, order: 0, step: null, expectedResult: null },
    };
    const out = normalizeJsonNullArgs("Steps", "create", args);
    expect(out.data.step).toBe(DbNull);
    expect(out.data.expectedResult).toBe(DbNull);
    expect(out.data.testCaseId).toBe(1);
  });

  it("does not mutate the caller's args", () => {
    const args = { data: { expectedResult: null } };
    const out = normalizeJsonNullArgs("Steps", "update", args);
    expect(args.data.expectedResult).toBeNull();
    expect(out).not.toBe(args);
    expect(out.data).not.toBe(args.data);
  });

  it("returns the same reference when there is nothing to rewrite", () => {
    const args = {
      where: { id: 1 },
      data: { expectedResult: { type: "doc" }, step: DbNull, order: 2 },
    };
    expect(normalizeJsonNullArgs("Steps", "update", args)).toBe(args);
  });

  it("leaves the sentinels, undefined and where clauses alone", () => {
    const args = {
      where: { expectedResult: null },
      data: { step: JsonNull, expectedResult: undefined },
    };
    const out = normalizeJsonNullArgs("Steps", "update", args);
    expect(out.data.step).toBe(JsonNull);
    expect(out.data.expectedResult).toBeUndefined();
    expect(out.where).toBe(args.where);
  });

  it("leaves a required Json field's null untouched", () => {
    const args = { data: { sharedStepGroupId: 1, order: 0, step: null } };
    expect(normalizeJsonNullArgs("SharedStepItem", "create", args)).toBe(args);
  });

  it("ignores reads and deletes", () => {
    const args = { where: { id: 1 }, data: { expectedResult: null } };
    expect(normalizeJsonNullArgs("Steps", "findMany", args)).toBe(args);
    expect(normalizeJsonNullArgs("Steps", "delete", args)).toBe(args);
    expect(normalizeJsonNullArgs("Steps", "create", undefined)).toBeUndefined();
  });

  it("handles createMany's data array", () => {
    const args = {
      data: [
        { testCaseId: 1, order: 0, expectedResult: null },
        { testCaseId: 1, order: 1, expectedResult: { type: "doc" } },
      ],
    };
    const out = normalizeJsonNullArgs("Steps", "createMany", args);
    expect(out.data[0].expectedResult).toBe(DbNull);
    expect(out.data[1]).toBe(args.data[1]);
  });

  it("walks both branches of an upsert", () => {
    const args = {
      where: { id: 1 },
      create: { testCaseId: 1, order: 0, step: null },
      update: { expectedResult: null },
    };
    const out = normalizeJsonNullArgs("Steps", "upsert", args);
    expect(out.create.step).toBe(DbNull);
    expect(out.update.expectedResult).toBe(DbNull);
  });

  it("recurses into a nested create through a relation", () => {
    const args = {
      where: { id: 1 },
      data: {
        steps: {
          create: [
            { order: 0, step: null, expectedResult: null },
            { order: 1, step: { type: "doc" }, expectedResult: null },
          ],
        },
      },
    };
    const out = normalizeJsonNullArgs("RepositoryCases", "update", args);
    const created = out.data.steps.create;
    expect(created[0].step).toBe(DbNull);
    expect(created[0].expectedResult).toBe(DbNull);
    expect(created[1].step).toEqual({ type: "doc" });
    expect(created[1].expectedResult).toBe(DbNull);
    expect(args.data.steps.create[0].step).toBeNull();
  });

  it("recurses into a single nested create object", () => {
    const args = {
      data: {
        name: "x",
        steps: { create: { order: 0, expectedResult: null } },
      },
    };
    const out = normalizeJsonNullArgs("RepositoryCases", "create", args);
    expect(out.data.steps.create.expectedResult).toBe(DbNull);
  });

  it("recurses into createMany.data, connectOrCreate, update, updateMany and upsert", () => {
    const args = {
      where: { id: 1 },
      data: {
        steps: {
          createMany: { data: [{ order: 0, expectedResult: null }] },
          connectOrCreate: [
            { where: { id: 2 }, create: { order: 1, step: null } },
          ],
          update: [{ where: { id: 3 }, data: { expectedResult: null } }],
          updateMany: { where: { order: 9 }, data: { step: null } },
          upsert: {
            where: { id: 4 },
            create: { order: 2, step: null },
            update: { expectedResult: null },
          },
        },
      },
    };
    const out = normalizeJsonNullArgs("RepositoryCases", "update", args);
    const steps = out.data.steps;
    expect(steps.createMany.data[0].expectedResult).toBe(DbNull);
    expect(steps.connectOrCreate[0].create.step).toBe(DbNull);
    expect(steps.connectOrCreate[0].where).toBe(
      args.data.steps.connectOrCreate[0].where
    );
    expect(steps.update[0].data.expectedResult).toBe(DbNull);
    expect(steps.updateMany.data.step).toBe(DbNull);
    expect(steps.upsert.create.step).toBe(DbNull);
    expect(steps.upsert.update.expectedResult).toBe(DbNull);
  });

  it("handles a to-one relation's bare update payload", () => {
    const args = {
      where: { id: 1 },
      data: {
        testCase: {
          update: { estimate: 3, steps: { create: { order: 0, step: null } } },
        },
      },
    };
    const out = normalizeJsonNullArgs("Steps", "update", args);
    expect(out.data.testCase.update.steps.create.step).toBe(DbNull);
  });

  it("leaves unknown keys and unknown models alone", () => {
    const args = { data: { nope: null, expectedResult: null } };
    const out = normalizeJsonNullArgs("Steps", "create", args);
    expect(out.data.nope).toBeNull();
    expect(out.data.expectedResult).toBe(DbNull);
    const foreign = { data: { expectedResult: null } };
    expect(normalizeJsonNullArgs("NoSuchModel", "create", foreign)).toBe(
      foreign
    );
  });
});

describe("isNullableJsonField", () => {
  it("accepts only optional, scalar Json or typed-Json fields", () => {
    expect(isNullableJsonField({ type: "Json", optional: true })).toBe(true);
    expect(isNullableJsonField({ type: "Json" })).toBe(false);
    expect(
      isNullableJsonField({ type: "Json", optional: true, array: true })
    ).toBe(false);
    expect(isNullableJsonField({ type: "String", optional: true })).toBe(false);
    expect(
      isNullableJsonField({ type: "Steps", optional: true, relation: {} })
    ).toBe(false);
  });
});
