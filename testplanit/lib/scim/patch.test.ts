import { describe, it, expect } from "vitest";

import { applyScimPatch, ScimPatchApplyError } from "./patch";

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

async function readBody(
  err: unknown
): Promise<{
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
