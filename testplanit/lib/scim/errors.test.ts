import { describe, it, expect } from "vitest";

import { scimError } from "./errors";

/**
 * Coverage matrix: every RFC 7644 §3.12 status / scimType pair listed in
 * the Phase 5 context decisions (D-10). Each `it` block hand-asserts on the
 * full envelope shape — no snapshots (D-11).
 */
describe("scimError", () => {
  it("sets Content-Type to application/scim+json on every response", () => {
    const res = scimError(500, null, "boom");
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
  });

  it("emits status as a string in the body (RFC 7644 §3.12)", async () => {
    const res = scimError(500, null, "boom");
    const body = (await res.json()) as { status: string };
    expect(typeof body.status).toBe("string");
    expect(body.status).toBe("500");
  });

  it("omits scimType field entirely when null (not serialized as JSON null)", async () => {
    const res = scimError(404, null, "User not found");
    const body = (await res.json()) as Record<string, unknown>;
    expect("scimType" in body).toBe(false);
    expect(body.scimType).toBeUndefined();
  });

  it("preserves the English detail string verbatim (no i18n)", async () => {
    const res = scimError(400, "invalidFilter", "Filter could not be parsed");
    const body = (await res.json()) as { detail: string };
    expect(body.detail).toBe("Filter could not be parsed");
  });

  // ---------------------------------------------------------------------------
  // RFC 7644 §3.12 status / scimType combinations from CONTEXT.md D-10
  // ---------------------------------------------------------------------------

  it("returns a 400 invalidFilter envelope", async () => {
    const res = scimError(400, "invalidFilter", "bad filter");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidFilter",
      detail: "bad filter",
    });
  });

  it("returns a 400 invalidPath envelope", async () => {
    const res = scimError(400, "invalidPath", "bad path");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidPath",
      detail: "bad path",
    });
  });

  it("returns a 400 invalidSyntax envelope", async () => {
    const res = scimError(400, "invalidSyntax", "bad syntax");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidSyntax",
      detail: "bad syntax",
    });
  });

  it("returns a 400 invalidValue envelope", async () => {
    const res = scimError(400, "invalidValue", "bad value");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "invalidValue",
      detail: "bad value",
    });
  });

  it("returns a 400 noTarget envelope", async () => {
    const res = scimError(400, "noTarget", "no target");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "noTarget",
      detail: "no target",
    });
  });

  it("returns a 400 tooMany envelope", async () => {
    const res = scimError(400, "tooMany", "too many");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "400",
      scimType: "tooMany",
      detail: "too many",
    });
  });

  it("returns a 404 envelope with no scimType key", async () => {
    const res = scimError(404, null, "User abc not found");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "404",
      detail: "User abc not found",
    });
    expect("scimType" in body).toBe(false);
  });

  it("returns a 409 uniqueness envelope", async () => {
    const res = scimError(409, "uniqueness", "userName already exists");
    expect(res.status).toBe(409);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "409",
      scimType: "uniqueness",
      detail: "userName already exists",
    });
  });

  it("returns a 501 envelope with no scimType key", async () => {
    const res = scimError(501, null, "PATCH not implemented");
    expect(res.status).toBe(501);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
      status: "501",
      detail: "PATCH not implemented",
    });
    expect("scimType" in body).toBe(false);
  });
});
