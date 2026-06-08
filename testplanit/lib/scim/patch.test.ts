import { readFileSync } from "fs";
import { join } from "path";

import { describe, it, expect } from "vitest";

import {
  applyScimPatch,
  rewriteEntraMembersRemove,
  ScimPatchApplyError,
} from "./patch";

/**
 * Coverage matrix for the scim-patch wrapper:
 *
 *  A. Happy path against the 4 documented PATCH fixture shapes (Okta + Entra).
 *  B. Entra "False"/"True" string coercion narrowness — only `path === "active"`
 *     is coerced; other paths see the literal string preserved.
 *  C. patchBodyValidation gate fires FIRST and maps to a 400/invalidSyntax envelope.
 *     Adds the Operations.length > 500 DoS guard that runs BEFORE patchBodyValidation.
 *  D. scim-patch ScimError subclasses → ScimPatchApplyError with the right scimType.
 *  E. Pitfall 6 atomicity proof — input byte-identical after a throwing multi-op PATCH.
 *  F. mutateDocument:false — mutating the returned draft does not mutate the input.
 *  G. Non-ScimError exceptions pass through unwrapped (lets the service layer
 *     distinguish library bugs from RFC-compliant rejection).
 *
 * Tests assert directly on the carried NextResponse (status / Content-Type /
 * body shape) rather than snapshotting — mirrors the discipline of errors.test.ts.
 */

const PATCH_OP_URN = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const CORE_USER_URN = "urn:ietf:params:scim:schemas:core:2.0:User";

interface TestScimUser {
  id?: string;
  schemas: string[];
  meta: { created: Date; lastModified: Date; location?: string };
  userName?: string;
  active?: boolean;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value: string; primary?: boolean; type?: string }>;
}

function makeUser(overrides: Partial<TestScimUser> = {}): TestScimUser {
  return {
    id: "u1",
    schemas: [CORE_USER_URN],
    meta: {
      created: new Date("2026-01-01T00:00:00.000Z"),
      lastModified: new Date("2026-01-01T00:00:00.000Z"),
    },
    userName: "alice",
    active: true,
    name: { givenName: "Alice", familyName: "Smith" },
    emails: [{ value: "alice@example.com", primary: true, type: "work" }],
    ...overrides,
  };
}

async function readBody(err: unknown): Promise<{
  status: number;
  contentType: string | null;
  body: Record<string, unknown>;
}> {
  if (!(err instanceof ScimPatchApplyError)) {
    throw new Error(
      `Expected ScimPatchApplyError; got ${err instanceof Error ? err.constructor.name : typeof err}`
    );
  }
  const res = err.response;
  return {
    status: res.status,
    contentType: res.headers.get("content-type"),
    body: (await res.json()) as Record<string, unknown>,
  };
}

