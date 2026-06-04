import { describe, it, expect } from "vitest";

import {
  SCIM_CONTENT_TYPE,
  SCIM_ERROR_SCHEMA,
  SCIM_ERROR_TYPES,
} from "./constants";
import { scimError, type ScimErrorBody } from "./errors";

/**
 * Read a Response body as the parsed SCIM error envelope. Co-located helper
 * so each test stays a single assertion shape.
 */
async function readErrorBody(res: Response): Promise<ScimErrorBody> {
  return (await res.json()) as ScimErrorBody;
}

describe("scimError", () => {
  it("is exported as a function, not a class (CONTEXT.md D-12 invariant)", () => {
    expect(typeof scimError).toBe("function");
    // A regular function's prototype is a plain object; a class's prototype
    // is non-callable but its constructor would be invoked with `new`.
    // The cheapest invariant: there must be no source-level `class` keyword
    // — we verify behaviorally by confirming the export is callable without
    // `new` and returns a Response (not an instance with .toResponse()).
    expect(scimError(500, "x")).toBeInstanceOf(Response);
  });

  it("sets Content-Type to application/scim+json", async () => {
    const res = scimError(500, "boom");
    expect(res.headers.get("Content-Type")).toBe(SCIM_CONTENT_TYPE);
  });

  it("emits status as a string and matches the HTTP status code", async () => {
    const res = scimError(404, "not found");
    expect(res.status).toBe(404);
    const body = await readErrorBody(res);
    expect(body.status).toBe("404");
  });

  it("includes the Error schema URN", async () => {
    const res = scimError(500, "boom");
    const body = await readErrorBody(res);
    expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
  });

  it("omits scimType when not supplied", async () => {
    const res = scimError(500, "boom");
    const body = await readErrorBody(res);
    expect(body).not.toHaveProperty("scimType");
  });

  it("preserves the English detail string verbatim (no i18n)", async () => {
    const res = scimError(400, "Filter could not be parsed", "invalidFilter");
    const body = await readErrorBody(res);
    expect(body.detail).toBe("Filter could not be parsed");
  });

  // ---------------------------------------------------------------------------
  // RFC 7644 §3.12 Table 9 — every status/scimType pair from CONTEXT.md D-10
  // ---------------------------------------------------------------------------

  describe("RFC 7644 §3.12 status / scimType combinations", () => {
    it("400 + invalidFilter", async () => {
      const res = scimError(400, "bad filter", SCIM_ERROR_TYPES.invalidFilter);
      expect(res.status).toBe(400);
      const body = await readErrorBody(res);
      expect(body.status).toBe("400");
      expect(body.scimType).toBe("invalidFilter");
      expect(body.detail).toBe("bad filter");
      expect(body.schemas).toEqual([SCIM_ERROR_SCHEMA]);
    });

    it("400 + invalidPath", async () => {
      const res = scimError(400, "bad path", SCIM_ERROR_TYPES.invalidPath);
      const body = await readErrorBody(res);
      expect(body.status).toBe("400");
      expect(body.scimType).toBe("invalidPath");
    });

    it("400 + invalidSyntax", async () => {
      const res = scimError(400, "bad syntax", SCIM_ERROR_TYPES.invalidSyntax);
      const body = await readErrorBody(res);
      expect(body.status).toBe("400");
      expect(body.scimType).toBe("invalidSyntax");
    });

    it("400 + invalidValue", async () => {
      const res = scimError(400, "bad value", SCIM_ERROR_TYPES.invalidValue);
      const body = await readErrorBody(res);
      expect(body.status).toBe("400");
      expect(body.scimType).toBe("invalidValue");
    });

    it("400 + noTarget", async () => {
      const res = scimError(400, "no target", SCIM_ERROR_TYPES.noTarget);
      const body = await readErrorBody(res);
      expect(body.status).toBe("400");
      expect(body.scimType).toBe("noTarget");
    });

    it("400 + tooMany", async () => {
      const res = scimError(400, "too many", SCIM_ERROR_TYPES.tooMany);
      const body = await readErrorBody(res);
      expect(body.status).toBe("400");
      expect(body.scimType).toBe("tooMany");
    });

    it("404 with no scimType", async () => {
      const res = scimError(404, "User abc not found");
      const body = await readErrorBody(res);
      expect(body.status).toBe("404");
      expect(body).not.toHaveProperty("scimType");
      expect(body.detail).toBe("User abc not found");
    });

    it("409 + uniqueness", async () => {
      const res = scimError(
        409,
        "userName already exists",
        SCIM_ERROR_TYPES.uniqueness,
      );
      expect(res.status).toBe(409);
      const body = await readErrorBody(res);
      expect(body.status).toBe("409");
      expect(body.scimType).toBe("uniqueness");
      expect(body.detail).toBe("userName already exists");
    });

    it("501 with no scimType (PATCH not yet implemented sentinel)", async () => {
      const res = scimError(501, "PATCH not implemented");
      expect(res.status).toBe(501);
      const body = await readErrorBody(res);
      expect(body.status).toBe("501");
      expect(body).not.toHaveProperty("scimType");
    });
  });
});
