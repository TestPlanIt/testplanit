import { describe, expect, it } from "vitest";

import {
  DEFECT_SCOPE_WHERE,
  ISSUE_ROLE_SCOPE_COLUMN,
  ISSUE_ROLE_SCOPE_SQL_DEFECT,
  REQUIREMENT_SCOPE_WHERE,
} from "./issueRoleScope";

// This module is the single shared expression of "is this Issue row a
// requirement" for the whole phase (HYG-01). Every assertion here protects
// the mirror contract between the object form (consumed by every ORM/hook
// where clause) and the raw-SQL form (the one call site that cannot import
// a TypeScript object) — a column rename that updates one form and not the
// other must fail this test, not surface later as a silent report leak.

describe("issueRoleScope", () => {
  it("DEFECT_SCOPE_WHERE deep-equals { isRequirement: false }", () => {
    expect(DEFECT_SCOPE_WHERE).toEqual({ isRequirement: false });
  });

  it("REQUIREMENT_SCOPE_WHERE deep-equals { isRequirement: true }", () => {
    expect(REQUIREMENT_SCOPE_WHERE).toEqual({ isRequirement: true });
  });

  it("both where-fragments are frozen", () => {
    expect(Object.isFrozen(DEFECT_SCOPE_WHERE)).toBe(true);
    expect(Object.isFrozen(REQUIREMENT_SCOPE_WHERE)).toBe(true);
  });

  it("a spread of DEFECT_SCOPE_WHERE produces a plain mutable object carrying isRequirement: false", () => {
    const spread = { projectId: 1, ...DEFECT_SCOPE_WHERE };

    expect(Object.isFrozen(spread)).toBe(false);
    expect(spread).toEqual({ projectId: 1, isRequirement: false });
  });

  it("ISSUE_ROLE_SCOPE_SQL_DEFECT is the literal raw-SQL mirror", () => {
    expect(ISSUE_ROLE_SCOPE_SQL_DEFECT).toBe('AND i."isRequirement" = false');
  });

  it("the mirror contract holds by construction: the SQL literal contains the column name", () => {
    expect(ISSUE_ROLE_SCOPE_SQL_DEFECT).toContain(ISSUE_ROLE_SCOPE_COLUMN);
  });

  it("ISSUE_ROLE_SCOPE_COLUMN is the sole own-key of both where-fragments", () => {
    expect(Object.keys(DEFECT_SCOPE_WHERE)).toEqual([ISSUE_ROLE_SCOPE_COLUMN]);
    expect(Object.keys(REQUIREMENT_SCOPE_WHERE)).toEqual([
      ISSUE_ROLE_SCOPE_COLUMN,
    ]);
  });
});