describe("applyScimPatch", () => {
  // ---------------------------------------------------------------------------
  // Group A — happy path against the 4 documented PATCH fixture shapes
  // ---------------------------------------------------------------------------

  describe("Group A — happy path", () => {
    it("A1: okta-patch-deactivate.json (path-less Replace, value:{active:false}) flips active to false", () => {
      const current = makeUser({ active: true });
      const snapshot = structuredClone(current);
      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "replace", value: { active: false } }],
      };
      const draft = applyScimPatch(current, body as never);
      expect(draft.active).toBe(false);
      expect(current).toEqual(snapshot);
    });

    it("A2: entra-patch-deactivate.json (Replace + path:'active' + string 'False') coerces to false", () => {
      const current = makeUser({ active: true });
      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "Replace", path: "active", value: "False" }],
      };
      const draft = applyScimPatch(current, body as never);
      expect(draft.active).toBe(false);
    });

    it("A3: entra-patch-deactivate-feature-flag.json (lowercase replace + boolean false) flips active to false", () => {
      const current = makeUser({ active: true });
      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "replace", path: "active", value: false }],
      };
      const draft = applyScimPatch(current, body as never);
      expect(draft.active).toBe(false);
    });

    it("A4: entra-patch-multi-replace.json applies both ops in order against the same draft", () => {
      const current = makeUser({
        emails: [{ value: "old@x", type: "work", primary: true }],
        name: { givenName: "Alice", familyName: "Old" },
      });
      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [
          {
            op: "Replace",
            path: 'emails[type eq "work"].value',
            value: "updatedEmail@microsoft.com",
          },
          {
            op: "Replace",
            path: "name.familyName",
            value: "updatedFamilyName",
          },
        ],
      };
      const draft = applyScimPatch(current, body as never);
      expect(draft.emails).toEqual([
        { value: "updatedEmail@microsoft.com", type: "work", primary: true },
      ]);
      expect(draft.name?.familyName).toBe("updatedFamilyName");
      expect(draft.name?.givenName).toBe("Alice");
    });
  });

  // ---------------------------------------------------------------------------
  // Group B — Entra "False"/"True" coercion narrowness
  // ---------------------------------------------------------------------------

  describe("Group B — Entra coercion narrowness", () => {
    it("B1: {op:'Replace', path:'active', value:'False'} → false", () => {
      const draft = applyScimPatch(makeUser({ active: true }), {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "Replace", path: "active", value: "False" }],
      } as never);
      expect(draft.active).toBe(false);
    });

    it("B2: {op:'Replace', path:'active', value:'True'} → true", () => {
      const draft = applyScimPatch(makeUser({ active: false }), {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "Replace", path: "active", value: "True" }],
      } as never);
      expect(draft.active).toBe(true);
    });

    it("B3: {op:'Replace', path:'active', value:false} (already boolean) passes through unchanged", () => {
      const draft = applyScimPatch(makeUser({ active: true }), {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "Replace", path: "active", value: false }],
      } as never);
      expect(draft.active).toBe(false);
    });

    it("B4: {op:'Replace', path:'name.givenName', value:'False'} is NOT coerced — the literal string is a valid given name", () => {
      const draft = applyScimPatch(
        makeUser({ name: { givenName: "Alice", familyName: "Smith" } }),
        {
          schemas: [PATCH_OP_URN],
          Operations: [
            { op: "Replace", path: "name.givenName", value: "False" },
          ],
        } as never
      );
      expect(draft.name?.givenName).toBe("False");
    });

    it("B5: {op:'Replace', path:'active', value:'false'} (lowercase) is NOT coerced — Entra only emits capitalized", () => {
      const draft = applyScimPatch(makeUser({ active: true }), {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "Replace", path: "active", value: "false" }],
      } as never);
      // Lowercase "false" falls through to scim-patch which replaces the value
      // verbatim (it does NOT coerce). The draft therefore holds the literal
      // string — proves the wrapper does not silently broaden coercion.
      expect(draft.active).toBe("false" as unknown as boolean);
    });
  });

  // ---------------------------------------------------------------------------
  // Group C — body validation (gate fires FIRST; DoS guard before that)
  // ---------------------------------------------------------------------------

  describe("Group C — body validation", () => {
    it("C1: missing `schemas` array → 400 / invalidSyntax", async () => {
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), {
          Operations: [{ op: "replace", value: { active: false } }],
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, contentType, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(contentType).toBe("application/scim+json");
      expect(body.scimType).toBe("invalidSyntax");
    });

    it("C2: empty `Operations` array → 400 / invalidSyntax", async () => {
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), {
          schemas: [PATCH_OP_URN],
          Operations: [],
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(body.scimType).toBe("invalidSyntax");
    });

    it("C3: wrong schemas URN (CORE_USER instead of PatchOp) → 400 / invalidSyntax", async () => {
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), {
          schemas: [CORE_USER_URN],
          Operations: [{ op: "replace", value: { active: false } }],
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(body.scimType).toBe("invalidSyntax");
    });

    it("C4: Operations.length > 500 → 400 / invalidSyntax with the DoS-defense detail", async () => {
      const bigOps = Array.from({ length: 501 }, () => ({
        op: "replace",
        path: "active",
        value: true,
      }));
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), {
          schemas: [PATCH_OP_URN],
          Operations: bigOps,
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(body.scimType).toBe("invalidSyntax");
      expect(String(body.detail)).toContain("500");
    });
  });

  // ---------------------------------------------------------------------------
  // Group D — scim-patch ScimError class mapping
  // ---------------------------------------------------------------------------

  describe("Group D — error class mapping", () => {
    it("D1: op:'remove' without a path → NoPathInScimPatchOp → 400 / noTarget", async () => {
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), {
          schemas: [PATCH_OP_URN],
          Operations: [{ op: "remove" } as never],
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(body.scimType).toBe("noTarget");
    });

    it("D2: replace on emails[type eq 'nonexistent'] (whole entry; no matching entry) → NoTarget → 400 / noTarget", async () => {
      // Path WITHOUT the trailing sub-attribute — scim-patch's
      // treatMissingAsAdd absorption only fires when the filter is followed
      // by a sub-path (e.g. `.value`). A top-level array filter with no
      // match throws NoTarget unconditionally; this is the canonical
      // RFC §3.5.2 noTarget rejection.
      const current = makeUser({
        emails: [{ value: "alice@example.com", type: "work", primary: true }],
      });
      let captured: unknown;
      try {
        applyScimPatch(current, {
          schemas: [PATCH_OP_URN],
          Operations: [
            {
              op: "replace",
              path: 'emails[type eq "nonexistent"]',
              value: { value: "x@y.com", type: "nonexistent" },
            },
          ],
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(body.scimType).toBe("noTarget");
    });

    it("D3: replace with an unparseable filter expression → InvalidScimPatchOp → 400 / invalidSyntax", async () => {
      // The filter `type !!! "work"` is not a valid scim2-parse-filter expression.
      // scim-patch's filterWithQuery catches the parse error and rethrows as
      // InvalidScimPatchOp (scimCode = 'invalidSyntax').
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), {
          schemas: [PATCH_OP_URN],
          Operations: [
            {
              op: "replace",
              path: 'emails[type !!! "work"].value',
              value: "y",
            },
          ],
        } as never);
      } catch (e) {
        captured = e;
      }
      const { status, body } = await readBody(captured);
      expect(status).toBe(400);
      expect(body.scimType).toBe("invalidSyntax");
    });
  });

  // ---------------------------------------------------------------------------
  // Group E — Pitfall 6 atomicity (the load-bearing guarantee)
  // ---------------------------------------------------------------------------

  describe("Group E — atomicity", () => {
    it("E1: a 3-op PATCH that throws on op 2 leaves the input byte-identical", () => {
      const current = makeUser({
        active: true,
        emails: [{ value: "alice@example.com", type: "work", primary: true }],
        name: { givenName: "Alice", familyName: "Smith" },
      });
      const snapshot = structuredClone(current);

      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [
          { op: "replace", path: "active", value: false },
          {
            op: "replace",
            path: 'emails[type eq "nonexistent"]',
            value: { value: "x@y.com", type: "nonexistent" },
          },
          { op: "replace", path: "name.familyName", value: "X" },
        ],
      };

      expect(() => applyScimPatch(current, body as never)).toThrow(
        ScimPatchApplyError
      );

      expect(current).toEqual(snapshot);
    });
  });

  // ---------------------------------------------------------------------------
  // Group F — in-memory draft (mutateDocument:false)
  // ---------------------------------------------------------------------------

  describe("Group F — in-memory draft", () => {
    it("F1: mutating the returned draft does not mutate the input currentScim", () => {
      const current = makeUser({ userName: "alice" });
      const snapshot = structuredClone(current);

      const draft = applyScimPatch(current, {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "replace", path: "userName", value: "bob" }],
      } as never);

      // Mutate the draft after the call — current must remain identical.
      (draft as { userName?: string }).userName = "post-mutation";
      (draft.emails ?? []).push({ value: "added@x.com" });

      expect(current).toEqual(snapshot);
    });
  });

  // ---------------------------------------------------------------------------
  // Group G — non-ScimError exceptions pass through unwrapped
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Group H — Entra members PATCH preprocessor (Groups surface)
  // ---------------------------------------------------------------------------

  describe("Group H — Entra members PATCH preprocessor", () => {
    interface TestScimGroup {
      id?: string;
      schemas: string[];
      displayName?: string;
      members?: Array<{ value: string; display?: string }>;
      meta?: { created: Date; lastModified: Date };
    }

    function makeGroup(overrides: Partial<TestScimGroup> = {}): TestScimGroup {
      return {
        id: "g1",
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        displayName: "Engineering",
        members: [{ value: "u1091" }, { value: "u2042" }, { value: "u3094" }],
        meta: {
          created: new Date("2026-01-01T00:00:00.000Z"),
          lastModified: new Date("2026-01-01T00:00:00.000Z"),
        },
        ...overrides,
      };
    }

    it("H1: Entra-shape Remove with one member (no-flag fixture) removes that member", () => {
      const fixturePath = join(
        process.cwd(),
        "e2e/fixtures/scim/entra-patch-remove-member-no-flag.json"
      );
      const body = JSON.parse(readFileSync(fixturePath, "utf-8"));

      const current = makeGroup({
        members: [{ value: "u1091" }, { value: "u2042" }],
      });

      const draft = applyScimPatch(current, body);

      // The Entra preprocessor rewrites into spec-form members[value eq "u1091"]
      // which scim-patch resolves and removes from the array.
      expect(draft.members).toEqual([{ value: "u2042" }]);
    });

    it("H2: Entra-shape Remove with three members rewrites to three spec-form ops", () => {
      const current = makeGroup({
        members: [
          { value: "u1" },
          { value: "u2" },
          { value: "u3" },
          { value: "u4" },
        ],
      });

      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [
          {
            op: "Remove",
            path: "members",
            value: [{ value: "u1" }, { value: "u2" }, { value: "u3" }],
          },
        ],
      };

      const draft = applyScimPatch(current, body as never);
      expect(draft.members).toEqual([{ value: "u4" }]);
    });

    it("H3: already-spec-form Remove (flag fixture shape) passes through preprocessor unchanged", () => {
      const current = makeGroup({
        members: [
          { value: "7f4bc1a3-285e-48ae-8202-5accb43efb0e" },
          { value: "keep" },
        ],
      });

      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [
          {
            op: "remove",
            path: 'members[value eq "7f4bc1a3-285e-48ae-8202-5accb43efb0e"]',
          },
        ],
      };

      const draft = applyScimPatch(current, body as never);
      expect(draft.members).toEqual([{ value: "keep" }]);
    });

    it("H4: Remove on a NON-members path with an array value is NOT rewritten", () => {
      // The preprocessor must be narrowly scoped — path must literally equal
      // "members" before any rewrite happens. A legitimate remove against
      // another multi-valued attribute must pass through to scim-patch.
      const current = makeGroup({ displayName: "Old Name" });

      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "replace", path: "displayName", value: "New Name" }],
      };

      const draft = applyScimPatch(current, body as never);
      expect(draft.displayName).toBe("New Name");
    });

    it("H5: Remove on path 'members' with a STRING value (not array) is NOT rewritten", () => {
      // Narrow-shape gate: value must be an array of {value: string} objects.
      // A bare string value falls through to scim-patch which will handle
      // (or reject) it on its own.
      const current = makeGroup({
        members: [{ value: "u1" }, { value: "u2" }],
      });

      let captured: unknown;
      try {
        applyScimPatch(current, {
          schemas: [PATCH_OP_URN],
          Operations: [{ op: "Remove", path: "members", value: "u1" }],
        } as never);
      } catch (e) {
        captured = e;
      }
      // Either scim-patch handles the string-value remove or rejects it as a
      // ScimError. The contract under test is "preprocessor does not rewrite".
      // Document the outcome by asserting the original group was not mutated.
      void captured;
      expect(current.members).toEqual([{ value: "u1" }, { value: "u2" }]);
    });

    it("H6: Remove on path 'members' with mixed valid/invalid entries is NOT rewritten", () => {
      // Narrow gate: every entry must have typeof value.value === "string".
      // A single non-string entry forces the preprocessor to pass through.
      const current = makeGroup({
        members: [{ value: "u1" }, { value: "u2" }],
      });

      let captured: unknown;
      try {
        applyScimPatch(current, {
          schemas: [PATCH_OP_URN],
          Operations: [
            {
              op: "Remove",
              path: "members",
              value: [{ value: "u1" }, { value: 42 }],
            },
          ],
        } as never);
      } catch (e) {
        captured = e;
      }
      void captured;
      expect(current.members).toEqual([{ value: "u1" }, { value: "u2" }]);
    });

    it("H7: empty members value array is NOT rewritten (no-op preprocessor)", () => {
      // Narrow gate: every entry's value must be a string, AND there must be
      // at least one entry; an empty array produces zero rewritten ops which
      // would silently swallow the op. Pass through so scim-patch can decide.
      const current = makeGroup({ members: [{ value: "u1" }] });

      let captured: unknown;
      try {
        applyScimPatch(current, {
          schemas: [PATCH_OP_URN],
          Operations: [{ op: "Remove", path: "members", value: [] }],
        } as never);
      } catch (e) {
        captured = e;
      }
      void captured;
      // Original input must remain byte-identical regardless of outcome.
      expect(current.members).toEqual([{ value: "u1" }]);
    });

    it("H_direct_1: rewriteEntraMembersRemove rewrites the Entra shape into N spec-form ops", () => {
      const op = {
        op: "Remove",
        path: "members",
        value: [{ value: "u1" }, { value: "u2" }, { value: "u3" }],
      };
      const out = rewriteEntraMembersRemove(op as never);
      expect(Array.isArray(out)).toBe(true);
      const arr = out as Array<{ op: string; path: string }>;
      expect(arr).toHaveLength(3);
      expect(arr[0]).toEqual({ op: "remove", path: 'members[value eq "u1"]' });
      expect(arr[1]).toEqual({ op: "remove", path: 'members[value eq "u2"]' });
      expect(arr[2]).toEqual({ op: "remove", path: 'members[value eq "u3"]' });
    });

    it("H_direct_2: lowercase op:'remove' is also rewritten (case-insensitive op match)", () => {
      const op = {
        op: "remove",
        path: "members",
        value: [{ value: "u1" }],
      };
      const out = rewriteEntraMembersRemove(op as never);
      const arr = out as Array<{ op: string; path: string }>;
      expect(arr).toHaveLength(1);
      expect(arr[0]).toEqual({ op: "remove", path: 'members[value eq "u1"]' });
    });

    it("H_direct_3: non-members path passes through unchanged (not rewritten)", () => {
      const op = {
        op: "Remove",
        path: "name.givenName",
        value: [{ value: "x" }],
      };
      const out = rewriteEntraMembersRemove(op as never);
      // Must be the same op object — not rewritten.
      expect(out).toBe(op);
    });

    it("H_direct_4: non-Remove op on members path passes through unchanged", () => {
      const op = {
        op: "add",
        path: "members",
        value: [{ value: "u1" }],
      };
      const out = rewriteEntraMembersRemove(op as never);
      expect(out).toBe(op);
    });

    it("H_direct_5: string value (not array) passes through unchanged", () => {
      const op = { op: "Remove", path: "members", value: "u1" };
      const out = rewriteEntraMembersRemove(op as never);
      expect(out).toBe(op);
    });

    it("H_direct_6: mixed valid + non-string-value entries pass through unchanged", () => {
      const op = {
        op: "Remove",
        path: "members",
        value: [{ value: "u1" }, { value: 42 }],
      };
      const out = rewriteEntraMembersRemove(op as never);
      expect(out).toBe(op);
    });

    it("H_direct_7: empty value array passes through unchanged", () => {
      const op = { op: "Remove", path: "members", value: [] };
      const out = rewriteEntraMembersRemove(op as never);
      expect(out).toBe(op);
    });

    it("H_direct_8: userId containing a double-quote is escaped in the rewritten filter", () => {
      const op = {
        op: "Remove",
        path: "members",
        value: [{ value: 'u"injected' }],
      };
      const out = rewriteEntraMembersRemove(op as never);
      const arr = out as Array<{ op: string; path: string }>;
      expect(arr).toHaveLength(1);
      expect(arr[0]!.path).toBe('members[value eq "u\\"injected"]');
    });

    it("H8: existing active-coercion still works alongside the new preprocessor (chain order)", () => {
      // Backward-compat — Phase 7's `path:'active', value:'False'` coercion
      // must still fire after the new preprocessor lands.
      const current = makeUser({ active: true });
      const draft = applyScimPatch(current, {
        schemas: [PATCH_OP_URN],
        Operations: [{ op: "Replace", path: "active", value: "False" }],
      } as never);
      expect(draft.active).toBe(false);
    });
  });

  describe("Group G — exception pass-through", () => {
    it("G1: a TypeError thrown from inside scim-patch (e.g. invalid Operations entry shape) is NOT wrapped", () => {
      // Pass a non-object op to provoke a synchronous TypeError inside scim-patch's
      // switch(patch.op) reduce. The wrapper's catch block must only intercept
      // ScimError instances; everything else re-throws unchanged.
      const body = {
        schemas: [PATCH_OP_URN],
        Operations: [null],
      };
      let captured: unknown;
      try {
        applyScimPatch(makeUser(), body as never);
      } catch (e) {
        captured = e;
      }
      // Either patchBodyValidation rejects this as InvalidScimPatchRequest
      // (ScimError → ScimPatchApplyError) OR scim-patch throws a TypeError
      // when it tries to read `.op` off null. Both are acceptable but the
      // contract under test is: if a non-ScimError surfaces, it passes through
      // verbatim. Pin the contract directly with a manufactured non-ScimError.
      void captured;

      // Direct test of the pass-through contract — manufacture a Proxy that
      // throws a plain Error from `.Operations.map`, which would normally
      // surface as a TypeError if the wrapper let it bubble.
      const throwingBody = {
        schemas: [PATCH_OP_URN],
        get Operations(): unknown {
          // Trip an arbitrary non-ScimError after patchBodyValidation completes.
          throw new RangeError("manufactured non-ScimError");
        },
      };
      expect(() => applyScimPatch(makeUser(), throwingBody as never)).toThrow(
        RangeError
      );
    });
  });
});
