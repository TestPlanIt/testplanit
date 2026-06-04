import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { DELETE, GET, PATCH, POST, PUT } from "./route";

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

  it("returns 200 with the SCIM content type and cache-control: no-store", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns exactly three keys: serviceProviderConfig, schemas, resourceTypes (D-09)", async () => {
    const res = await GET();
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "resourceTypes",
      "schemas",
      "serviceProviderConfig",
    ]);
  });

  it("derives the three pointer URLs from NEXTAUTH_URL", async () => {
    const res = await GET();
    const body = (await res.json()) as {
      serviceProviderConfig: string;
      schemas: string;
      resourceTypes: string;
    };
    expect(body.serviceProviderConfig).toBe(
      "http://app.example.com/scim/v2/ServiceProviderConfig"
    );
    expect(body.schemas).toBe("http://app.example.com/scim/v2/Schemas");
    expect(body.resourceTypes).toBe(
      "http://app.example.com/scim/v2/ResourceTypes"
    );
  });

  it("falls back to http://localhost:3000 when NEXTAUTH_URL is unset", async () => {
    delete process.env.NEXTAUTH_URL;
    const res = await GET();
    const body = (await res.json()) as {
      serviceProviderConfig: string;
      schemas: string;
      resourceTypes: string;
    };
    expect(body.serviceProviderConfig).toBe(
      "http://localhost:3000/scim/v2/ServiceProviderConfig"
    );
    expect(body.schemas).toBe("http://localhost:3000/scim/v2/Schemas");
    expect(body.resourceTypes).toBe(
      "http://localhost:3000/scim/v2/ResourceTypes"
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
