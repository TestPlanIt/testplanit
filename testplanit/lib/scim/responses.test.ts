import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  SCIM_CONTENT_TYPE,
  SCIM_LIST_RESPONSE_SCHEMA,
} from "./constants";
import {
  scimList,
  scimLocation,
  scimResource,
  type ScimListResponse,
} from "./responses";

describe("scimLocation", () => {
  const originalNextAuthUrl = process.env.NEXTAUTH_URL;

  beforeEach(() => {
    delete process.env.NEXTAUTH_URL;
  });

  afterEach(() => {
    if (originalNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    }
  });

  describe("when NEXTAUTH_URL is set", () => {
    it("derives an absolute URL for a resource id", () => {
      process.env.NEXTAUTH_URL = "https://app.example.com";
      expect(scimLocation("Users", "abc-123")).toBe(
        "https://app.example.com/scim/v2/Users/abc-123",
      );
    });

    it("derives an absolute URL for a collection (no id)", () => {
      process.env.NEXTAUTH_URL = "https://app.example.com";
      expect(scimLocation("Users")).toBe(
        "https://app.example.com/scim/v2/Users",
      );
    });

    it("strips a trailing slash to avoid emitting `//`", () => {
      process.env.NEXTAUTH_URL = "https://app.example.com/";
      expect(scimLocation("Groups", "g1")).toBe(
        "https://app.example.com/scim/v2/Groups/g1",
      );
    });

    it("works for singleton config resources", () => {
      process.env.NEXTAUTH_URL = "https://app.example.com";
      expect(scimLocation("ServiceProviderConfig")).toBe(
        "https://app.example.com/scim/v2/ServiceProviderConfig",
      );
    });
  });

  describe("when NEXTAUTH_URL is NOT set", () => {
    it("falls back to a host-relative path for a resource id", () => {
      expect(process.env.NEXTAUTH_URL).toBeUndefined();
      expect(scimLocation("Users", "abc-123")).toBe("/scim/v2/Users/abc-123");
    });

    it("falls back to a host-relative path for a collection", () => {
      expect(process.env.NEXTAUTH_URL).toBeUndefined();
      expect(scimLocation("Users")).toBe("/scim/v2/Users");
    });

    it("never derives the base URL from request headers", () => {
      // Negative test: scimLocation takes no Request argument and reads only
      // process.env. This is the Pitfall 17 invariant — guarding against a
      // future refactor that introduces a Host-header fallback.
      expect(scimLocation.length).toBe(2);
    });
  });
});

describe("scimResource", () => {
  it("defaults to HTTP 200", async () => {
    const res = scimResource({ id: "u1" });
    expect(res.status).toBe(200);
  });

  it("supports HTTP 201 for create flows", async () => {
    const res = scimResource({ id: "u1" }, { status: 201 });
    expect(res.status).toBe(201);
  });

  it("sets Content-Type to application/scim+json", () => {
    const res = scimResource({ id: "u1" });
    expect(res.headers.get("Content-Type")).toBe(SCIM_CONTENT_TYPE);
  });

  it("serializes the body verbatim", async () => {
    const res = scimResource({ id: "u1", userName: "alice" });
    expect(await res.json()).toEqual({ id: "u1", userName: "alice" });
  });
});

describe("scimList", () => {
  it("sets HTTP 200 and the SCIM Content-Type", () => {
    const res = scimList([], 0, 1, 0);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(SCIM_CONTENT_TYPE);
  });

  it("emits the RFC 7644 §3.4.2 ListResponse envelope", async () => {
    const res = scimList([{ id: "u1" }, { id: "u2" }], 42, 1, 2);
    const body = (await res.json()) as ScimListResponse<{ id: string }>;
    expect(body.schemas).toEqual([SCIM_LIST_RESPONSE_SCHEMA]);
    expect(body.totalResults).toBe(42);
    expect(body.startIndex).toBe(1);
    expect(body.itemsPerPage).toBe(2);
    expect(body.Resources).toEqual([{ id: "u1" }, { id: "u2" }]);
  });

  it("preserves an empty Resources array (not omitted)", async () => {
    const res = scimList([], 0, 1, 0);
    const body = (await res.json()) as ScimListResponse<unknown>;
    expect(body.Resources).toEqual([]);
    expect(body.totalResults).toBe(0);
    expect(body.startIndex).toBe(1);
    expect(body.itemsPerPage).toBe(0);
  });

  it("preserves startIndex as 1-based per RFC 7644 §3.4.2.4", async () => {
    const res = scimList([{ id: "u3" }], 100, 3, 1);
    const body = (await res.json()) as ScimListResponse<{ id: string }>;
    expect(body.startIndex).toBe(3);
  });
});
