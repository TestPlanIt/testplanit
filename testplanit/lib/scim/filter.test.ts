import { describe, it, expect } from "vitest";

import {
  InvalidFilterError,
  scimFilterToDbGroupWhere,
  scimFilterToDbWhere,
} from "./filter";

/**
 * Coverage matrix for the SCIM filter translator:
 *
 *  A. Happy-path `eq` translation — one test per whitelisted attribute, locking
 *     case-fold rules (userName lowercased on compare, externalId verbatim,
 *     emails.value case-insensitive).
 *  B. Presence operator `pr` — nullable columns emit `{ not: null }`; NOT NULL
 *     columns (active, emails.value via User.email) emit vacuous `{}`.
 *  C. Logical `and` — two-way, three-way, and mixed eq + pr children.
 *  D. Operator-rejection — every operator outside the whitelist (ne, co, sw,
 *     ew, gt, lt, ge, le, or, not, valuePath `[]`) throws the documented
 *     English `detail` string.
 *  E. Whitelist rejection — non-whitelisted attribute paths and URN-prefixed
 *     attrPaths throw with `Attribute "<attrPath>" not filterable`.
 *  F. Type-mismatch rejection — compValue type must match column type.
 *  G. Parser-error wrap — malformed input maps to InvalidFilterError with
 *     `Filter could not be parsed:` prefix.
 *  H. Adversarial input — SQL-injection-shaped compValue is captured as a
 *     literal string inside a Prisma WHERE; deep AND nesting does not crash.
 *
 * Tests use `toEqual` for exact-shape assertions and assert directly on the
 * thrown `InvalidFilterError.message`. No snapshots.
 */

