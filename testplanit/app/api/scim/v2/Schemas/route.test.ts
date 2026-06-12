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

const req = (path = "/api/scim/v2/Schemas"): NextRequest =>
  new NextRequest(`http://localhost${path}`);

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

const CORE_USER_URN = "urn:ietf:params:scim:schemas:core:2.0:User";
const CORE_GROUP_URN = "urn:ietf:params:scim:schemas:core:2.0:Group";
const ENTERPRISE_USER_URN =
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

describe("GET /api/scim/v2/Schemas", () => {
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
    expect(body.totalResults).toBe(3);
    expect(body.itemsPerPage).toBe(3);
    expect(body.startIndex).toBe(1);
    expect(body.Resources.length).toBe(3);
  });

  it("lists the core User, core Group, and enterprise extension URNs in order", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{ id: string }>;
    };
    expect(body.Resources[0].id).toBe(CORE_USER_URN);
    expect(body.Resources[1].id).toBe(CORE_GROUP_URN);
    expect(body.Resources[2].id).toBe(ENTERPRISE_USER_URN);
  });

  it("embeds the core User schema content (name + attributes from user.json)", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        id: string;
        name: string;
        attributes: Array<{ name: string }>;
      }>;
    };
    expect(body.Resources[0].name).toBe("User");
    expect(body.Resources[0].attributes.length).toBeGreaterThan(0);
    expect(
      body.Resources[0].attributes.some((a) => a.name === "userName")
    ).toBe(true);
  });

  it("embeds the core Group schema content (name + displayName attribute)", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        id: string;
        name: string;
        attributes: Array<{ name: string }>;
      }>;
    };
    expect(body.Resources[1].name).toBe("Group");
    expect(
      body.Resources[1].attributes.some((a) => a.name === "displayName")
    ).toBe(true);
  });

  it("embeds the enterprise extension content (EnterpriseUser + employeeNumber)", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        id: string;
        name: string;
        attributes: Array<{ name: string }>;
      }>;
    };
    expect(body.Resources[2].name).toBe("EnterpriseUser");
    expect(
      body.Resources[2].attributes.some((a) => a.name === "employeeNumber")
    ).toBe(true);
  });

  it("injects meta.resourceType:Schema and absolute meta.location for every resource", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      Resources: Array<{
        id: string;
        meta: { resourceType: string; location: string };
      }>;
    };
    expect(body.Resources[0].meta.resourceType).toBe("Schema");
    expect(body.Resources[0].meta.location).toBe(
      `http://localhost:3000/api/scim/v2/Schemas/${CORE_USER_URN}`
    );
    expect(body.Resources[1].meta.resourceType).toBe("Schema");
    expect(body.Resources[1].meta.location).toBe(
      `http://localhost:3000/api/scim/v2/Schemas/${CORE_GROUP_URN}`
    );
    expect(body.Resources[2].meta.resourceType).toBe("Schema");
    expect(body.Resources[2].meta.location).toBe(
      `http://localhost:3000/api/scim/v2/Schemas/${ENTERPRISE_USER_URN}`
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

describe("non-GET methods on /api/scim/v2/Schemas", () => {
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
