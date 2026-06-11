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

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

const CORE_USER_URN = "urn:ietf:params:scim:schemas:core:2.0:User";
const CORE_GROUP_URN = "urn:ietf:params:scim:schemas:core:2.0:Group";
const ENTERPRISE_USER_URN =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

const createRequest = (
  id: string
): [NextRequest, { params: Promise<{ id: string }> }] => {
  const req = new NextRequest(
    `http://localhost/api/scim/v2/Schemas/${encodeURIComponent(id)}`
  );
  const params = { params: Promise.resolve({ id }) };
  return [req, params];
};

describe("GET /api/scim/v2/Schemas/[id]", () => {
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
    const [req, ctx] = createRequest(CORE_USER_URN);
    const res = await GET(req, ctx);
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

  it("returns the core User schema with the SCIM content type and cache-control: no-store", async () => {
    const [req, ctx] = createRequest(CORE_USER_URN);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as {
      id: string;
      name: string;
      attributes: Array<{ name: string }>;
      meta: { resourceType: string; location: string };
    };
    expect(body.id).toBe(CORE_USER_URN);
    expect(body.name).toBe("User");
    expect(body.attributes.some((a) => a.name === "userName")).toBe(true);
    expect(body.meta.resourceType).toBe("Schema");
    expect(body.meta.location).toBe(
      `http://localhost:3000/api/scim/v2/Schemas/${CORE_USER_URN}`
    );
  });

  it("returns the core Group schema content with injected meta", async () => {
    const [req, ctx] = createRequest(CORE_GROUP_URN);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      attributes: Array<{ name: string }>;
      meta: { resourceType: string; location: string };
    };
    expect(body.id).toBe(CORE_GROUP_URN);
    expect(body.name).toBe("Group");
    expect(body.attributes.some((a) => a.name === "displayName")).toBe(true);
    expect(body.meta.resourceType).toBe("Schema");
    expect(body.meta.location).toBe(
      `http://localhost:3000/api/scim/v2/Schemas/${CORE_GROUP_URN}`
    );
  });

  it("returns the enterprise extension schema content with injected meta", async () => {
    const [req, ctx] = createRequest(ENTERPRISE_USER_URN);
    const res = await GET(req, ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      name: string;
      attributes: Array<{ name: string }>;
      meta: { resourceType: string; location: string };
    };
    expect(body.id).toBe(ENTERPRISE_USER_URN);
    expect(body.name).toBe("EnterpriseUser");
    expect(body.attributes.some((a) => a.name === "employeeNumber")).toBe(true);
    expect(body.meta.resourceType).toBe("Schema");
    expect(body.meta.location).toBe(
      `http://localhost:3000/api/scim/v2/Schemas/${ENTERPRISE_USER_URN}`
    );
  });

  it("returns 404 with scimType omitted for an unknown URN (RFC 7644 §3.12)", async () => {
    const [req, ctx] = createRequest("urn:does:not:exist");
    const res = await GET(req, ctx);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = (await res.json()) as Record<string, unknown> & {
      schemas: string[];
      status: string;
      detail: string;
    };
    expect(body.schemas).toEqual([
      "urn:ietf:params:scim:api:messages:2.0:Error",
    ]);
    expect(body.status).toBe("404");
    expect("scimType" in body).toBe(false);
    expect(body.detail).toBe("Schema not found");
  });

  it("derives meta.location from NEXTAUTH_URL when the env var is changed", async () => {
    const before = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "http://app.example.com";
    try {
      const [req, ctx] = createRequest(CORE_USER_URN);
      const res = await GET(req, ctx);
      const body = (await res.json()) as {
        meta: { location: string };
      };
      expect(body.meta.location).toBe(
        `http://app.example.com/api/scim/v2/Schemas/${CORE_USER_URN}`
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

describe("non-GET methods on /api/scim/v2/Schemas/[id]", () => {
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