describe("scimFilterToDbWhere", () => {
  // ---------------------------------------------------------------------------
  // Group A — Happy-path `eq` per whitelisted attribute
  // ---------------------------------------------------------------------------

  it("A1: translates 'userName eq \"Alice\"' to case-folded scimUserName equals", () => {
    expect(scimFilterToDbWhere('userName eq "Alice"')).toEqual({
      scimUserName: { equals: "alice" },
    });
  });

  it("A2: translates 'userName eq \"alice@example.com\"' verbatim (already lowercase)", () => {
    expect(scimFilterToDbWhere('userName eq "alice@example.com"')).toEqual({
      scimUserName: { equals: "alice@example.com" },
    });
  });

  it("A3: translates 'externalId eq <opaque>' verbatim (never case-folded)", () => {
    expect(scimFilterToDbWhere('externalId eq "00ujl29u0le5T6Aj10h7"')).toEqual(
      {
        scimExternalId: { equals: "00ujl29u0le5T6Aj10h7" },
      }
    );
  });

  it("A4: translates 'active eq true' to isActive: true", () => {
    expect(scimFilterToDbWhere("active eq true")).toEqual({
      isActive: true,
    });
  });

  it("A5: translates 'active eq false' to isActive: false", () => {
    expect(scimFilterToDbWhere("active eq false")).toEqual({
      isActive: false,
    });
  });

  it("A6: translates 'emails.value eq <X>' to case-insensitive email equals", () => {
    expect(scimFilterToDbWhere('emails.value eq "Alice@Example.COM"')).toEqual({
      email: { equals: "Alice@Example.COM", mode: "insensitive" },
    });
  });

  it("A7: translates 'name.givenName eq \"Alice\"' to scimGivenName equals", () => {
    expect(scimFilterToDbWhere('name.givenName eq "Alice"')).toEqual({
      scimGivenName: { equals: "Alice" },
    });
  });

  it("A8: translates 'name.familyName eq \"Smith\"' to scimFamilyName equals", () => {
    expect(scimFilterToDbWhere('name.familyName eq "Smith"')).toEqual({
      scimFamilyName: { equals: "Smith" },
    });
  });

  // ---------------------------------------------------------------------------
  // Group B — `pr` (presence) per whitelisted attribute
  // ---------------------------------------------------------------------------

  it("B1: 'userName pr' translates to scimUserName not null", () => {
    expect(scimFilterToDbWhere("userName pr")).toEqual({
      scimUserName: { not: null },
    });
  });

  it("B2: 'externalId pr' translates to scimExternalId not null", () => {
    expect(scimFilterToDbWhere("externalId pr")).toEqual({
      scimExternalId: { not: null },
    });
  });

  it("B3: 'active pr' is vacuous on NOT NULL column — returns {}", () => {
    expect(scimFilterToDbWhere("active pr")).toEqual({});
  });

  it("B4: 'emails.value pr' is vacuous on NOT NULL User.email — returns {}", () => {
    expect(scimFilterToDbWhere("emails.value pr")).toEqual({});
  });

  it("B5: 'name.givenName pr' translates to scimGivenName not null", () => {
    expect(scimFilterToDbWhere("name.givenName pr")).toEqual({
      scimGivenName: { not: null },
    });
  });

  it("B6: 'name.familyName pr' translates to scimFamilyName not null", () => {
    expect(scimFilterToDbWhere("name.familyName pr")).toEqual({
      scimFamilyName: { not: null },
    });
  });

  // ---------------------------------------------------------------------------
  // Group C — `and` (logical conjunction)
  // ---------------------------------------------------------------------------

  it("C1: two-way AND of eq + eq", () => {
    expect(
      scimFilterToDbWhere('userName eq "alice" and active eq true')
    ).toEqual({
      AND: [{ scimUserName: { equals: "alice" } }, { isActive: true }],
    });
  });

  it("C2: two-way AND across externalId + name.familyName", () => {
    expect(
      scimFilterToDbWhere('externalId eq "x" and name.familyName eq "Smith"')
    ).toEqual({
      AND: [
        { scimExternalId: { equals: "x" } },
        { scimFamilyName: { equals: "Smith" } },
      ],
    });
  });

  it("C3: three-way AND", () => {
    const out = scimFilterToDbWhere(
      'userName eq "a" and externalId eq "b" and active eq true'
    );
    // scim2-parse-filter folds chained AND into a left-leaning tree, so we
    // assert that the result contains exactly the three expected leaf clauses
    // somewhere in the AND structure (flattened).
    const flat = flattenAnd(out);
    expect(flat).toHaveLength(3);
    expect(flat).toEqual(
      expect.arrayContaining([
        { scimUserName: { equals: "a" } },
        { scimExternalId: { equals: "b" } },
        { isActive: true },
      ])
    );
  });

  it("C4: AND with a pr child", () => {
    expect(
      scimFilterToDbWhere('userName eq "alice" and externalId pr')
    ).toEqual({
      AND: [
        { scimUserName: { equals: "alice" } },
        { scimExternalId: { not: null } },
      ],
    });
  });

  // ---------------------------------------------------------------------------
  // Group D — Operator-rejection (closed operator whitelist)
  // ---------------------------------------------------------------------------

  it("D1: 'ne' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName ne "alice"')).toThrow(
      new InvalidFilterError('Operator "ne" not supported')
    );
  });

  it("D2: 'co' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName co "ali"')).toThrow(
      new InvalidFilterError('Operator "co" not supported')
    );
  });

  it("D3: 'sw' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName sw "ali"')).toThrow(
      new InvalidFilterError('Operator "sw" not supported')
    );
  });

  it("D4: 'ew' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName ew "ice"')).toThrow(
      new InvalidFilterError('Operator "ew" not supported')
    );
  });

  it("D5: 'gt' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName gt "alice"')).toThrow(
      new InvalidFilterError('Operator "gt" not supported')
    );
  });

  it("D6: 'lt' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName lt "alice"')).toThrow(
      new InvalidFilterError('Operator "lt" not supported')
    );
  });

  it("D7: 'ge' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName ge "alice"')).toThrow(
      new InvalidFilterError('Operator "ge" not supported')
    );
  });

  it("D8: 'le' is not supported", () => {
    expect(() => scimFilterToDbWhere('userName le "alice"')).toThrow(
      new InvalidFilterError('Operator "le" not supported')
    );
  });

  it("D9: 'or' is not supported", () => {
    expect(() =>
      scimFilterToDbWhere('userName eq "alice" or userName eq "bob"')
    ).toThrow(new InvalidFilterError('Operator "or" not supported'));
  });

  it("D10: 'not' is not supported", () => {
    expect(() => scimFilterToDbWhere('not (userName eq "alice")')).toThrow(
      new InvalidFilterError('Operator "not" not supported')
    );
  });

  it("D11: valuePath '[]' is not supported", () => {
    expect(() => scimFilterToDbWhere('emails[type eq "work"]')).toThrow(
      new InvalidFilterError('Operator "[]" not supported')
    );
  });

  // ---------------------------------------------------------------------------
  // Group E — Whitelist rejection (closed attribute set)
  // ---------------------------------------------------------------------------

  it("E1: 'title' is not filterable", () => {
    expect(() => scimFilterToDbWhere('title eq "Engineer"')).toThrow(
      new InvalidFilterError('Attribute "title" not filterable')
    );
  });

  it("E2: 'displayName' is not filterable", () => {
    expect(() => scimFilterToDbWhere('displayName eq "x"')).toThrow(
      new InvalidFilterError('Attribute "displayName" not filterable')
    );
  });

  it("E3: 'phoneNumbers.value' is not filterable", () => {
    expect(() => scimFilterToDbWhere('phoneNumbers.value eq "1234"')).toThrow(
      new InvalidFilterError('Attribute "phoneNumbers.value" not filterable')
    );
  });

  it("E4: 'addresses.value' is not filterable", () => {
    expect(() => scimFilterToDbWhere('addresses.value eq "x"')).toThrow(
      new InvalidFilterError('Attribute "addresses.value" not filterable')
    );
  });

  it("E5: URN-prefixed enterprise extension attrPath is not filterable", () => {
    const filter =
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber pr";
    expect(() => scimFilterToDbWhere(filter)).toThrow(InvalidFilterError);
    try {
      scimFilterToDbWhere(filter);
    } catch (e) {
      expect((e as InvalidFilterError).message).toContain("not filterable");
    }
  });

  // ---------------------------------------------------------------------------
  // Group F — Type-mismatch rejection
  // ---------------------------------------------------------------------------

  it("F1: 'active eq \"yes\"' rejects non-boolean compValue", () => {
    expect(() => scimFilterToDbWhere('active eq "yes"')).toThrow(
      new InvalidFilterError('Value for "active" must be boolean')
    );
  });

  it("F2: 'userName eq 1' rejects non-string compValue", () => {
    expect(() => scimFilterToDbWhere("userName eq 1")).toThrow(
      new InvalidFilterError('Value for "userName" must be string')
    );
  });

  it("F3: 'externalId eq null' rejects null compValue", () => {
    expect(() => scimFilterToDbWhere("externalId eq null")).toThrow(
      new InvalidFilterError('Value for "externalId" must be string')
    );
  });

  // ---------------------------------------------------------------------------
  // Group G — Parser-error wrap
  // ---------------------------------------------------------------------------

  it("G1: empty string maps to parser-error envelope", () => {
    expect(() => scimFilterToDbWhere("")).toThrow(InvalidFilterError);
    try {
      scimFilterToDbWhere("");
    } catch (e) {
      expect((e as InvalidFilterError).message).toMatch(
        /^Filter could not be parsed:/
      );
    }
  });

  it("G2: 'userName eq' (missing compValue) maps to parser-error envelope", () => {
    expect(() => scimFilterToDbWhere("userName eq")).toThrow(
      InvalidFilterError
    );
    try {
      scimFilterToDbWhere("userName eq");
    } catch (e) {
      expect((e as InvalidFilterError).message).toMatch(
        /^Filter could not be parsed:/
      );
    }
  });

  it("G3: unbalanced quote maps to parser-error envelope", () => {
    expect(() => scimFilterToDbWhere('userName eq "alice')).toThrow(
      InvalidFilterError
    );
    try {
      scimFilterToDbWhere('userName eq "alice');
    } catch (e) {
      expect((e as InvalidFilterError).message).toMatch(
        /^Filter could not be parsed:/
      );
    }
  });

  // ---------------------------------------------------------------------------
  // Group H — Adversarial input
  // ---------------------------------------------------------------------------

  it("H1: SQL-injection-shaped compValue is captured as a literal string", () => {
    const adversarial = 'userName eq "alice\\"; DROP TABLE Users; --"';
    const out = scimFilterToDbWhere(adversarial);
    // The compValue lands as a literal string inside Prisma's parameterized
    // WHERE — we never template-string the user input into raw SQL anywhere.
    expect(out).toEqual({
      scimUserName: {
        equals: 'alice"; drop table users; --',
      },
    });
  });

  it("H2: deeply nested AND does not blow the stack", () => {
    const filter =
      'userName eq "abc" and userName eq "def" and userName eq "ghi" and userName eq "jkl"';
    const out = scimFilterToDbWhere(filter);
    const flat = flattenAnd(out);
    expect(flat).toHaveLength(4);
    expect(flat).toEqual(
      expect.arrayContaining([
        { scimUserName: { equals: "abc" } },
        { scimUserName: { equals: "def" } },
        { scimUserName: { equals: "ghi" } },
        { scimUserName: { equals: "jkl" } },
      ])
    );
  });
});

