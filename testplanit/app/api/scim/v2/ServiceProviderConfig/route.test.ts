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

const req = (path = "/api/scim/v2/ServiceProviderConfig"): NextRequest =>
  new NextRequest(`http://localhost${path}`);

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

describe("GET /api/scim/v2/ServiceProviderConfig", () => {
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

  it("envelopes the response with the ServiceProviderConfig schema URN and meta", async () => {
    const res = await GET(req());
    const body = (await res.json()) as Record<string, unknown> & {
      schemas: string[];
      meta: { resourceType: string; location: string };
    };
    expect(body.schemas[0]).toBe(
      "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
    );
    expect(body.meta.resourceType).toBe("ServiceProviderConfig");
    expect(body.meta.location).toBe(
      "http://localhost:3000/api/scim/v2/ServiceProviderConfig"
    );
  });

  it("advertises PATCH support", async () => {
    const res = await GET(req());
    const body = (await res.json()) as { patch: { supported: boolean } };
    expect(body.patch.supported).toBe(true);
  });

  it("advertises conservative bulk/filter/sort/etag/changePassword values", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      bulk: {
        supported: boolean;
        maxOperations: number;
        maxPayloadSize: number;
      };
      filter: { supported: boolean; maxResults: number };
      changePassword: { supported: boolean };
      sort: { supported: boolean };
      etag: { supported: boolean };
    };
    expect(body.bulk.supported).toBe(false);
    expect(body.bulk.maxOperations).toBe(0);
    expect(body.bulk.maxPayloadSize).toBe(0);
    expect(body.filter.supported).toBe(true);
    expect(body.filter.maxResults).toBe(200);
    expect(body.changePassword.supported).toBe(false);
    expect(body.sort.supported).toBe(false);
    expect(body.etag.supported).toBe(false);
  });

  it("forward-declares the OAuth Bearer Token authentication scheme", async () => {
    const res = await GET(req());
    const body = (await res.json()) as {
      authenticationSchemes: Array<{
        type: string;
        name: string;
        description: string;
        specUri: string;
        primary: boolean;
      }>;
    };
    expect(body.authenticationSchemes[0].type).toBe("oauthbearertoken");
    expect(body.authenticationSchemes[0].name).toBe("OAuth Bearer Token");
    expect(body.authenticationSchemes[0].description).toBe(
      "Authentication via tps_ prefixed bearer tokens minted by an admin"
    );
    expect(body.authenticationSchemes[0].specUri).toBe(
      "https://www.rfc-editor.org/rfc/rfc6750"
    );
    expect(body.authenticationSchemes[0].primary).toBe(true);
  });

  it("omits documentationUri from the body", async () => {
    const res = await GET(req());
    const body = (await res.json()) as Record<string, unknown>;
    expect("documentationUri" in body).toBe(false);
  });

  it("derives meta.location from NEXTAUTH_URL when the env var is changed", async () => {
    const before = process.env.NEXTAUTH_URL;
    process.env.NEXTAUTH_URL = "http://app.example.com";
    try {
      const res = await GET(req());
      const body = (await res.json()) as {
        meta: { location: string };
      };
      expect(body.meta.location).toBe(
        "http://app.example.com/api/scim/v2/ServiceProviderConfig"
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

describe("non-GET methods on /api/scim/v2/ServiceProviderConfig", () => {
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
