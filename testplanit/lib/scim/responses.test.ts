import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  getScimBaseUrl,
  scimListResponse,
  scimLocation,
  scimResponse,
} from "./responses";

const originalNextAuthUrl = process.env.NEXTAUTH_URL;

beforeAll(() => {
  delete process.env.NEXTAUTH_URL;
});

afterAll(() => {
  if (originalNextAuthUrl === undefined) {
    delete process.env.NEXTAUTH_URL;
  } else {
    process.env.NEXTAUTH_URL = originalNextAuthUrl;
  }
});

describe("getScimBaseUrl", () => {
  it("returns process.env.NEXTAUTH_URL when set", () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    try {
      expect(getScimBaseUrl()).toBe("https://app.example.com");
    } finally {
      delete process.env.NEXTAUTH_URL;
    }
  });

  it("falls back to http://localhost:3000 when NEXTAUTH_URL is unset", () => {
    expect(process.env.NEXTAUTH_URL).toBeUndefined();
    expect(getScimBaseUrl()).toBe("http://localhost:3000");
  });
});

describe("scimLocation", () => {
  it("builds an absolute URL with resourceType and id from NEXTAUTH_URL", () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    try {
      expect(scimLocation("Users", "abc-123")).toBe(
        "https://app.example.com/api/scim/v2/Users/abc-123"
      );
    } finally {
      delete process.env.NEXTAUTH_URL;
    }
  });

  it("omits the id segment for collection-style locations", () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    try {
      expect(scimLocation("Schemas")).toBe(
        "https://app.example.com/api/scim/v2/Schemas"
      );
    } finally {
      delete process.env.NEXTAUTH_URL;
    }
  });

  it("falls back to http://localhost:3000 base when NEXTAUTH_URL is unset", () => {
    expect(process.env.NEXTAUTH_URL).toBeUndefined();
    expect(scimLocation("Users", "abc-123")).toBe(
      "http://localhost:3000/api/scim/v2/Users/abc-123"
    );
  });

  it("works for the ServiceProviderConfig singleton resource", () => {
    process.env.NEXTAUTH_URL = "https://app.example.com";
    try {
      expect(scimLocation("ServiceProviderConfig")).toBe(
        "https://app.example.com/api/scim/v2/ServiceProviderConfig"
      );
    } finally {
      delete process.env.NEXTAUTH_URL;
    }
  });
});

describe("scimListResponse", () => {
  it("emits the RFC 7644 §3.4.2 envelope on a non-empty list", async () => {
    const res = scimListResponse([{ id: "u1" }, { id: "u2" }]);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 2,
      itemsPerPage: 2,
      startIndex: 1,
      Resources: [{ id: "u1" }, { id: "u2" }],
    });
  });

  it("emits totalResults=0, itemsPerPage=0 on an empty list", async () => {
    const res = scimListResponse([]);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: 0,
      itemsPerPage: 0,
      startIndex: 1,
      Resources: [],
    });
  });

  it("uses startIndex 1 (1-based per RFC 7644 §3.4.2.4)", async () => {
    const res = scimListResponse([{ id: "x" }]);
    const body = (await res.json()) as { startIndex: number };
    expect(body.startIndex).toBe(1);
  });
});

describe("scimResponse", () => {
  it("defaults to HTTP 200 with SCIM Content-Type", async () => {
    const res = scimResponse({ id: "u1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
    expect(await res.json()).toEqual({ id: "u1" });
  });

  it("supports HTTP 201 for create flows", () => {
    const res = scimResponse({ id: "u1" }, { status: 201 });
    expect(res.status).toBe(201);
    expect(res.headers.get("Content-Type")).toBe("application/scim+json");
  });
});