describe("scimFilterToDbGroupWhere", () => {
  // ---------------------------------------------------------------------------
  // Group A — happy-path translation
  // ---------------------------------------------------------------------------

  it("A1: 'displayName eq <X>' translates to scimDisplayName lowercased equals", () => {
    expect(scimFilterToDbGroupWhere('displayName eq "Engineering"')).toEqual({
      scimDisplayName: { equals: "engineering" },
    });
  });

  it("A2: 'externalId eq <X>' translates verbatim (opaque IdP identifier)", () => {
    expect(scimFilterToDbGroupWhere('externalId eq "abc-123"')).toEqual({
      externalId: { equals: "abc-123" },
    });
  });

  it("A3: 'displayName eq <X> and externalId pr' translates to AND of equals + not-null", () => {
    expect(
      scimFilterToDbGroupWhere('displayName eq "Engineering" and externalId pr')
    ).toEqual({
      AND: [
        { scimDisplayName: { equals: "engineering" } },
        { externalId: { not: null } },
      ],
    });
  });

  it("A4: 'displayName pr' translates to scimDisplayName not null", () => {
    expect(scimFilterToDbGroupWhere("displayName pr")).toEqual({
      scimDisplayName: { not: null },
    });
  });

  // ---------------------------------------------------------------------------
  // Group B — whitelist gating
  // ---------------------------------------------------------------------------

  it("B1: 'userName eq <X>' (User attr) is rejected with InvalidFilterError", () => {
    expect(() => scimFilterToDbGroupWhere('userName eq "x"')).toThrow(
      InvalidFilterError
    );
    try {
      scimFilterToDbGroupWhere('userName eq "x"');
    } catch (e) {
      expect((e as InvalidFilterError).message).toContain("not filterable");
    }
  });

  it("B2: 'displayName co \"Eng\"' (unsupported operator) is rejected", () => {
    expect(() => scimFilterToDbGroupWhere('displayName co "Eng"')).toThrow(
      InvalidFilterError
    );
    try {
      scimFilterToDbGroupWhere('displayName co "Eng"');
    } catch (e) {
      expect((e as InvalidFilterError).message).toContain("not supported");
    }
  });

  it("B3: URN-prefixed attrPath is rejected", () => {
    const filter =
      'urn:ietf:params:scim:schemas:enterprise:2.0:User:department eq "Eng"';
    expect(() => scimFilterToDbGroupWhere(filter)).toThrow(InvalidFilterError);
  });

  // ---------------------------------------------------------------------------
  // Group C — parser error mapping
  // ---------------------------------------------------------------------------

  it("C1: 'displayName eq' (missing compValue) maps to parser-error envelope", () => {
    expect(() => scimFilterToDbGroupWhere("displayName eq")).toThrow(
      InvalidFilterError
    );
    try {
      scimFilterToDbGroupWhere("displayName eq");
    } catch (e) {
      expect((e as InvalidFilterError).message).toMatch(
        /^Filter could not be parsed:/
      );
    }
  });

  it("C2: '!!! invalid !!!' maps to parser-error envelope", () => {
    expect(() => scimFilterToDbGroupWhere("!!! invalid !!!")).toThrow(
      InvalidFilterError
    );
  });
});

/**
 * Walk a possibly nested `{ AND: [...] }` tree and return the flat list of
 * leaf clauses. `scim2-parse-filter` folds chained `a and b and c` into a
 * left-leaning AST `(a and b) and c`, which we translate verbatim — this
 * helper lets tests assert on the set of leaf clauses regardless of nesting.
 */
function flattenAnd(node: unknown): unknown[] {
  if (
    node !== null &&
    typeof node === "object" &&
    "AND" in node &&
    Array.isArray((node as { AND: unknown[] }).AND)
  ) {
    return (node as { AND: unknown[] }).AND.flatMap(flattenAnd);
  }
  return [node];
}
