import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { requireScimBearer, ScimAuthError } from "~/lib/scim/auth";
import { scimError } from "~/lib/scim/errors";

import { DELETE, GET, PATCH, POST, PUT } from "./route";

vi.mock("~/lib/scim/auth", () => ({
  ScimAuthError: class extends Error {
    constructor(public response: unknown) {
      super("SCIM bearer auth failed");
      this.name = "ScimAuthError";
    }
  },
  requireScimBearer: vi.fn().mockResolvedValue({
    tokenId: "tk_test",
    systemUserId: "system-scim-user",
  }),
}));

const req = (path = "/api/scim/v2/ResourceTypes"): NextRequest =>
  new NextRequest(`http://localhost${path}`);

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

const CORE_USER_URN = "urn:ietf:params:scim:schemas:core:2.0:User";
const CORE_GROUP_URN = "urn:ietf:params:scim:schemas:core:2.0:Group";
const ENTERPRISE_USER_URN =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const RESOURCE_TYPE_URN = "urn:ietf:params:scim:schemas:core:2.0:ResourceType";

describe("GET /api/scim/v2/ResourceTypes", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
  });

  afterAll(() => {
    if (originalNextAuthUrl) {
      process.env.NEXTAUTH_URL = originalNextAuthUrl;
    } else {
      delete process.env.NEXTAUTH_URL;
    }
  });

  it("returns 401 with SCIM error envelope when no bearer token provided", async () => {
    vi.mocked(requireScimBearer).mockRejectedValueOnce(
      new ScimAuthError(scimError(401, null, "Missing Authorization header"))
    );
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as {
      schemas: string[];
      status: string;
      detail: string;
    };
    expect(body.schemas[0]).toBe("urn:ietf:params:scim:api:messages:2.0:Error");
    expect(body.status).toBe("401");
    expect(body.detail).toBe("Missing Authorization header");
  });

  it("returns 200 with the SCIM content type and cache-control: no-store", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("wraps the response in a SCIM ListResponse envelope (RFC 7644 §3.4.2)", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      schemas: string[];
      totalResults: number;
      itemsPerPage: number;
      startIndex: number;
      Resources: unknown[];
    };
    expect(body.schemas[0]).toBe(
      "urn:ietf:params:scim:api:messages:2.0:ListResponse"
    );
    expect(body.totalResults).toBe(2);
    expect(body.itemsPerPage).toBe(2);
    expect(body.startIndex).toBe(1);
    expect(body.Resources.length).toBe(2);
  });

  it("lists the User ResourceType first with id, name, endpoint, and schema (RFC 7643 §6)", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        schemas: string[];
        id: string;
        name: string;
        endpoint: string;
        description: string;
        schema: string;
      }>;
    };
    const user = body.Resources[0];
    expect(user.schemas[0]).toBe(RESOURCE_TYPE_URN);
    expect(user.id).toBe("User");
    expect(user.name).toBe("User");
    expect(user.endpoint).toBe("/Users");
    expect(typeof user.description).toBe("string");
    expect(user.description.length).toBeGreaterThan(0);
    expect(user.schema).toBe(CORE_USER_URN);
  });

  it("advertises the enterprise extension on the User ResourceType with required: false", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        schemaExtensions: Array<{ schema: string; required: boolean }>;
      }>;
    };
    const user = body.Resources[0];
    expect(Array.isArray(user.schemaExtensions)).toBe(true);
    expect(user.schemaExtensions.length).toBe(1);
    expect(user.schemaExtensions[0].schema).toBe(ENTERPRISE_USER_URN);
    expect(user.schemaExtensions[0].required).toBe(false);
  });

  it("lists the Group ResourceType second with id, name, endpoint, and schema (RFC 7643 §6)", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        schemas: string[];
        id: string;
        name: string;
        endpoint: string;
        description: string;
        schema: string;
        schemaExtensions: unknown[];
      }>;
    };
    const group = body.Resources[1];
    expect(group.schemas[0]).toBe(RESOURCE_TYPE_URN);
    expect(group.id).toBe("Group");
    expect(group.name).toBe("Group");
    expect(group.endpoint).toBe("/Groups");
    expect(typeof group.description).toBe("string");
    expect(group.description.length).toBeGreaterThan(0);
    expect(group.schema).toBe(CORE_GROUP_URN);
    expect(Array.isArray(group.schemaExtensions)).toBe(true);
    expect(group.schemaExtensions.length).toBe(0);
  });

  it("injects meta.resourceType:ResourceType and absolute meta.location for every resource", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        id: string;
        meta: { resourceType: string; location: string };
      }>;
    };
    expect(body.Resources[0].meta.resourceType).toBe("ResourceType");
    expect(body.Resources[0].meta.location).toBe(
      "http://localhost:3000/api/scim/v2/ResourceTypes/User"
    );
    expect(body.Resources[1].meta.resourceType).toBe("ResourceType");
    expect(body.Resources[1].meta.location).toBe(
      "http://localhost:3000/api/scim/v2/ResourceTypes/Group"
    );
  });

  it("derives meta.location from NEXTAUTH_URL when the env var is changed", async () => {
    const before = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "http://app.example.com";
    try {
      const res = await GET(req());
      const body = (await res.json()) as {
        Resources: Array<{ meta: { location: string } }>;
      };
      expect(body.Resources[0].meta.location).toBe(
        "http://app.example.com/api/scim/v2/ResourceTypes/User"
      );
      expect(body.Resources[1].meta.location).toBe(
        "http://app.example.com/api/scim/v2/ResourceTypes/Group"
      );
    } finally {
      if (before) {
        process.env.NEXTAUTH_URL = before;
      } else {
        delete process.env.NEXTAUTH_URL;
      }
    }
  });
});

describe("non-GET methods on /api/scim/v2/ResourceTypes", () => {
  const errorEnvelope = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"],
    status: "405",
    detail: "Method not supported",
  };

  it("POST returns a 405 SCIM error envelope", async () => {
    const res = await POST();
    expect(res.status).toBe(405);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = await res.json();
    expect(body).toEqual(errorEnvelope);
  });

  it("PUT returns a 405 SCIM error envelope", async () => {
    const res = await PUT();
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body).toEqual(errorEnvelope);
  });

  it("PATCH returns a 405 SCIM error envelope", async () => {
    const res = await PATCH();
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body).toEqual(errorEnvelope);
  });

  it("DELETE returns a 405 SCIM error envelope", async () => {
    const res = await DELETE();
    expect(res.status).toBe(405);
    const body = await res.json();
    expect(body).toEqual(errorEnvelope);
  });
});
