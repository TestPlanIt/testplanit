import { NextRequest } from "next/server";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

const req = (
  path = "/api/scim/v2/.well-known/scim-configuration"
): NextRequest => new NextRequest(`http://localhost${path}`);

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

describe("GET /api/scim/v2/.well-known/scim-configuration", () => {
  beforeAll(() => {
    process.env.NEXTAUTH_URL = "http://app.example.com";
  });

  afterEach(() => {
    process.env.NEXTAUTH_URL = "http://app.example.com";
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

  it("returns exactly three keys: serviceProviderConfig, schemas, resourceTypes", async () => {
    const res = await GET(req());
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "resourceTypes",
      "schemas",
      "serviceProviderConfig",
    ]);
  });

  it("derives the three pointer URLs from NEXTAUTH_URL", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      serviceProviderConfig: string;
      schemas: string;
      resourceTypes: string;
    };
    expect(body.serviceProviderConfig).toBe(
      "http://app.example.com/api/scim/v2/ServiceProviderConfig"
    );
    expect(body.schemas).toBe("http://app.example.com/api/scim/v2/Schemas");
    expect(body.resourceTypes).toBe(
      "http://app.example.com/api/scim/v2/ResourceTypes"
    );
  });

  it("falls back to http://localhost:3000 when NEXTAUTH_URL is unset", async () => {
    delete process.env.NEXTAUTH_URL;
    const res = await GET(req());
    const body = (await res.json()) as {
      serviceProviderConfig: string;
      schemas: string;
      resourceTypes: string;
    };
    expect(body.serviceProviderConfig).toBe(
      "http://localhost:3000/api/scim/v2/ServiceProviderConfig"
    );
    expect(body.schemas).toBe("http://localhost:3000/api/scim/v2/Schemas");
    expect(body.resourceTypes).toBe(
      "http://localhost:3000/api/scim/v2/ResourceTypes"
    );
  });
});

describe("non-GET methods on /api/scim/v2/.well-known/scim-configuration", () => {
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
