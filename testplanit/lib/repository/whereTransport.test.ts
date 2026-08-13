import { AnyNull, DbNull, JsonNull } from "@zenstackhq/orm";
import { describe, expect, it } from "vitest";

import { buildFilterDimensions } from "./filterDimensions";
import { compileRepoPredicates } from "./filterWhereCompiler";
import {
  reviveWhereFromTransport,
  serializeWhereForTransport,
} from "./whereTransport";

const registry = buildFilterDimensions({
  dynamicFields: {
    Notes: { fieldId: 7, type: "Text Long" },
    Severity: { fieldId: 1, type: "Dropdown" },
  },
});

describe("whereTransport", () => {
  describe("serializeWhereForTransport", () => {
    it("replaces a live sentinel with its plain wire form", () => {
      const wire = serializeWhereForTransport({
        caseFieldValues: { some: { fieldId: 1, value: { not: JsonNull } } },
      });

      // Plain object, so JSON and React Flight both carry it intact.
      expect(wire).toEqual({
        caseFieldValues: {
          some: { fieldId: 1, value: { not: { __brand: "JsonNull" } } },
        },
      });
      expect(JSON.parse(JSON.stringify(wire))).toEqual(wire);
    });

    it("covers all three ZenStack null sentinels", () => {
      expect(
        serializeWhereForTransport({ a: JsonNull, b: DbNull, c: AnyNull })
      ).toEqual({
        a: { __brand: "JsonNull" },
        b: { __brand: "DbNull" },
        c: { __brand: "AnyNull" },
      });
    });

    it("leaves the rest of the where alone, Dates included", () => {
      const due = new Date("2026-01-01T00:00:00.000Z");
      const where = {
        AND: [
          { isDeleted: false, projectId: 4 },
          { name: { contains: "login", mode: "insensitive" } },
          { caseFieldValues: { some: { value: { gte: due } } } },
          { folderId: { in: [1, 2, 3] } },
          { estimate: null },
        ],
      };

      const wire = serializeWhereForTransport(where);

      expect(wire).toEqual(where);
      // A Date must stay a Date — cloning it field-by-field would erase the
      // bound and widen the filter.
      expect(
        (wire as any).AND[2].caseFieldValues.some.value.gte
      ).toBeInstanceOf(Date);
    });

    it("is idempotent", () => {
      const once = serializeWhereForTransport({ value: { not: JsonNull } });
      expect(serializeWhereForTransport(once)).toEqual(once);
    });
  });

  describe("reviveWhereFromTransport", () => {
    it("rebuilds live sentinels from the wire form", () => {
      const revived = reviveWhereFromTransport({
        caseFieldValues: {
          some: { fieldId: 1, value: { not: { __brand: "JsonNull" } } },
        },
      }) as any;

      expect(revived.caseFieldValues.some.value.not).toBe(JsonNull);
    });

    it("round-trips a compiled where with its sentinels intact", () => {
      // "Notes has any value" — a value-not-null fragment with no post-fetch
      // half, so a mangled sentinel here silently matches the wrong rows.
      const compiled = compileRepoPredicates(
        [{ dimension: "field_7", operator: "any", values: [] }],
        registry
      );
      expect(JSON.stringify(compiled)).toContain("JsonNull");

      const roundTripped = reviveWhereFromTransport(
        JSON.parse(JSON.stringify(serializeWhereForTransport(compiled)))
      );

      expect(roundTripped).toEqual(compiled);
    });

    it("repairs a body from a caller that never serialized", () => {
      // JSON.stringify flattens the instance to exactly the wire form, so the
      // route stays correct even if a client forgets to serialize.
      const asJson = JSON.parse(
        JSON.stringify({ value: { not: JsonNull } })
      ) as any;
      expect(asJson.value.not).not.toBe(JsonNull);

      expect((reviveWhereFromTransport(asJson) as any).value.not).toBe(
        JsonNull
      );
    });

    it("leaves ordinary Json objects alone", () => {
      const where = {
        value: { equals: { __brand: "something else" } },
        other: { equals: { __brand: "JsonNull", extra: 1 } },
      };
      expect(reviveWhereFromTransport(where)).toEqual(where);
    });

    it("is idempotent and a no-op on an already-live where", () => {
      const live = { value: { not: JsonNull } };
      expect((reviveWhereFromTransport(live) as any).value.not).toBe(JsonNull);
    });

    it("passes undefined through", () => {
      expect(reviveWhereFromTransport(undefined)).toBeUndefined();
      expect(serializeWhereForTransport(undefined)).toBeUndefined();
    });
  });
});
